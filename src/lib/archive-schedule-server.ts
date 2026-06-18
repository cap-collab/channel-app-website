import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  buildLoop,
  buildQueue,
  computeLiveBlocks,
  EligibleArchive,
  INTERSTITIALS_COLLECTION,
  LiveBlockBoundary,
  LOOP_COLLECTION,
  loopDocId,
  offsetUtcId,
  SCHEDULE_COLLECTION,
  shuffle,
  tallyRecentPlays,
  utcDayStartMs,
} from '@/lib/archive-schedule';
import type {
  ArchiveScheduleDay,
  Interstitial,
  ScheduleItem,
} from '@/types/broadcast';

export interface RunArgs {
  dateId: string;
  force?: boolean;
  generatedBy?: 'cron' | 'admin';
}

export interface RunResult {
  date: string;
  itemCount: number;
  totalDurationSec: number;
  warnings: string[];
  skipped?: 'locked' | 'already-exists';
}

// Builder reused by the cron handler and (later) the admin "Regenerate" UI.
export async function generateScheduleForDate(args: RunArgs): Promise<RunResult> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');

  const dateId = args.dateId;
  const docRef = db.collection(SCHEDULE_COLLECTION).doc(dateId);
  const existing = await docRef.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (data.locked === true && !args.force) {
      return { date: dateId, itemCount: 0, totalDurationSec: 0, warnings: [], skipped: 'locked' };
    }
  }

  // Build a DJ→scenes map from the users collection (mirrors useScenesData on
  // the client). We denormalize the scene slug onto each schedule item so the
  // sticky bar / hero can render the scene glyph without re-resolving.
  // Map by chatUsernameNormalized AND userId so we can match either form
  // present in the archive doc.
  const sceneByUserId = new Map<string, string[]>();
  const sceneByUsername = new Map<string, string[]>();
  try {
    const usersSnap = await db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get();
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const sceneIds: string[] = data?.djProfile?.sceneIds ?? [];
      if (!Array.isArray(sceneIds) || sceneIds.length === 0) continue;
      sceneByUserId.set(doc.id, sceneIds);
      const normalized =
        typeof data?.chatUsernameNormalized === 'string'
          ? data.chatUsernameNormalized
          : typeof data?.chatUsername === 'string'
            ? data.chatUsername.toLowerCase().replace(/\s+/g, '')
            : null;
      if (normalized) sceneByUsername.set(normalized, sceneIds);
    }
  } catch (err) {
    console.warn('[archive-schedule-server] scene map fetch failed; items will have no sceneSlugs', err);
  }

  // Eligible archives: featured + high + medium priority, public, fully uploaded.
  // 'featured' is collapsed to 'high' below so all downstream loop logic
  // (pool selection, weighting) treats it identically to high.
  // Single collection.get() + in-code filter (matches /api/archives — keeps
  // us from needing a new composite index).
  const archivesSnap = await db.collection('archives').get();
  const archives: EligibleArchive[] = [];
  for (const doc of archivesSnap.docs) {
    const d = doc.data();
    if (d.uploadStatus === 'uploading') continue;
    if (d.isPublic === false) continue;
    const rawPriority = (d.priority || 'medium') as string;
    if (rawPriority !== 'featured' && rawPriority !== 'high' && rawPriority !== 'medium') continue;
    // Featured behaves exactly like high in the loop.
    const priority = rawPriority === 'featured' ? 'high' : rawPriority;
    const recordingUrl: string | undefined = d.recordingUrl;
    const durationSec: number = Number(d.duration || 0);
    // Skip stubs and short archives — anything under 30 minutes isn't worth
    // scheduling (would clutter the day with rapid-fire short items).
    if (!recordingUrl || !durationSec || durationSec < 30 * 60) continue;
    const djsRaw: Array<{ name?: string; username?: string; userId?: string; photoUrl?: string }> = Array.isArray(d.djs) ? d.djs : [];
    const djs = djsRaw
      .filter((dj): dj is { name: string; username?: string; userId?: string; photoUrl?: string } => typeof dj?.name === 'string' && dj.name.length > 0)
      .map((dj) => ({ name: dj.name, username: dj.username, photoUrl: dj.photoUrl }));

    // Resolve scene slugs. Priority:
    //   1. explicit sceneIdsOverride (admin-pinned)
    //   2. denormalized sceneSlugs on the archive doc (set by the backfill
    //      script + future archive uploads)
    //   3. live lookup from each DJ's djProfile.sceneIds (backstop for
    //      archives that haven't been backfilled yet)
    let sceneSlugs: string[] | undefined;
    if (Array.isArray(d.sceneIdsOverride)) {
      sceneSlugs = d.sceneIdsOverride.length > 0 ? d.sceneIdsOverride : undefined;
    } else if (Array.isArray(d.sceneSlugs) && d.sceneSlugs.length > 0) {
      sceneSlugs = d.sceneSlugs as string[];
    } else {
      const set = new Set<string>();
      for (const dj of djsRaw) {
        if (dj.userId) {
          const ids = sceneByUserId.get(dj.userId);
          if (ids) ids.forEach((id) => set.add(id));
        }
        if (dj.username) {
          const key = dj.username.toLowerCase().replace(/\s+/g, '');
          const ids = sceneByUsername.get(key);
          if (ids) ids.forEach((id) => set.add(id));
        }
      }
      if (set.size > 0) sceneSlugs = Array.from(set);
    }

    archives.push({
      id: doc.id,
      recordingUrl,
      durationSec,
      priority: priority as 'high' | 'medium',
      title: (d.showName as string) || (d.slug as string) || 'Archive',
      djs,
      artworkUrl: d.showImageUrl,
      sceneSlugs,
    });
  }

  // Interstitials are optional; v1 ships with the collection empty.
  const interstitials: Interstitial[] = [];
  try {
    const ixSnap = await db.collection(INTERSTITIALS_COLLECTION).get();
    for (const doc of ixSnap.docs) {
      const d = doc.data();
      if (!d.url || !d.durationSec) continue;
      interstitials.push({
        id: doc.id,
        url: d.url,
        durationSec: Number(d.durationSec),
        label: d.label,
        uploadedAtMs: Number(d.uploadedAtMs ?? 0),
      });
    }
  } catch {
    // Collection doesn't exist yet — fine, skip interstitials.
  }

  // Diversity window: count appearances in the prior 3 days. Per-archive
  // recent count divides the base weight in buildQueue, so a fresh archive
  // (0 plays) gets full weight while one that played twice gets weight/3.
  const priorDocs = await Promise.all([1, 2, 3].map((delta) =>
    db.collection(SCHEDULE_COLLECTION).doc(offsetUtcId(dateId, -delta)).get(),
  ));
  const priorDays: ArchiveScheduleDay[] = [];
  for (const snap of priorDocs) {
    if (!snap.exists) continue;
    const data = snap.data();
    if (!data) continue;
    const items: ScheduleItem[] = Array.isArray(data.items) ? (data.items as ScheduleItem[]) : [];
    priorDays.push({
      date: snap.id,
      startTimeMs: utcDayStartMs(snap.id),
      generatedAtMs: Number(data.generatedAtMs ?? 0),
      generatedBy: (data.generatedBy as 'cron' | 'admin') ?? 'cron',
      locked: Boolean(data.locked),
      items,
    });
  }
  const recentPlayCounts = tallyRecentPlays(priorDays);

  const result = buildQueue({ archives, interstitials, recentPlayCounts });

  // Firestore rejects undefined values; sanitize before write.
  const cleanItems: Record<string, unknown>[] = result.items.map((it) => {
    const obj: Record<string, unknown> = {
      kind: it.kind,
      recordingUrl: it.recordingUrl,
      durationSec: it.durationSec,
      startOffsetSec: it.startOffsetSec,
    };
    if (it.archiveId) obj.archiveId = it.archiveId;
    if (it.interstitialId) obj.interstitialId = it.interstitialId;
    if (it.title) obj.title = it.title;
    if (it.djs?.length) obj.djs = it.djs.map((dj) => {
      const o: Record<string, unknown> = { name: dj.name };
      if (dj.username) o.username = dj.username;
      if (dj.photoUrl) o.photoUrl = dj.photoUrl;
      return o;
    });
    if (it.artworkUrl) obj.artworkUrl = it.artworkUrl;
    if (it.sceneSlugs?.length) obj.sceneSlugs = it.sceneSlugs;
    return obj;
  });

  const startTimeMs = utcDayStartMs(dateId);
  const generatedAtMs = Date.now();
  await docRef.set({
    date: dateId,
    startTime: Timestamp.fromMillis(startTimeMs),
    startTimeMs,
    generatedAt: Timestamp.fromMillis(generatedAtMs),
    generatedAtMs,
    generatedBy: args.generatedBy ?? 'cron',
    locked: false,
    items: cleanItems,
    eligibleArchiveCount: archives.length,
    interstitialCount: interstitials.length,
  });

  return {
    date: dateId,
    itemCount: result.items.length,
    totalDurationSec: result.totalDurationSec,
    warnings: result.warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog-loop generator. Replaces the daily generator. One Firestore doc per
// loop in `archive-radio-loop`, doc id = `loop-NNNN`.
// ─────────────────────────────────────────────────────────────────────────────

// Shared eligibility loader used by both the daily generator (above) and the
// loop generator. Returns the same shape buildQueue + buildLoop expect, with
// scene slugs denormalized so the player doesn't need to re-resolve.
async function loadEligibleArchives(): Promise<EligibleArchive[]> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');

  const sceneByUserId = new Map<string, string[]>();
  const sceneByUsername = new Map<string, string[]>();
  try {
    const usersSnap = await db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get();
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const sceneIds: string[] = data?.djProfile?.sceneIds ?? [];
      if (!Array.isArray(sceneIds) || sceneIds.length === 0) continue;
      sceneByUserId.set(doc.id, sceneIds);
      const normalized =
        typeof data?.chatUsernameNormalized === 'string'
          ? data.chatUsernameNormalized
          : typeof data?.chatUsername === 'string'
            ? data.chatUsername.toLowerCase().replace(/\s+/g, '')
            : null;
      if (normalized) sceneByUsername.set(normalized, sceneIds);
    }
  } catch (err) {
    console.warn('[archive-schedule-server] scene map fetch failed; items will have no sceneSlugs', err);
  }

  const archivesSnap = await db.collection('archives').get();
  const archives: EligibleArchive[] = [];
  for (const doc of archivesSnap.docs) {
    const d = doc.data();
    if (d.uploadStatus === 'uploading') continue;
    if (d.isPublic === false) continue;
    const rawPriority = (d.priority || 'medium') as string;
    if (rawPriority !== 'featured' && rawPriority !== 'high' && rawPriority !== 'medium') continue;
    // Featured behaves exactly like high in the loop.
    const priority = rawPriority === 'featured' ? 'high' : rawPriority;
    const recordingUrl: string | undefined = d.recordingUrl;
    const durationSec: number = Number(d.duration || 0);
    if (!recordingUrl || !durationSec || durationSec < 30 * 60) continue;
    const djsRaw: Array<{ name?: string; username?: string; userId?: string; photoUrl?: string }> = Array.isArray(d.djs) ? d.djs : [];
    const djs = djsRaw
      .filter((dj): dj is { name: string; username?: string; userId?: string; photoUrl?: string } => typeof dj?.name === 'string' && dj.name.length > 0)
      .map((dj) => ({ name: dj.name, username: dj.username, photoUrl: dj.photoUrl }));

    let sceneSlugs: string[] | undefined;
    if (Array.isArray(d.sceneIdsOverride)) {
      sceneSlugs = d.sceneIdsOverride.length > 0 ? d.sceneIdsOverride : undefined;
    } else if (Array.isArray(d.sceneSlugs) && d.sceneSlugs.length > 0) {
      sceneSlugs = d.sceneSlugs as string[];
    } else {
      const set = new Set<string>();
      for (const dj of djsRaw) {
        if (dj.userId) {
          const ids = sceneByUserId.get(dj.userId);
          if (ids) ids.forEach((id) => set.add(id));
        }
        if (dj.username) {
          const key = dj.username.toLowerCase().replace(/\s+/g, '');
          const ids = sceneByUsername.get(key);
          if (ids) ids.forEach((id) => set.add(id));
        }
      }
      if (set.size > 0) sceneSlugs = Array.from(set);
    }

    archives.push({
      id: doc.id,
      recordingUrl,
      durationSec,
      priority: priority as 'high' | 'medium',
      title: (d.showName as string) || (d.slug as string) || 'Archive',
      djs,
      artworkUrl: d.showImageUrl,
      sceneSlugs,
    });
  }

  return archives;
}

