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
  reflowOffsets,
  SCHEDULE_COLLECTION,
  shuffle,
  tallyRecentPlays,
  utcDayStartMs,
} from '@/lib/archive-schedule';
import type {
  ArchiveScheduleDay,
  Interstitial,
  ScheduleItem,
  Tempo,
} from '@/types/broadcast';
import { normalizeUsername } from '@/lib/dj-matching';

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
            ? normalizeUsername(data.chatUsername)
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
          const key = normalizeUsername(dj.username);
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
      tempo: (d.tempo as Tempo | undefined) ?? undefined,
    });
  }

  // Interstitials are optional; v1 ships with the collection empty.
  const interstitials: Interstitial[] = [];
  try {
    const ixSnap = await db.collection(INTERSTITIALS_COLLECTION).get();
    for (const doc of ixSnap.docs) {
      const d = doc.data();
      if (!d.url || !d.durationSec) continue;
      // Retired from the rotation: doc kept (so already-built loops still
      // resolve its URL) but excluded from future loop generation.
      if (d.disabledForLoops) continue;
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
    if (it.tempo) obj.tempo = it.tempo;
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
// Build the userId/username → sceneIds maps used to derive an archive's scenes.
async function loadSceneMaps(db: FirebaseFirestore.Firestore): Promise<{
  sceneByUserId: Map<string, string[]>;
  sceneByUsername: Map<string, string[]>;
}> {
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
            ? normalizeUsername(data.chatUsername)
            : null;
      if (normalized) sceneByUsername.set(normalized, sceneIds);
    }
  } catch (err) {
    console.warn('[archive-schedule-server] scene map fetch failed; items will have no sceneSlugs', err);
  }
  return { sceneByUserId, sceneByUsername };
}

// Map a raw archive doc → EligibleArchive. `forced` skips the public/priority
// gates (used ONLY for archives explicitly pinned as an anchor's curated
// archive — see forceIncludeAnchorArchives). Returns null when the archive
// can't actually play (no recordingUrl / too short) or fails the eligibility
// gates and isn't forced.
function mapArchiveDoc(
  id: string,
  d: FirebaseFirestore.DocumentData,
  scenes: { sceneByUserId: Map<string, string[]>; sceneByUsername: Map<string, string[]> },
  forced: boolean,
): EligibleArchive | null {
  if (d.uploadStatus === 'uploading') return null;
  // Eligibility gates — bypassed for a forced (anchored) archive. A pinned
  // anchor must play even when it's private/hidden, but a non-anchored archive
  // with those flags must still be excluded from the general radio pool.
  if (!forced) {
    if (d.isPublic === false) return null;
    const rawPriority = (d.priority || 'medium') as string;
    if (rawPriority !== 'featured' && rawPriority !== 'high' && rawPriority !== 'medium') return null;
  }
  const rawPriority = (d.priority || 'medium') as string;
  // Featured behaves exactly like high in the loop. A forced archive at any
  // other tier (low/hidden) plays as 'medium' — tier only affects pool
  // selection, which the anchor bypasses anyway.
  const priority: 'high' | 'medium' =
    rawPriority === 'featured' || rawPriority === 'high' ? 'high' : 'medium';
  const recordingUrl: string | undefined = d.recordingUrl;
  const durationSec: number = Number(d.duration || 0);
  // A playable file is non-negotiable even when forced. The 30-min floor is a
  // pool-quality rule, so a forced anchor is allowed to be shorter.
  if (!recordingUrl || !durationSec) return null;
  if (!forced && durationSec < 30 * 60) return null;
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
        const ids = scenes.sceneByUserId.get(dj.userId);
        if (ids) ids.forEach((sid) => set.add(sid));
      }
      if (dj.username) {
        const key = normalizeUsername(dj.username);
        const ids = scenes.sceneByUsername.get(key);
        if (ids) ids.forEach((sid) => set.add(sid));
      }
    }
    if (set.size > 0) sceneSlugs = Array.from(set);
  }

  return {
    id,
    recordingUrl,
    durationSec,
    priority,
    title: (d.showName as string) || (d.slug as string) || 'Archive',
    djs,
    artworkUrl: d.showImageUrl,
    sceneSlugs,
    tempo: (d.tempo as Tempo | undefined) ?? undefined,
  };
}

async function loadEligibleArchives(): Promise<EligibleArchive[]> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');

  const scenes = await loadSceneMaps(db);
  const archivesSnap = await db.collection('archives').get();
  const archives: EligibleArchive[] = [];
  for (const doc of archivesSnap.docs) {
    const mapped = mapArchiveDoc(doc.id, doc.data(), scenes, false);
    if (mapped) archives.push(mapped);
  }
  return archives;
}