export interface GenerateLoopArgs {
  loopNumber: number;
  force?: boolean;
  generatedBy?: 'cron' | 'admin';
  // Override for the loop's startTimeMs. If omitted, derived from the anchor
  // alignment algorithm (or previous loop's end time when no anchor).
  startTimeMsOverride?: number;
  // Synthetic "now" for dry-runs (e.g., simulate the 1am PT cron from
  // yesterday). Falls back to Date.now() when omitted.
  nowMsOverride?: number;
}

export interface GenerateLoopResult {
  loopNumber: number;
  itemCount: number;
  totalDurationSec: number;
  startTimeMs: number;
  highCount: number;
  mediumCount: number;
  interstitialCount: number;
  alignedAnchorCount: number;
  missedAnchorCount: number;
  warnings: string[];
  skipped?: 'locked';
}

interface LoopPlan {
  startTimeMs: number;
  anchor: LiveBlockBoundary | null;
  preAnchorArchiveIds: string[] | null;
  // Explicit ordered list of archives that play AFTER the anchor archive (or
  // make up the whole loop when there's no anchor). Sized so the loop ends near
  // [3am, 4am] PT N days after start (loop length flexes with the catalog).
  postAnchorArchiveIds: string[] | null;
  // All loops are short mode: every archive 1×, explicit ordered lists.
  // The mode field is kept for buildLoop's API but is always 'short'.
  mode: 'short';
  // Unused. Kept on the type for buildLoop's API compatibility.
  maxDurationSec: number | null;
  // Earliest moment this loop is allowed to start (= max(now, prevLoopEnd)).
  // Used as a final clamp after the anchor two-pass shift in generateLoop so
  // the new doc never overlaps the previous loop.
  earliestStartMs: number;
  reason: 'override' | 'first-loop' | 'anchor' | 'no-anchor';
}

// ── Loop pool + windowing constants ──
const CROSSFADE_SEC = 5;
// Start window: 1-2am PT. End window: 3-4am PT. Both are wall-clock targets the
// loop snaps to; loop length flexes (in whole days) to land start in one and end
// in the other. Expressed as UTC hours-of-day (PDT = UTC-7; ±1h in PST months).
const START_WINDOW_UTC_H = [8, 9] as const;  // 1am, 2am PT
const END_WINDOW_UTC_H = [10, 11] as const;  // 3am, 4am PT
// Medium pool fraction: include the least-recently-played HALF of mediums so
// every medium airs over ~2 loops. The one tuning knob. With high ≈ medium
// total catalog duration, half the mediums ≈ half the high duration → the loop
// lands ~2/3 high / ~1/3 medium by time.
const MEDIUM_POOL_FRACTION = 0.5;

// Build the loop's pool: ALL highs + the least-recently-played half of mediums,
// fully shuffled together (priority order is intentionally random). The curated
// anchor archive (if any) is removed so it plays only in its pinned post-anchor
// slot. Mediums rotate — the stale half plays this loop, the rest next loop.
function selectPool(
  archives: EligibleArchive[],
  curatedId: string | null,
  rng: () => number,
): EligibleArchive[] {
  const pool = archives.filter((a) => a.id !== curatedId);
  const highs = pool.filter((a) => a.priority === 'high');
  // Least-recently-played first; undefined lastPlayedMs = never played = stalest.
  const mediumsByStaleness = pool
    .filter((a) => a.priority === 'medium')
    .sort((a, b) => (a.lastPlayedMs ?? 0) - (b.lastPlayedMs ?? 0));
  const half = Math.ceil(mediumsByStaleness.length * MEDIUM_POOL_FRACTION);
  const mediums = mediumsByStaleness.slice(0, half);
  // Shuffle highs and chosen mediums together — no priority spacing.
  return shuffle([...highs, ...mediums], rng);
}

// Effective wall-clock span of one archive in the loop = its duration minus the
// crossfade overlap into the next item, plus one interlude (also crossfaded).
function effectiveSpanMs(durationSec: number, avgInterludeSec: number): number {
  return (durationSec - CROSSFADE_SEC + avgInterludeSec - CROSSFADE_SEC) * 1000;
}