// Force-include archives that are pinned as an upcoming anchor's curated
// archive but were filtered out of the general pool (private / hidden / below
// the 30-min floor). SCOPED to anchored archives only — a hidden/private
// archive that is NOT an anchor stays out of the radio. Without this, buildLoop
// can't find the curated archive and substitutes a random one (wrong show at
// the anchor's time), and the player can't resolve its metadata.
async function forceIncludeAnchorArchives(
  archives: EligibleArchive[],
  anchorArchiveIds: string[],
): Promise<EligibleArchive[]> {
  const db = getAdminDb();
  if (!db) return archives;
  const have = new Set(archives.map((a) => a.id));
  const missing = Array.from(new Set(anchorArchiveIds)).filter((id) => id && !have.has(id));
  if (missing.length === 0) return archives;

  const scenes = await loadSceneMaps(db);
  for (const id of missing) {
    try {
      const snap = await db.collection('archives').doc(id).get();
      if (!snap.exists) continue;
      const mapped = mapArchiveDoc(snap.id, snap.data()!, scenes, true);
      if (mapped) {
        archives.push(mapped);
        console.log(`[archive-schedule-server] force-included anchored archive ${id} (bypassed eligibility gates)`);
      }
    } catch (err) {
      console.warn(`[archive-schedule-server] failed to force-include anchor archive ${id}:`, err);
    }
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
  // When true, build the loop fully but DO NOT write it to Firestore — return
  // the computed items/startTimeMs/counts so callers can inspect what WOULD be
  // generated without mutating any doc. Used by test harnesses.
  dryRun?: boolean;
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
  // Additional anchors (beyond the first) that fall inside this loop's span.
  // The first anchor drives the loop START (back-shift alignment); these are
  // spliced MID-LOOP in generateLoop by cutting short the pool archive playing
  // into each one, then inserting a hand-back interlude + curated archive that
  // lands audible exactly on the anchor's target. Sorted by target ascending.
  laterAnchors: LiveBlockBoundary[];
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
// Warmup for a LIVE/RESTREAM anchor hand-back: the listener-side audio source
// switch (live → radio) takes a moment, so the post-block interlude is made
// audible at endTimeMs + warmup. SCHEDULED anchors (broadcastType:'anchor') have
// no source switch (radio is already playing) and use warmup 0, aligned to start.
// History: 2s → 4s (2026-06-04 clipping) → 3s (2026-06-11) → 1s (2026-07-15 per Cap).
const ANCHOR_WARMUP_MS = 1000;
// Start window: 1-2am PT. End window: 3-4am PT. Both are wall-clock targets the
// loop snaps to; loop length flexes (in whole days) to land start in one and end
// in the other. Expressed as UTC hours-of-day (PDT = UTC-7; ±1h in PST months).
const START_WINDOW_UTC_H = [8, 9] as const;  // 1am, 2am PT
const END_WINDOW_UTC_H = [10, 11] as const;  // 3am, 4am PT
// Hard cap on how far ahead a single loop schedules anchors. A scheduled anchor
// hours past the pool's natural end (e.g. a next-day 8pm slot) would otherwise
// force the loop to stretch to ~70h and end at an odd hour just to reach it.
// Anchors beyond this horizon are DEFERRED to the next loop (the cron's
// look-back catches them). 50h comfortably covers a ~48h loop's own playtime.
const MAX_ANCHOR_HORIZON_MS = 50 * 3600 * 1000;

// An anchor counts as "already covered" by a stored loop only if that loop
// places its curated archive AND lands it within this tolerance of the slot
// time. Absorbs crossfade/rounding jitter (a few seconds) but NOT real drift — a
// mis-placed anchor (e.g. 28 min late) is NOT covered, so the next loop re-anchors
// it. Used to skip anchors the still-playing loop already handles, so the next
// loop back-aligns to the first MISSING anchor (not one already on-air on-time).
const ANCHOR_COVERED_TOLERANCE_MS = 10 * 1000;

// When the currently-playing loop is still the latest stored, ensureNextLoop
// builds its successor ONLY when there's a real reason to — never eagerly (an
// eager build back-dates its start to the soonest anchor and supersedes the
// playing loop, reshuffling daytime audio: the 2026-07-17 incident). Reasons:
//   • the playing loop ends within NEXT_LOOP_END_LEAD_MS (running low on runway), OR
//   • a MISSING anchor (not already placed on-target) lands within
//     NEXT_LOOP_ANCHOR_LOOKAHEAD_MS (a live show the playing loop won't hand off to).
const NEXT_LOOP_END_LEAD_MS = 28 * 3600 * 1000;
const NEXT_LOOP_ANCHOR_LOOKAHEAD_MS = 24 * 3600 * 1000;

// Does the stored loop (its items + start) already place this anchor's curated
// archive audible within tolerance of the anchor's target moment?
function loopCoversAnchor(
  loopStartMs: number,
  loopItems: ScheduleItem[],
  anchor: LiveBlockBoundary,
): boolean {
  if (!anchor.curatedArchiveId) return false;
  const target = anchor.isScheduledAnchor
    ? anchor.startTimeMs
    : anchor.endTimeMs + ANCHOR_WARMUP_MS;
  for (const it of loopItems) {
    if (it.kind !== 'archive' || it.archiveId !== anchor.curatedArchiveId) continue;
    const audibleMs = loopStartMs + it.startOffsetSec * 1000;
    if (Math.abs(audibleMs - target) <= ANCHOR_COVERED_TOLERANCE_MS) return true;
  }
  return false;
}

// Build the loop's pool: ALL highs + ALL mediums, fully shuffled together
// (priority order is intentionally random). The curated anchor archive (if any)
// is removed so it plays only in its pinned post-anchor slot. Every eligible show
// plays once; the end-window truncation trims the tail to end in the 3-4am PT
// window (~3 days out with the full catalog).
function selectPool(
  archives: EligibleArchive[],
  curatedIds: Set<string>,
  rng: () => number,
): EligibleArchive[] {
  // Every anchor's curated archive is excluded from the random pool: an anchored
  // show plays ONLY at its anchor point(s) in this loop, never additionally in
  // the rotation (no echo). It returns to normal rotation in loops where it
  // isn't anchored.
  const pool = archives.filter((a) => !curatedIds.has(a.id));
  const highs = pool.filter((a) => a.priority === 'high');
  const mediums = pool.filter((a) => a.priority === 'medium');
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

// The FIRST [hourLo, hourLo+1) UTC window midpoint at-or-after `afterMs`. Used to
// find the NEXT quiet start window (1-2am PT) a loop may begin at — so a next
// loop never starts in a past window, and covers anchors from that window on.
function nextWindowMidMs(afterMs: number, hourLo: number): number {
  const day = new Date(afterMs);
  day.setUTCHours(0, 0, 0, 0);
  for (let d = -1; d <= 6; d++) {
    const mid = day.getTime() + d * 86_400_000 + (hourLo + 0.5) * 3600 * 1000;
    if (mid >= afterMs) return mid;
  }
  return afterMs;
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
    return { startTimeMs: args.startTimeMsOverride, anchor: null, laterAnchors: [], preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'short', maxDurationSec: null, earliestStartMs: args.startTimeMsOverride, reason: 'override' };
  }
  const nowMs = args.nowMsOverride ?? Date.now();
  if (args.loopNumber <= 1) {
    return { startTimeMs: nowMs, anchor: null, laterAnchors: [], preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'short', maxDurationSec: null, earliestStartMs: nowMs, reason: 'first-loop' };
  }
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');
  const rng = Math.random;

  // Previous loop's natural end. Loop N must never start before loop N-1 ends —
  // otherwise the new doc overlaps the currently-playing one mid-loop.
  const prev = await db.collection(LOOP_COLLECTION).doc(loopDocId(args.loopNumber - 1)).get();
  let prevNaturalEnd = nowMs;
  let prevStart = nowMs;
  let prevItems: ScheduleItem[] = [];
  if (prev.exists) {
    const data = prev.data() ?? {};
    prevStart = Number(data.startTimeMs ?? 0);
    const totalDurationSec = Number(data.totalDurationSec ?? 0);
    prevNaturalEnd = prevStart + totalDurationSec * 1000;
    prevItems = Array.isArray(data.items) ? (data.items as ScheduleItem[]) : [];
  }
  const earliestStartMs = Math.max(nowMs, prevNaturalEnd);

  // ANCHOR SELECTION base: look back over the PREVIOUS loop's FULL span (from its start),
  // so an anchor that falls INSIDE the currently-playing loop is still selectable — that's
  // how the next loop catches an anchor the playing loop didn't account for, WITHOUT ever
  // regenerating the playing loop. (selBase only scopes which anchors are visible; the
  // actual start is computed below.)
  const selBase = prevWindowMidMs(prevStart, START_WINDOW_UTC_H[0]);
  let startTimeMs = selBase;

  // Anchor: the SOONEST upcoming (still-in-the-future) live block within the loop's
  // reachable span. `endTimeMs > nowMs` so we never "catch" an anchor that already passed.
  //
  // The horizon has two jobs that must NOT share the same base:
  //   • LOOK-BACK  — catch an anchor that falls inside the still-playing previous
  //     loop (so the next loop can cover it without regenerating the playing one).
  //     That floor is `selBase` (prev loop's start window), enforced by the
  //     `endTimeMs > selBase` filter and loadAnchors' Firestore floor.
  //   • LOOK-AHEAD — cover anchors during THIS loop's own ~48-50h playtime. The
  //     forward reach must be measured from where this loop actually starts
  //     (≈ prevNaturalEnd), NOT from selBase. With long prev loops, selBase sits
  //     ~50h before this loop even begins, so `selBase + 72h` ended BEFORE this
  //     loop's playtime — silently dropping every anchor during the loop (e.g.
  //     loop 32 missed the Jun-28 8am PT show: selBase+72h landed 2h before the
  //     loop started). Anchor the forward reach to the loop's start instead.
  const anchorHorizonMs = Math.max(earliestStartMs, selBase) + 72 * 3600 * 1000;
  // Load slots from selBase (the look-back floor) out to the full look-ahead
  // horizon the selector below uses — same window for loader and selector, else
  // an in-window anchor gets dropped (loadAnchors' old 48h default did exactly that).
  const anchors = await loadAnchors(db, selBase, anchorHorizonMs - selBase);

  // Audible target (wall-clock) of an anchor's hand-in: scheduled anchors play
  // the recording IN the loop at their slot start (no warmup); post-live anchors
  // play the curated archive after the block, behind an interlude that starts
  // endTime + warmup.
  const anchorTarget = (a: LiveBlockBoundary) =>
    a.isScheduledAnchor ? a.startTimeMs : a.endTimeMs + ANCHOR_WARMUP_MS;

  // The loop starts at the NEXT quiet window (1-2am PT) at/after now, and covers
  // anchors from that window forward. It MAY start before the previous loop ends
  // (intentional overlap) so it takes over and covers anchors the still-playing
  // previous loop MISSED — e.g. loop-0046 (built before multi-anchor) has
  // tomorrow's Apok + agraybé in its span but never placed them; loop-0047 starts
  // 1am tomorrow and hands them off. An anchor BEFORE the next quiet window
  // (e.g. Carhartt tonight, before tomorrow 1am) stays with the current loop.
  const nextQuietWindowMs = nextWindowMidMs(nowMs, START_WINDOW_UTC_H[0]);
  const inHorizon = anchors.filter(
    (a) =>
      anchorTarget(a) >= nextQuietWindowMs &&
      a.endTimeMs <= anchorHorizonMs &&
      // Skip anchors the still-playing previous loop ALREADY places on-target, so
      // this loop back-aligns to the first MISSING anchor — not one already on-air
      // on time (that would back-date the start into the past and supersede the
      // playing loop, reshuffling daytime audio for no reason). The match is per
      // slot (archiveId + this slot's target), so the SAME show scheduled twice at
      // different times is only excluded at the occurrence the prev loop covers.
      !loopCoversAnchor(prevStart, prevItems, a),
  );
  const firstAnchor = inHorizon[0] ?? null;
  const curatedId = firstAnchor?.curatedArchiveId ?? null;

  // Every anchor's curated archive is kept out of the random pool (anchor-only
  // in this loop). Includes the first anchor's curated id.
  const anchorCuratedIds = new Set<string>(
    inHorizon.map((a) => a.curatedArchiveId).filter((id): id is string => !!id),
  );

  // The single alignment TARGET: the wall-clock moment the anchor archive (well,
  // the TT interlude → anchor archive hand-in) becomes audible. The ONLY thing
  // that differs between the two anchor kinds:
  //   • SCHEDULED anchor → the recording plays IN the loop at its slot startTime,
  //     no warmup (radio is already playing).
  //   • POST-LIVE anchor → the curated archive plays AFTER the live block, behind
  //     an interlude that starts endTime + warmup (live→radio source switch).
  // Everything downstream (back-fill, TT, post-fill, reflow) is identical.
  const anchorTargetMs = firstAnchor
    ? (firstAnchor.isScheduledAnchor ? firstAnchor.startTimeMs : firstAnchor.endTimeMs + ANCHOR_WARMUP_MS)
    : 0;

  // ANCHOR start: the loop starts at the 1-2am PT window before the first anchor
  // so it can take over and hand off cleanly — floored at `now` so it never starts
  // in a PAST window (which would supersede the playing loop mid-show). It MAY
  // start before prevNaturalEnd (intentional overlap) to cover anchors the still-
  // playing previous loop missed. Note we no longer clamp the window base to
  // prevNaturalEnd — that clamp pushed the start past the anchor when the prev
  // loop outlasts it; the anchor is what the start must precede.
  if (firstAnchor) {
    startTimeMs = Math.max(
      nowMs,
      prevWindowMidMs(anchorTargetMs, START_WINDOW_UTC_H[0]),
    );
  }

  const avgInterludeSec = interstitials.length === 0
    ? 0
    : interstitials.reduce((s, i) => s + i.durationSec, 0) / interstitials.length;

  // Recency: stamp lastPlayedMs so the medium pick reaches for the half that
  // played least recently (rotates mediums over ~2 loops).
  const recentPlays = await loadRecentPlays(db, nowMs);
  for (const a of archives) {
    a.lastPlayedMs = recentPlays.get(a.id)?.lastPlayedMs;
  }

  // Build the pool: all highs + as many mediums as needed to reach ~72h, curated
  // removed, shuffled. UNIQUE shows only — no repeats. The end-window truncation
  // trims to the nearest 3-4am PT window; loop length flexes with the catalog.
  const pool = selectPool(archives, anchorCuratedIds, rng);

  // Apply time-of-day diversity reorder to a segment (keeps repeats from landing
  // at the same wall-clock time-of-day two loops running).
  const diversify = (seg: EligibleArchive[], segStartMs: number): string[] =>
    reorderForTimeOfDayDiversity(seg, recentPlays, segStartMs, avgInterludeSec).map((a) => a.id);

  // ── No anchor: it's a radio — just CONTINUE. The next loop starts EXACTLY when the
  // previous loop ends (no overlap, no window snap). Overlap exists only to hand off to
  // an anchor; with no anchor there's no reason to jump/overlap. Truncate so it ends at
  // the last 3-4am PT window before the pool's natural end. ──
  if (!firstAnchor) {
    const noAnchorStart = prevNaturalEnd;
    const kept = truncateAtEndWindow(pool, noAnchorStart, avgInterludeSec);
    return {
      startTimeMs: noAnchorStart,
      anchor: null,
      laterAnchors: [],
      preAnchorArchiveIds: null,
      postAnchorArchiveIds: diversify(kept, noAnchorStart),
      mode: 'short',
      maxDurationSec: null,
      earliestStartMs,
      reason: 'no-anchor',
    };
  }

  // ── Anchor: pour the pool from the start; archives that fit before the anchor
  // TARGET are pre-anchor, the rest are post-anchor. The post-anchor tail is then
  // truncated to end at the last 3-4am PT window before its natural end. Priority
  // order stays random; both sides get a natural ~2:1 high/medium mix from the
  // shuffle. (anchorTargetMs = startTime for a scheduled anchor, endTime+warmup
  // for a post-live anchor — see above.)

  // Curated/anchor archive duration. Post-live: plays right after the block.
  // Scheduled: this IS the anchor recording, plays at the target, in the loop.
  let curatedDurSec = 0;
  if (curatedId) {
    const curated = archives.find((a) => a.id === curatedId);
    if (curated) curatedDurSec = curated.durationSec;
  }
  // Pre-anchor pour FILL target. Post-live keeps the exact prior value
  // (blockEnd = endTimeMs) so live loops are byte-identical; the +warmup slack
  // is absorbed by generateLoop's precise backwards-align. Scheduled fills up to
  // the anchor's start (= anchorTargetMs).
  const fillTargetMs = firstAnchor.isScheduledAnchor ? anchorTargetMs : firstAnchor.endTimeMs;

  // Where the post-anchor pour resumes = the anchor archive's audible end.
  // Post-live keeps the exact prior formula (blockEnd + curatedDur - crossfade,
  // no warmup); scheduled resumes after the in-loop anchor archive
  // (target + curatedDur - crossfade).
  const postBlockStartMs = firstAnchor.isScheduledAnchor
    ? anchorTargetMs + (curatedDurSec - CROSSFADE_SEC) * 1000
    : firstAnchor.endTimeMs + (curatedDurSec - CROSSFADE_SEC) * 1000;

  // Split the shuffled pool at the fill target: fill up to it, rest go after.
  // Whole archives only (one that would straddle the target goes after).
  //
  // GAP FIX: the loop's *actual* start is recomputed in generateLoop as
  // (target − preAnchorSpan) so the hand-in lands on the target. If the
  // pre-anchor pour stops as soon as an archive won't fit before the target, the
  // pre-anchor span can be too SHORT, pushing that recomputed start LATER than
  // the previous loop's end → a gap (dead air) between loops. So we keep pouring
  // pre-anchor archives until the span reaches at least (target − prevEnd),
  // which is exactly enough to pull the recomputed start back to ≤ prevEnd (no
  // gap). This only ever ADDS archives to the front, so loops that already had
  // no gap are unaffected. (Loop 31, 2026-06-25: poured 11.7h, needed 12.5h →
  // 47-min gap; this adds the one missing archive.) Overshoot by part of one
  // archive = a little extra overlap with the previous loop, which is fine.
  // Pour enough pre-anchor content that the recomputed start (target −
  // preAnchorSpan) lands at/after the loop's start (startTimeMs, floored at now),
  // not before it — so the aligned start never slips into a past window.
  const minPreSpanMs = Math.max(0, fillTargetMs - startTimeMs);
  const preItems: EligibleArchive[] = [];
  const postPool: EligibleArchive[] = [];
  let running = startTimeMs;
  let blockReached = false;
  for (const a of pool) {
    const span = effectiveSpanMs(a.durationSec, avgInterludeSec);
    const preSpan = running - startTimeMs;
    if (!blockReached && (running + span <= fillTargetMs || preSpan < minPreSpanMs)) {
      preItems.push(a);
      running += span;
    } else {
      blockReached = true;
      postPool.push(a);
    }
  }
  // Truncate the post-anchor tail at the first 3-4am PT boundary it crosses.
  const postItems = truncateAtEndWindow(postPool, postBlockStartMs, avgInterludeSec);

  // Later anchors (beyond the first) get spliced mid-loop by generateLoop. They
  // must land AFTER the first anchor's audible target (a strictly-later target)
  // and be deduped so the same slot isn't spliced twice. Same-archive anchors at
  // different times ARE kept (a show legitimately scheduled at 2+ points over the
  // 2-day loop plays at each). Sorted by target ascending so the splice pass
  // walks them left-to-right.
  // 50h cap: a later anchor whose target is more than MAX_ANCHOR_HORIZON_MS past
  // the loop's start is DEFERRED to the next loop rather than stretching this one
  // to reach it. Without this, a next-day scheduled anchor (e.g. 8pm ~40h out)
  // forced the loop to ~70h ending at an odd hour instead of the 3-4am window.
  const maxTargetMs = startTimeMs + MAX_ANCHOR_HORIZON_MS;
  const firstTarget = anchorTarget(firstAnchor);
  const laterAnchors = inHorizon
    .filter((a) => anchorTarget(a) > firstTarget && anchorTarget(a) <= maxTargetMs)
    .sort((a, b) => anchorTarget(a) - anchorTarget(b));

  return {
    startTimeMs,
    anchor: firstAnchor,
    laterAnchors,
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
// `horizonAheadMs` is how far past `loopStartTimeMs` to load slots. It MUST be
// >= the anchor-SELECTION horizon used by callers (anchorHorizonMs, 72h) —
// otherwise a real upcoming anchor that the selector would accept gets silently
// dropped here at load time. (Bug 2026-06-24: loader capped 48h while the
// selector looked 72h; a show 65h past selBase fell in the dead zone, so
// loop-0030 was built with no anchor for the 6-7pm Dewpoint slot.) Default
// matches the selection horizon so the two can never drift apart again.
async function loadAnchors(
  db: FirebaseFirestore.Firestore,
  loopStartTimeMs: number,
  horizonAheadMs: number = 72 * 3600 * 1000,
): Promise<LiveBlockBoundary[]> {
  const horizonMs = loopStartTimeMs + horizonAheadMs;
  // Use >= so a slot whose endTime EXACTLY equals loopStartTimeMs is still
  // included — that's the "anchor at offset 0" case where the loop's first
  // item lands at the moment this slot's block ends.
  const snap = await db.collection('broadcast-slots')
    .where('endTime', '>=', Timestamp.fromMillis(loopStartTimeMs))
    .get();
  const rawSlots: Array<{ startTimeMs: number; endTimeMs: number; postLiveArchiveId: string | null; isScheduledAnchor: boolean }> = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status !== 'scheduled' && d.status !== 'live') continue;
    const startTs = d.startTime as Timestamp | undefined;
    const endTs = d.endTime as Timestamp | undefined;
    if (!startTs || !endTs) continue;
    const startMs = startTs.toMillis();
    if (startMs >= horizonMs) continue;
    // A SCHEDULED anchor (broadcastType:'anchor') is radio-only: its recording
    // plays IN the loop at startTime. The "curated" archive IS that recording —
    // archiveId === postLiveArchiveId by contract; fall back to archiveId so the
    // force-include + placement still resolve the right recording.
    const isScheduledAnchor = d.broadcastType === 'anchor';
    const postId = typeof d.postLiveArchiveId === 'string' ? d.postLiveArchiveId : null;
    const archiveId = typeof d.archiveId === 'string' ? d.archiveId : null;
    rawSlots.push({
      startTimeMs: startMs,
      endTimeMs: endTs.toMillis(),
      postLiveArchiveId: isScheduledAnchor ? (postId ?? archiveId) : postId,
      isScheduledAnchor,
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
      // Retired from the rotation: doc kept (so already-built loops still
      // resolve its URL) but excluded from future loop generation.
      if (d.disabledForLoops) continue;
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
  let plan = await resolveLoopPlan(args, archives, interstitials);

  // If this loop's chosen anchor pins an archive that the general pool filtered
  // out (private / hidden / short), force-include JUST that one archive and
  // re-resolve the plan so its duration + placement are correct. Scoped to the
  // selected anchor only — a non-anchored hidden/private archive never enters
  // the radio. Without this, buildLoop substitutes a random archive at the
  // anchor's time and the player can't resolve the anchor's metadata.
  // Anchor archives that the general pool filtered out (private / hidden / short)
  // must be force-included so the anchor lands the real recording — for the FIRST
  // anchor AND every later anchor. Scoped to selected anchors only.
  const anchorCuratedIds = [
    plan.anchor?.curatedArchiveId ?? null,
    ...plan.laterAnchors.map((a) => a.curatedArchiveId),
  ].filter((id): id is string => !!id);
  const missingCurated = anchorCuratedIds.filter((id) => !archives.some((a) => a.id === id));
  if (missingCurated.length > 0) {
    await forceIncludeAnchorArchives(archives, missingCurated);
    if (missingCurated.some((id) => archives.some((a) => a.id === id))) {
      plan = await resolveLoopPlan(args, archives, interstitials);
    }
  }

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
  const nowFloorMs = args.nowMsOverride ?? Date.now();
  let startTimeMs = plan.startTimeMs;
  if (plan.anchor && plan.preAnchorArchiveIds !== null && plan.anchor.curatedArchiveId) {
    const curatedId = plan.anchor.curatedArchiveId;
    // buildLoop assembly order before the anchor:
    //   [startInt, pa0, int, pa1, int, ..., pa(N-1), anchorInt, anchorArchive, ...]
    // Locate the anchor archive BY ID (ground truth) — never positional; a
    // positional estimate drifts once we start dropping items below.
    const findAnchorIdx = (): number =>
      result.items.findIndex((it) => it.kind === 'archive' && it.archiveId === curatedId);

    // Back-compute the loop start so the anchor lands EXACTLY on target. The
    // schedule's startOffsetSec already encodes audible time (CROSSFADE_SEC
    // subtracted between transitions), so aligning the offset aligns the fade-in.
    //   • SCHEDULED anchor → the anchor ARCHIVE is audible at its slot start, no
    //     warmup (radio already playing). Align the archive item's offset.
    //   • POST-LIVE anchor → the hand-back INTERLUDE (item before the archive) is
    //     audible at endTime + warmup (covers the live→radio source switch).
    const computeStart = (idx: number): number =>
      plan.anchor!.isScheduledAnchor
        ? plan.anchor!.startTimeMs - result.items[idx].startOffsetSec * 1000
        : plan.anchor!.endTimeMs + ANCHOR_WARMUP_MS - result.items[idx - 1].startOffsetSec * 1000;

    let anchorArchiveIdx = findAnchorIdx();
    if (anchorArchiveIdx > 0 && result.items[anchorArchiveIdx - 1].kind === 'interstitial') {
      startTimeMs = computeStart(anchorArchiveIdx);

      // Floor WITHOUT displacing the anchor. If the back-computed start lands
      // before nowFloorMs, the pre-anchor pour is too LONG (the shuffle's real
      // interlude durations exceeded the avg-interlude estimate the plan sized
      // against). The old code clamped startTimeMs forward, which slid the anchor
      // late by the clamp amount (Molly 2026-07-29: 0–55 min late, shuffle-
      // dependent). Instead, DROP whole pre-anchor filler items — the last
      // pre-anchor archive (pa(N-1)) plus the interlude before it — which shrinks
      // the anchor's offset and moves the recomputed start LATER, until it clears
      // the floor. The anchor stays EXACTLY on target; the loop head (already
      // playing) is untouched since we drop nearest the anchor. Whole items only.
      while (startTimeMs < nowFloorMs) {
        const anchorInterludeIdx = anchorArchiveIdx - 1;   // anchor's hand-in interlude (keep)
        const lastPreArchiveIdx = anchorInterludeIdx - 1;  // pa(N-1) — drop
        const interludeBeforeIdx = anchorInterludeIdx - 2; // interlude before pa(N-1) — drop
        if (
          interludeBeforeIdx < 1 ||                                   // no droppable pair left
          result.items[lastPreArchiveIdx]?.kind !== 'archive' ||
          result.items[interludeBeforeIdx]?.kind !== 'interstitial'
        ) break; // structure not as expected / nothing to drop — fall through to clamp
        result.items.splice(interludeBeforeIdx, 2); // remove [interlude, pa(N-1)]
        reflowOffsets(result.items);
        anchorArchiveIdx = findAnchorIdx();
        if (anchorArchiveIdx < 1 || result.items[anchorArchiveIdx - 1].kind !== 'interstitial') break;
        startTimeMs = computeStart(anchorArchiveIdx);
      }
    }
  } else if (plan.anchor && plan.preAnchorArchiveIds !== null) {
    // Curated-LESS first anchor (a routine live block with no admin post-live
    // pick): buildLoop placed a RANDOM archive at the anchor slot, so there's no
    // id to search by — fall back to the positional index (unchanged from the
    // original two-pass align). This case was never the clamp bug (drop loop not
    // applied here); the final clamp below still guards the floor.
    const preLen = plan.preAnchorArchiveIds.length;
    const anchorArchiveIdx = 2 * preLen + 1; // startInt + N pre-archives + (N-1) interludes + anchorInt
    if (anchorArchiveIdx > 0 && result.items[anchorArchiveIdx - 1]?.kind === 'interstitial') {
      startTimeMs = plan.anchor.isScheduledAnchor
        ? plan.anchor.startTimeMs - result.items[anchorArchiveIdx].startOffsetSec * 1000
        : plan.anchor.endTimeMs + ANCHOR_WARMUP_MS - result.items[anchorArchiveIdx - 1].startOffsetSec * 1000;
    }
  }

  // Final backstop: never start in a past window. The drop loop above keeps the
  // anchor on target in the normal case; this only fires when the anchor sits
  // less than ~one archive from the loop head and no droppable filler remains, in
  // which case residual drift is bounded to < one archive (vs. up to 55 min).
  if (startTimeMs < nowFloorMs) {
    startTimeMs = nowFloorMs;
  }

  // ── MULTI-ANCHOR splice pass (anchors #2…N) ──────────────────────────────
  // Anchor #1 is aligned by the loop-start back-shift above (works because the
  // loop hasn't started). Every LATER anchor is MID-LOOP — audio is already
  // playing — so we can't move the loop start again without breaking anchor #1.
  // Instead, for each later anchor we CUT SHORT the pool archive playing into it
  // (give that item a shorter durationSec so the player's crossfade fires early),
  // insert a hand-back interlude, then start the curated archive so its hand-in
  // lands audible EXACTLY at the anchor's target. Same offset-safe mechanism as
  // scripts/splice-loop-anchor.ts (verified 0.0s drift). startTimeMs is now fixed,
  // so all math is by absolute wall-clock time.
  let alignedLaterCount = 0;
  let missedLaterCount = 0;
  if (plan.laterAnchors.length > 0 && result.items.length > 0) {
    // Hand-back interlude: prefer toilet-therapist (the established hand-back),
    // else any available interlude. Reuse one already in the built loop so its
    // real duration/url are correct, else fall back to the loaded pool.
    const TT_ID = 'mGUjchuXuFAtTa4dmAls';
    const ttInBuilt = result.items.find((it) => it.interstitialId === TT_ID);
    const ttFromPool = interstitials.find((ix) => ix.id === TT_ID) ?? interstitials[0];
    const handbackDurSec = ttInBuilt?.durationSec ?? ttFromPool?.durationSec ?? 0;
    const handbackUrl = ttInBuilt?.recordingUrl ?? ttFromPool?.url ?? '';
    const handbackId = ttInBuilt?.interstitialId ?? ttFromPool?.id;
    const handbackTitle = ttInBuilt?.title ?? ttFromPool?.label;
    const makeHandback = (): ScheduleItem => ({
      kind: 'interstitial',
      recordingUrl: handbackUrl,
      durationSec: handbackDurSec,
      startOffsetSec: 0,
      ...(handbackId ? { interstitialId: handbackId } : {}),
      ...(handbackTitle ? { title: handbackTitle } : {}),
    });
    // Anchor archive ids already placed in the loop (anchor #1 + any spliced) —
    // never cut one short to feed the next anchor (no anchor back-to-back).
    const placedAnchorIds = new Set<string>(
      plan.anchor?.curatedArchiveId ? [plan.anchor.curatedArchiveId] : [],
    );

    for (const anc of plan.laterAnchors) {
      const targetMs = anc.isScheduledAnchor
        ? anc.startTimeMs
        : anc.endTimeMs + ANCHOR_WARMUP_MS;
      const absOf = (it: ScheduleItem) => startTimeMs + it.startOffsetSec * 1000;
      const endOf = (it: ScheduleItem) => absOf(it) + it.durationSec * 1000;
      // Archive whose audible window spans the target; else the last archive
      // starting at/before it (target landed in an interlude gap).
      let idx = result.items.findIndex(
        (it) => it.kind === 'archive' && absOf(it) <= targetMs && targetMs < endOf(it),
      );
      if (idx < 0) {
        for (let i = result.items.length - 1; i >= 0; i--) {
          if (result.items[i].kind === 'archive' && absOf(result.items[i]) <= targetMs) { idx = i; break; }
        }
      }
      // No archive at/before the target = anchor falls beyond the built loop's
      // reach (tail didn't extend that far). Skip + count as missed.
      if (idx < 0) { missedLaterCount++; continue; }
      // Resolve the curated archive item (force-included earlier). If missing,
      // skip — better a plain crossfade than a broken/silent anchor.
      const curated = archives.find((a) => a.id === anc.curatedArchiveId);
      if (!curated) { missedLaterCount++; continue; }
      // Cut math — what lands EXACTLY on target differs by anchor kind:
      //   • POST-LIVE (a live DJ just went off): the hand-back INTERLUDE is
      //     audible at target (endTime+warmup) — "that was so-and-so" — then it
      //     crossfades into the curated archive ~(ttDur−CROSSFADE) later.
      //   • SCHEDULED (no live DJ, the show is simply booked to air at a time):
      //     the ARCHIVE itself must be audible at target (its slot start). The
      //     hand-back interlude plays BEFORE it, so the interlude is audible at
      //     target − (ttDur − CROSSFADE) and crossfades into the archive at target.
      // In both cases the cut archive's audible end = the interlude's audible
      // start + CROSSFADE (it crossfades into the interlude there).
      const interludeAudibleMs = anc.isScheduledAnchor
        ? targetMs - (handbackDurSec - CROSSFADE_SEC) * 1000
        : targetMs;
      const cutAudibleEndMs = interludeAudibleMs + CROSSFADE_SEC * 1000;
      // Pick the archive to cut short. The one spanning the target is preferred,
      // but it's invalid if it's an anchor archive (can't chop another anchor) or
      // the cut would leave <30s. In that case walk BACK to the nearest earlier
      // ordinary archive that IS cuttable, so the anchor always places (no more
      // shuffle-dependent skips). The anchor lands on target either way — earlier
      // items just play a little shorter.
      const cutTruncSecFor = (i: number) =>
        Math.round((cutAudibleEndMs - absOf(result.items[i])) * 0.001);
      const cuttable = (i: number) => {
        const it = result.items[i];
        if (it.kind !== 'archive') return false;
        if (it.archiveId && placedAnchorIds.has(it.archiveId)) return false;
        return cutTruncSecFor(i) >= 30;
      };
      const spanIdx = idx;
      while (idx >= 0 && !cuttable(idx)) idx--;
      // Nothing cuttable before the target at all (only anchors / too-short). Skip.
      if (idx < 0) { missedLaterCount++; continue; }
      const cut = result.items[idx];
      const cutTruncSec = cutTruncSecFor(idx);
      const anchorArchiveItem: ScheduleItem = {
        kind: 'archive',
        archiveId: curated.id,
        recordingUrl: curated.recordingUrl,
        durationSec: curated.durationSec,
        startOffsetSec: 0,
        title: curated.title,
        djs: curated.djs,
        artworkUrl: curated.artworkUrl,
        sceneSlugs: curated.sceneSlugs,
        tempo: curated.tempo,
      };
      // Cut the chosen archive short, then drop everything between it and the
      // spanning position (those items would push the anchor late), and insert
      // the hand-back + anchor right after the cut. When idx === spanIdx (the
      // common case) nothing between is dropped.
      result.items[idx] = { ...cut, durationSec: cutTruncSec };
      const dropCount = spanIdx - idx;
      result.items.splice(idx + 1, dropCount, makeHandback(), anchorArchiveItem);
      reflowOffsets(result.items);
      placedAnchorIds.add(curated.id);
      alignedLaterCount++;
    }

    // Tail trim: adding long anchor archives lengthens the loop; drop whole
    // trailing items until the natural end lands in the [3am,4am] PT window.
    // Never drop past the last anchored archive (anchors are fixed points).
    if (alignedLaterCount > 0) {
      const END_HOUR_LO = 10; // 3am PT
      let lastAnchorIdx = 0;
      for (let i = 0; i < result.items.length; i++) {
        const aid = result.items[i].archiveId;
        if (aid && placedAnchorIds.has(aid)) lastAnchorIdx = Math.max(lastAnchorIdx, i);
      }
      const last0 = result.items[result.items.length - 1];
      const naturalEnd0 = startTimeMs + (last0.startOffsetSec + last0.durationSec) * 1000;
      // 4am PT edge of the window at/before the natural end (see splice script's
      // off-by-one note: anchor to the 3am floor then +1h, don't snap a day early).
      const endTarget = prevWindowMidMs(naturalEnd0, END_HOUR_LO) - 1800 * 1000 + 3600 * 1000;
      while (result.items.length - 1 > lastAnchorIdx) {
        const last = result.items[result.items.length - 1];
        const lastEnd = startTimeMs + (last.startOffsetSec + last.durationSec) * 1000;
        if (lastEnd <= endTarget) break;
        result.items.pop();
      }
    }

    // Recompute offsets + totals + placed-priority tallies after splicing/trim.
    result.totalDurationSec = reflowOffsets(result.items);
    result.alignedAnchorCount += alignedLaterCount;
    result.missedAnchorCount += missedLaterCount;
  }
  // Overlap with the previous loop is intentional and unbounded: useArchiveRadio picks
  // the highest-loopNumber loop whose startTimeMs has passed, so when loop N's start
  // arrives, listeners cross over from N-1. We deliberately do NOT cap overlap — for an
  // anchor loop the start is whatever it needs to be (1-2am window before both the anchor
  // and prevEnd) to hand off cleanly; the amount of overlap is irrelevant to listeners.
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
    if (it.tempo) obj.tempo = it.tempo;
    return obj;
  });

  // Dry-run: everything is computed; return WITHOUT writing to Firestore.
  if (!args.dryRun) {
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
  }

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
    // Only populated on dry-runs (for inspection harnesses); undefined otherwise.
    ...(args.dryRun ? { dryRunItems: result.items } : {}),
  };
}


// Idempotent: ensures a loop exists whose startTimeMs > now. If the latest
// stored loop's end is in the future, do nothing. Otherwise generate the next
// loop. Used by the cron + the listener-side "ending soon" trigger.
//
// NEVER regenerates the currently-playing loop. Two paths only:
//   • latest stored loop is a FUTURE loop → optionally regenerate IT (count-based
//     self-heal) if new anchors now fall in its span; the playing loop is untouched.
//   • latest stored loop IS the currently-playing one → generate a brand-new
//     next loop (maxLoopNumber + 1). An anchor inside the playing loop's span is
//     picked up by the next loop starting BEFORE it (resolveLoopPlan's look-back),
//     so it hands off via loop-number precedence without ever rewriting the
//     playing loop.
export async function ensureNextLoop(args: { generatedBy?: 'cron' | 'admin' } = {}): Promise<GenerateLoopResult | { skipped: 'already-future'; loopNumber: number }> {
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');
  const now = Date.now();
  // Fetch a few latest loops — the currently-playing one isn't always the
  // highest-numbered (a future loop may already be stored).
  const latestSnap = await db
    .collection(LOOP_COLLECTION)
    .orderBy('loopNumber', 'desc')
    .limit(3)
    .get();

  // NEVER touch the currently-playing loop. ensureNextLoop only ever writes a NEW
  // next loop (N+1). An anchor that falls INSIDE the currently-playing loop is caught
  // by generating N+1 with a start BEFORE that anchor (resolveLoopPlan's anchor
  // selection looks back over the previous loop's span) — N+1 then takes over via
  // loop-number precedence at its start and hands off to the anchor, with the playing
  // loop left completely untouched (no reshuffle, no mid-show jump).

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
        // Count-based self-heal: regenerate the future loop when MORE anchors fall
        // inside THIS loop's own span than it was built with. Catches a 2nd (or
        // Nth) anchor scheduled AFTER the loop was generated — not just the first,
        // and not gated on planReason. (The old gate skipped any already-anchored
        // loop, so a newly-added later anchor was silently dropped.)
        //
        // CRITICAL: bound the visible-anchor count to the loop's ACTUAL end
        // (endMs), NOT a fixed 72h horizon. An anchor beyond this loop's end
        // belongs to the NEXT loop, not this one — counting it would make the
        // check fire every cron tick forever (visible > aligned can never
        // converge because that anchor can never fit in this loop).
        const storedAligned = Number(data.catalogStats?.alignedAnchorCount ?? 0);
        if (!locked) {
          const anchors = await loadAnchors(db, startTimeMs, endMs - startTimeMs);
          const visibleAnchorCount = anchors.filter(
            (a) => a.endTimeMs > startTimeMs && a.endTimeMs <= endMs,
          ).length;
          if (visibleAnchorCount > storedAligned) {
            return generateLoop({ loopNumber, force: true, generatedBy: args.generatedBy });
          }
        }
        return { skipped: 'already-future', loopNumber };
      }

      // The latest stored loop IS the currently-playing one. Build its successor
      // ONLY when there's a real reason (see NEXT_LOOP_* constants) — otherwise
      // skip, leaving the playing loop untouched. An eager build here back-dates
      // its start to the soonest anchor and supersedes the playing loop mid-day.
      const endsSoon = endMs - now < NEXT_LOOP_END_LEAD_MS;
      let hasMissingAnchorSoon = false;
      if (!endsSoon) {
        const items: ScheduleItem[] = Array.isArray(data.items) ? (data.items as ScheduleItem[]) : [];
        const anchorTargetOf = (a: LiveBlockBoundary) =>
          a.isScheduledAnchor ? a.startTimeMs : a.endTimeMs + ANCHOR_WARMUP_MS;
        const anchors = await loadAnchors(db, now, NEXT_LOOP_ANCHOR_LOOKAHEAD_MS);
        hasMissingAnchorSoon = anchors.some((a) => {
          const target = anchorTargetOf(a);
          if (target < now || target - now > NEXT_LOOP_ANCHOR_LOOKAHEAD_MS) return false;
          return !loopCoversAnchor(startTimeMs, items, a);
        });
      }
      if (!endsSoon && !hasMissingAnchorSoon) {
        return { skipped: 'already-future', loopNumber: Number(data.loopNumber ?? 0) };
      }
    }
  }
  const next = (await maxLoopNumber()) + 1;
  return generateLoop({ loopNumber: next, generatedBy: args.generatedBy });
}