// Lay the WHOLE shuffled pool on the timeline from `segmentStartMs` (loops run
// as long as the catalog allows — ~2-3 days), then TRUNCATE the tail so the loop
// ends in the 3-4am PT window nearest the pool's natural end — regardless of
// priority. Whole archives only (an archive that would push past the boundary is
// dropped), so the loop ends just inside the dead zone. Dropped archives rotate
// into the next loop. With a tiny pool that can't reach the first boundary, the
// whole pool is kept.
function truncateAtEndWindow(
  pool: EligibleArchive[],
  segmentStartMs: number,
  avgInterludeSec: number,
): EligibleArchive[] {
  // Natural end if the whole pool played.
  const naturalEndMs = pool.reduce(
    (end, a) => end + effectiveSpanMs(a.durationSec, avgInterludeSec),
    segmentStartMs,
  );
  // Truncation can only SHORTEN, so target the LAST 3-4am PT window at-or-before
  // the natural end: the loop runs as long as possible while still ending in the
  // dead zone. The tail past that boundary is dropped (rotates into next loop).
  const boundaryMs = prevWindowMidMs(naturalEndMs, END_WINDOW_UTC_H[0]);
  const kept: EligibleArchive[] = [];
  let running = segmentStartMs;
  for (const a of pool) {
    const next = running + effectiveSpanMs(a.durationSec, avgInterludeSec);
    if (next > boundaryMs) break; // this archive would push past the boundary — stop
    kept.push(a);
    running = next;
  }
  // Tiny-pool safety: if the natural end is before the first boundary (pool too
  // short to reach any 3-4am window), keep the whole pool.
  return kept.length > 0 ? kept : pool;
}

// The [hourLo, hourLo+1) UTC window midpoint NEAREST `targetMs` (any direction).
// Used for the loop START — the 1-2am PT window closest to the previous loop's
// natural end, for gapless chaining.
function nearestWindowMidMs(targetMs: number, hourLo: number): number {
  const day = new Date(targetMs);
  day.setUTCHours(0, 0, 0, 0);
  let best = day.getTime() + (hourLo + 0.5) * 3600 * 1000;
  let bestDist = Math.abs(best - targetMs);
  for (let d = -1; d <= 1; d++) {
    const mid = day.getTime() + d * 86_400_000 + (hourLo + 0.5) * 3600 * 1000;
    const dist = Math.abs(mid - targetMs);
    if (dist < bestDist) { bestDist = dist; best = mid; }
  }
  return best;
}

// The LAST [hourLo, hourLo+1) UTC window midpoint at-or-before `beforeMs`. Used
// for the end boundary: truncation can only shorten, so we round DOWN to the
// previous 3-4am PT window. Returns -Infinity if none exists at-or-before
// (caller's tiny-pool safety keeps the whole pool in that case).
function prevWindowMidMs(beforeMs: number, hourLo: number): number {
  const day = new Date(beforeMs);
  day.setUTCHours(0, 0, 0, 0);
  for (let d = 1; d >= -6; d--) {
    const mid = day.getTime() + d * 86_400_000 + (hourLo + 0.5) * 3600 * 1000;
    if (mid <= beforeMs) return mid;
  }
  return Number.NEGATIVE_INFINITY;
}

// Decide loop N's startTimeMs + the ordered archive lists ("pour it in").
// Simple, catalog-driven, nothing hardcoded except the medium-pool fraction:
//   1. Build the pool: ALL highs + the least-recently-played half of mediums,
//      fully shuffled (selectPool). The curated anchor archive is removed so it
//      plays only in its pinned post-anchor slot.
//   2. Loop starts in the 1-2am PT window. Pour the WHOLE pool (loops run as long
//      as the catalog allows, ~2-3 days), then TRUNCATE the tail so the loop ends
//      at the last 3-4am PT window before the pool's natural end. Dropped tail
//      archives rotate into the next loop.
//   3. If a live block ("anchor") is coming up, split the pour at the block end:
//      pre-anchor archives fill start→block-end, the rest are post-anchor
//      (truncated to end 3-4am PT). generateLoop keeps the EXACT
//      backwards-from-anchor startTimeMs calc so the hand-back interlude +
//      curated archive land precisely on the live-block end.
async function resolveLoopPlan(
  args: GenerateLoopArgs,
  archives: EligibleArchive[],
  interstitials: Interstitial[],
): Promise<LoopPlan> {
  if (typeof args.startTimeMsOverride === 'number') {
    return { startTimeMs: args.startTimeMsOverride, anchor: null, preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'short', maxDurationSec: null, earliestStartMs: args.startTimeMsOverride, reason: 'override' };
  }
  const nowMs = args.nowMsOverride ?? Date.now();
  if (args.loopNumber <= 1) {
    return { startTimeMs: nowMs, anchor: null, preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'short', maxDurationSec: null, earliestStartMs: nowMs, reason: 'first-loop' };
  }
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');
  const rng = Math.random;

  // Previous loop's natural end. Loop N must never start before loop N-1 ends —
  // otherwise the new doc overlaps the currently-playing one mid-loop.
  const prev = await db.collection(LOOP_COLLECTION).doc(loopDocId(args.loopNumber - 1)).get();
  let prevNaturalEnd = nowMs;
  if (prev.exists) {
    const data = prev.data() ?? {};
    const prevStart = Number(data.startTimeMs ?? 0);
    const totalDurationSec = Number(data.totalDurationSec ?? 0);
    prevNaturalEnd = prevStart + totalDurationSec * 1000;
  }
  const earliestStartMs = Math.max(nowMs, prevNaturalEnd);

  // Loop start: the 1-2am PT window nearest prevNaturalEnd (gapless chaining —
  // the previous long loop ends ~3-4am PT, so the next loop's 1-2am start lands
  // just before that, with the higher loop number winning on the listener side).
  const startTimeMs = nearestWindowMidMs(prevNaturalEnd, START_WINDOW_UTC_H[0]);

  // Anchor: the first upcoming live block whose end falls after the loop starts
  // and within the loop's reachable span (~3 days). Optional.
  const anchorHorizonMs = startTimeMs + 72 * 3600 * 1000;
  const anchors = await loadAnchors(db, startTimeMs);
  const firstAnchor = anchors.find((a) => a.endTimeMs > startTimeMs && a.endTimeMs <= anchorHorizonMs) ?? null;
  const curatedId = firstAnchor?.curatedArchiveId ?? null;

  const avgInterludeSec = interstitials.length === 0
    ? 0
    : interstitials.reduce((s, i) => s + i.durationSec, 0) / interstitials.length;

  // Recency: stamp lastPlayedMs so the medium pick reaches for the half that
  // played least recently (rotates mediums over ~2 loops).
  const recentPlays = await loadRecentPlays(db, nowMs);
  for (const a of archives) {
    a.lastPlayedMs = recentPlays.get(a.id)?.lastPlayedMs;
  }

  // Build the pool: all highs + stale half of mediums, curated removed, shuffled.
  const pool = selectPool(archives, curatedId, rng);

  // Apply time-of-day diversity reorder to a segment (keeps repeats from landing
  // at the same wall-clock time-of-day two loops running).
  const diversify = (seg: EligibleArchive[], segStartMs: number): string[] =>
    reorderForTimeOfDayDiversity(seg, recentPlays, segStartMs, avgInterludeSec).map((a) => a.id);

  // ── No anchor: pour the whole pool from 1-2am PT, truncate so it ends at the
  // last 3-4am PT window before the pool's natural end. ──
  if (!firstAnchor) {
    const kept = truncateAtEndWindow(pool, startTimeMs, avgInterludeSec);
    return {
      startTimeMs,
      anchor: null,
      preAnchorArchiveIds: null,
      postAnchorArchiveIds: diversify(kept, startTimeMs),
      mode: 'short',
      maxDurationSec: null,
      earliestStartMs,
      reason: 'no-anchor',
    };
  }

  // ── Anchor: pour the pool from the start; archives that fit before the live
  // block's end are pre-anchor, the rest are post-anchor. The post-anchor tail
  // is then truncated to end at the last 3-4am PT window before its natural end.
  // Priority order stays random; both sides get a natural ~2:1 high/medium mix
  // from the shuffle.
  const blockEndMs = firstAnchor.endTimeMs;

  // Curated archive duration (plays right after the block, before post-anchor).
  let curatedDurSec = 0;
  if (curatedId) {
    const curated = archives.find((a) => a.id === curatedId);
    if (curated) curatedDurSec = curated.durationSec;
  }
  const postBlockStartMs = blockEndMs + (curatedDurSec - CROSSFADE_SEC) * 1000;

  // Split the shuffled pool at the live-block end: fill up to the block, rest
  // go after. Whole archives only (one that would straddle the block goes after).
  const preItems: EligibleArchive[] = [];
  const postPool: EligibleArchive[] = [];
  let running = startTimeMs;
  let blockReached = false;
  for (const a of pool) {
    const span = effectiveSpanMs(a.durationSec, avgInterludeSec);
    if (!blockReached && running + span <= blockEndMs) {
      preItems.push(a);
      running += span;
    } else {
      blockReached = true;
      postPool.push(a);
    }
  }
  // Truncate the post-anchor tail at the first 3-4am PT boundary it crosses.
  const postItems = truncateAtEndWindow(postPool, postBlockStartMs, avgInterludeSec);

  return {
    startTimeMs,
    anchor: firstAnchor,
    preAnchorArchiveIds: preItems.length > 0 ? diversify(preItems, startTimeMs) : null,
    postAnchorArchiveIds: postItems.length > 0 ? diversify(postItems, postBlockStartMs) : null,
    mode: 'short',
    maxDurationSec: null,
    earliestStartMs,
    reason: 'anchor',
  };
}

// Find the highest loopNumber currently stored. Returns 0 when the collection
// is empty (so caller can request loop #1 next).
export async function maxLoopNumber(): Promise<number> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');
  const snap = await db
    .collection(LOOP_COLLECTION)
    .orderBy('loopNumber', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return 0;
  const data = snap.docs[0].data();
  return Number(data.loopNumber ?? 0);
}

// Per-archive recency info: when (UTC seconds-of-day) and wall-clock ms it last
// played across recent loops. Drives two things: the medium pool pick (stalest
// half first) and the time-of-day reorder that lands a repeat ~8h off its prior
// slot so a listener at a given time-of-day doesn't hear the same show twice.
interface RecentPlay {
  // UTC seconds-of-day of the START of this archive's most-recent prior play.
  // 0–86399. Used modulo 86400 to compute time-of-day offsets.
  todStartSec: number;
  // Wall-clock ms of that same most-recent prior play. Used to order mediums
  // stalest-first when picking the half that goes into this loop.
  lastPlayedMs: number;
}

async function loadRecentPlays(
  db: FirebaseFirestore.Firestore,
  nowMs: number,
): Promise<Map<string, RecentPlay>> {
  // Loops now run multiple days, so a fixed 24h window would miss the previous
  // loop entirely. Look back far enough to capture the last couple of loops
  // (~4 days), which is what drives the "least-recently-played half of mediums"
  // rotation and the time-of-day diversity reorder.
  const windowStartMs = nowMs - 4 * 24 * 3600 * 1000;
  const out = new Map<string, RecentPlay>();
  const snap = await db
    .collection(LOOP_COLLECTION)
    .orderBy('loopNumber', 'desc')
    .limit(3)
    .get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const loopStartMs = Number(d.startTimeMs ?? 0);
    if (!loopStartMs) continue;
    const items: Array<{ kind: string; archiveId?: string; startOffsetSec?: number; durationSec?: number }> = Array.isArray(d.items) ? d.items : [];
    for (const it of items) {
      if (it.kind !== 'archive' || !it.archiveId) continue;
      const offsetSec = Number(it.startOffsetSec ?? 0);
      const durSec = Number(it.durationSec ?? 0);
      const itemStartMs = loopStartMs + offsetSec * 1000;
      const itemEndMs = itemStartMs + durSec * 1000;
      if (itemEndMs > windowStartMs && itemStartMs < nowMs) {
        const todStartSec = Math.floor((itemStartMs % 86_400_000) / 1000);
        // Keep the most-recent play (loop docs are scanned newest-first).
        if (!out.has(it.archiveId)) {
          out.set(it.archiveId, { todStartSec, lastPlayedMs: itemStartMs });
        }
      }
    }
  }
  return out;
}

// Reorder a chosen subset so that archives which already played in the last 24h
// land at a wall-clock time-of-day with the largest available offset from
// yesterday's slot — aiming for 8h (mod 24h), accepting closest-available when
// a small subset can't hit 8h. Fresh archives (not in `recentPlays`) fill any
// remaining slots in their existing order.
//
// `subset` is an ordered list of archives the subset search picked. `startMs`
// is the wall-clock moment the FIRST item in the block starts (audible). The
// algorithm projects each slot's wall-clock start using cumulative durations
// and avgInterludeSec (matches what buildLoop will produce).
function reorderForTimeOfDayDiversity(
  subset: EligibleArchive[],
  recentPlays: Map<string, RecentPlay>,
  startMs: number,
  avgInterludeSec: number,
): EligibleArchive[] {
  if (subset.length <= 1) return subset;
  const CROSSFADE_SEC = 5;
  // Compute projected start-of-slot time-of-day (UTC seconds) for each slot
  // index. Slot i starts at startMs + (sum of durations up to i) + i *
  // (avgInterlude - crossfade). We don't know which archive ends up in which
  // slot yet, so use the AVERAGE archive duration for projection — close
  // enough given catalog durations cluster around 60-120 min.
  const avgArchiveSec = subset.reduce((s, a) => s + a.durationSec, 0) / subset.length;
  const slotTODs: number[] = [];
  for (let i = 0; i < subset.length; i++) {
    const slotStartMs = startMs + i * (avgArchiveSec + avgInterludeSec - CROSSFADE_SEC) * 1000;
    slotTODs.push(Math.floor((slotStartMs % 86_400_000) / 1000));
  }
  // Split subset into repeats (have a yesterdayTOD constraint) and fresh.
  const repeats: EligibleArchive[] = [];
  const fresh: EligibleArchive[] = [];
  for (const a of subset) {
    if (recentPlays.has(a.id)) repeats.push(a);
    else fresh.push(a);
  }
  if (repeats.length === 0) return subset;
  // For each repeat archive, score each slot by |offset - 8h| (mod 24h).
  // Lower score = closer to ideal 8h offset. Greedy assignment: pick best
  // (archive, slot) pair, mark slot taken, repeat until all repeats placed.
  const IDEAL_OFFSET_SEC = 8 * 3600;
  const DAY_SEC = 24 * 3600;
  const slotTaken: boolean[] = new Array(subset.length).fill(false);
  const assignment = new Array<EligibleArchive | null>(subset.length).fill(null);
  for (const repeat of repeats) {
    const ytod = recentPlays.get(repeat.id)!.todStartSec;
    let bestSlot = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < subset.length; i++) {
      if (slotTaken[i]) continue;
      const slotTod = slotTODs[i];
      // Circular distance in [0, 12h]; offset closer to 8h wins.
      let diff = Math.abs(slotTod - ytod);
      if (diff > DAY_SEC / 2) diff = DAY_SEC - diff;
      const score = Math.abs(diff - IDEAL_OFFSET_SEC);
      if (score < bestScore) {
        bestScore = score;
        bestSlot = i;
      }
    }
    if (bestSlot >= 0) {
      assignment[bestSlot] = repeat;
      slotTaken[bestSlot] = true;
    }
  }
  // Fill remaining slots with fresh archives in their existing order.
  let freshIdx = 0;
  for (let i = 0; i < subset.length; i++) {
    if (assignment[i] === null && freshIdx < fresh.length) {
      assignment[i] = fresh[freshIdx++];
    }
  }
  return assignment.filter((a): a is EligibleArchive => a !== null);
}

// Load upcoming live broadcast-slot boundaries within ~48h of the loop start.
// Used to align the loop so item boundaries land at live-block ends. Slots
// with status 'scheduled' or 'live' are considered (others won't play). Only
// one Firestore range filter (endTime > start) is used; startTime is filtered
// client-side — mirrors hasActiveOrImminentBroadcastSlot in
// useBroadcastLiveStatus.ts.
async function loadAnchors(
  db: FirebaseFirestore.Firestore,
  loopStartTimeMs: number,
): Promise<LiveBlockBoundary[]> {
  const horizonMs = loopStartTimeMs + 48 * 3600 * 1000;
  // Use >= so a slot whose endTime EXACTLY equals loopStartTimeMs is still
  // included — that's the "anchor at offset 0" case where the loop's first
  // item lands at the moment this slot's block ends.
  const snap = await db.collection('broadcast-slots')
    .where('endTime', '>=', Timestamp.fromMillis(loopStartTimeMs))
    .get();
  const rawSlots: Array<{ startTimeMs: number; endTimeMs: number; postLiveArchiveId: string | null }> = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status !== 'scheduled' && d.status !== 'live') continue;
    const startTs = d.startTime as Timestamp | undefined;
    const endTs = d.endTime as Timestamp | undefined;
    if (!startTs || !endTs) continue;
    const startMs = startTs.toMillis();
    if (startMs >= horizonMs) continue;
    rawSlots.push({
      startTimeMs: startMs,
      endTimeMs: endTs.toMillis(),
      postLiveArchiveId: typeof d.postLiveArchiveId === 'string' ? d.postLiveArchiveId : null,
    });
  }
  return computeLiveBlocks(rawSlots);
}

// Generate a single loop and write it to Firestore. Replaces an existing loop
// at the same number unless `locked` is set (and `force` isn't).
export async function generateLoop(args: GenerateLoopArgs): Promise<GenerateLoopResult> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');

  const { loopNumber } = args;
  if (!Number.isInteger(loopNumber) || loopNumber < 1) {
    throw new Error(`invalid loopNumber: ${loopNumber}`);
  }
  const docRef = db.collection(LOOP_COLLECTION).doc(loopDocId(loopNumber));
  const existing = await docRef.get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (data.locked === true && !args.force) {
      return {
        loopNumber,
        itemCount: 0,
        totalDurationSec: 0,
        startTimeMs: Number(data.startTimeMs ?? 0),
        highCount: 0,
        mediumCount: 0,
        interstitialCount: 0,
        alignedAnchorCount: 0,
        missedAnchorCount: 0,
        warnings: [],
        skipped: 'locked',
      };
    }
  }

  const archives = await loadEligibleArchives();
  const interstitials: Interstitial[] = [];
  try {
    const ixSnap = await db.collection(INTERSTITIALS_COLLECTION).get();
    for (const doc of ixSnap.docs) {
      const d = doc.data();
      if (!d.url || !d.durationSec) continue;
      interstitials.push({
        id: doc.id,
        url: d.url,
        durationSec: Number(d.durationSec),
        label: d.label,
        uploadedAtMs: Number(d.uploadedAtMs ?? 0),
      });
    }
  } catch {
    // Collection doesn't exist yet — fine, skip interstitials.
  }
  // Resolve plan: startTimeMs + (optionally) the anchor + pre-anchor archive
  // subset that places the anchor interlude at the right cumulative offset.
  const plan = await resolveLoopPlan(args, archives, interstitials);
  const result = buildLoop({
    archives,
    interstitials,
    mode: plan.mode,
    anchor: plan.anchor ?? undefined,
    preAnchorArchiveIds: plan.preAnchorArchiveIds ?? undefined,
    postAnchorArchiveIds: plan.postAnchorArchiveIds ?? undefined,
    maxDurationSec: plan.maxDurationSec ?? undefined,
  });

  // Two-pass exact alignment. The MITM picked the pre-anchor subset using the
  // average interlude duration as a stand-in; the actual interludes random-
  // picked by buildLoop differ slightly. Find the anchor interlude (= the
  // interstitial immediately before the curated/anchor archive) in the built
  // items array and shift startTimeMs so its audible fade-in begins exactly
  // at anchor.endTimeMs.
  //
  // The schedule's startOffsetSec already encodes "when audio becomes
  // audible" (CROSSFADE_SEC subtracted between transitions in buildLoop's
  // cumulative pass). So aligning the schedule offset with the anchor moment
  // also aligns the audible fade-in moment — no extra CROSSFADE shift needed.
  let startTimeMs = plan.startTimeMs;
  if (plan.anchor && plan.preAnchorArchiveIds !== null) {
    let anchorArchiveIdx = -1;
    if (plan.anchor.curatedArchiveId) {
      anchorArchiveIdx = result.items.findIndex(
        (it) => it.kind === 'archive' && it.archiveId === plan.anchor!.curatedArchiveId,
      );
    }
    if (anchorArchiveIdx < 0) {
      // buildLoop assembly order: [startInt, pa0, int, pa1, int, ..., pa(N-1),
      // anchorInt, anchorArchive, restInt, rest...]
      // anchorArchive index = 1 (startInt) + N (pre-anchor archives)
      //                       + (N-1) (interludes between pre-anchors)
      //                       + 1 (anchor interlude) = 2N + 1
      const preLen = plan.preAnchorArchiveIds.length;
      anchorArchiveIdx = 2 * preLen + 1;
    }
    if (anchorArchiveIdx > 0 && result.items[anchorArchiveIdx - 1].kind === 'interstitial') {
      const anchorInterludeOffset = result.items[anchorArchiveIdx - 1].startOffsetSec;
      // Warmup: the listener-side audio source switch (live → radio) takes a
      // few seconds (Rule B's 2s debounce + audio element load + observed
      // extra slack). Push the anchor interlude's audible start to
      // anchor.endTimeMs + warmup so the listener lands at interlude offset 0
      // after switching sources, hearing the full interlude before the
      // normal 5s crossfade into the curated archive. History: 2s originally,
      // bumped to 4s on 2026-06-04 after clipping reports (weed convo birds,
      // bilaliwood handoff), tightened to 3s on 2026-06-11 per Cap.
      const ANCHOR_WARMUP_MS = 3000;
      startTimeMs = plan.anchor.endTimeMs + ANCHOR_WARMUP_MS - anchorInterludeOffset * 1000;
    }
  }
  // Small overlap with the previous loop is intentional: useArchiveRadio
  // picks the highest-loopNumber loop whose startTimeMs has passed, so when
  // loop N's start arrives, listeners cross over from N-1. The 1-3 AM PT
  // window already sits BEFORE loop N-1's natural end (which is itself in
  // 1-3 AM PT a day later), giving a clean handoff.
  // Guard against unbounded backwards drift: cap overlap at 4 hours.
  const MAX_OVERLAP_MS = 4 * 3600 * 1000;
  if (startTimeMs < plan.earliestStartMs - MAX_OVERLAP_MS) {
    startTimeMs = plan.earliestStartMs - MAX_OVERLAP_MS;
  }
  const generatedAtMs = Date.now();

  // Firestore rejects undefined values; sanitize before write.
  const cleanItems: Record<string, unknown>[] = result.items.map((it) => {
    const obj: Record<string, unknown> = {
      kind: it.kind,
      recordingUrl: it.recordingUrl,
      durationSec: it.durationSec,
      startOffsetSec: it.startOffsetSec,
    };
    if (it.archiveId) obj.archiveId = it.archiveId;
    if (it.interstitialId) obj.interstitialId = it.interstitialId;
    if (it.title) obj.title = it.title;
    if (it.djs?.length) obj.djs = it.djs.map((dj) => {
      const o: Record<string, unknown> = { name: dj.name };
      if (dj.username) o.username = dj.username;
      if (dj.photoUrl) o.photoUrl = dj.photoUrl;
      return o;
    });
    if (it.artworkUrl) obj.artworkUrl = it.artworkUrl;
    if (it.sceneSlugs?.length) obj.sceneSlugs = it.sceneSlugs;
    return obj;
  });

  await docRef.set({
    loopNumber,
    startTime: Timestamp.fromMillis(startTimeMs),
    startTimeMs,
    totalDurationSec: result.totalDurationSec,
    generatedAt: Timestamp.fromMillis(generatedAtMs),
    generatedAtMs,
    generatedBy: args.generatedBy ?? 'cron',
    locked: false,
    mode: plan.mode,
    planReason: plan.reason,
    catalogStats: {
      highCount: result.highCount,
      mediumCount: result.mediumCount,
      placedHighDurationSec: result.placedHighDurationSec,
      placedMediumDurationSec: result.placedMediumDurationSec,
      interstitialCount: result.interstitialCount,
      alignedAnchorCount: result.alignedAnchorCount,
      missedAnchorCount: result.missedAnchorCount,
      totalItems: result.items.length,
    },
    items: cleanItems,
  });

  return {
    loopNumber,
    itemCount: result.items.length,
    totalDurationSec: result.totalDurationSec,
    startTimeMs,
    highCount: result.highCount,
    mediumCount: result.mediumCount,
    interstitialCount: result.interstitialCount,
    alignedAnchorCount: result.alignedAnchorCount,
    missedAnchorCount: result.missedAnchorCount,
    warnings: result.warnings,
  };
}

// Idempotent: ensures a loop exists whose startTimeMs > now. If the latest
// stored loop's end is in the future, do nothing. Otherwise generate the next
// loop. Used by the cron + the listener-side "ending soon" trigger.
export async function ensureNextLoop(args: { generatedBy?: 'cron' | 'admin' } = {}): Promise<GenerateLoopResult | { skipped: 'already-future'; loopNumber: number }> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');
  const now = Date.now();
  const latestSnap = await db
    .collection(LOOP_COLLECTION)
    .orderBy('loopNumber', 'desc')
    .limit(1)
    .get();
  if (!latestSnap.empty) {
    const data = latestSnap.docs[0].data();
    const startTimeMs = Number(data.startTimeMs ?? 0);
    const totalDurationSec = Number(data.totalDurationSec ?? 0);
    const endMs = startTimeMs + totalDurationSec * 1000;
    if (endMs > now) {
      // Latest loop hasn't ended yet AND a loop after it would only be
      // needed if we're inside the last loop. The cron's job is to make sure
      // there's *always* a loop ready to play after the current one.
      // So when the latest loop is the *currently playing* one (startTimeMs
      // <= now < endMs), we still need to generate the next one.
      const isCurrentlyPlaying = startTimeMs <= now && now < endMs;
      if (!isCurrentlyPlaying) {
        // A future loop already exists. Normally idempotent-skip — UNLESS a new
        // anchor (live block) was scheduled INSIDE this future loop's span after
        // it was generated. The stored loop, built with no anchor, would play
        // straight through the live block with no hand-back. Regenerate (force)
        // so the interlude + curated archive land on the block end. The
        // currently-playing loop is handled above, so a live listener is never
        // disrupted. (The cron only ever stores maxLoopNumber+1, so the latest
        // stored loop is the only future loop to check.)
        const loopNumber = Number(data.loopNumber ?? 0);
        const locked = data.locked === true;
        const storedReason = String(data.planReason ?? '');
        const storedAligned = Number(data.catalogStats?.alignedAnchorCount ?? 0);
        if (!locked && storedReason !== 'anchor' && storedAligned === 0) {
          const anchorHorizonMs = startTimeMs + 72 * 3600 * 1000;
          const anchors = await loadAnchors(db, startTimeMs);
          const newAnchor = anchors.find(
            (a) => a.endTimeMs > startTimeMs && a.endTimeMs <= anchorHorizonMs,
          );
          if (newAnchor) {
            return generateLoop({ loopNumber, force: true, generatedBy: args.generatedBy });
          }
        }
        return { skipped: 'already-future', loopNumber };
      }
    }
  }
  const next = (await maxLoopNumber()) + 1;
  return generateLoop({ loopNumber: next, generatedBy: args.generatedBy });
}
