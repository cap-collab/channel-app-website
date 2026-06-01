import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import {
  buildLoop,
  buildQueue,
  computeLiveBlocks,
  EligibleArchive,
  findEndSubset,
  findStartTimeAndSubset,
  INTERSTITIALS_COLLECTION,
  LiveBlockBoundary,
  LOOP_COLLECTION,
  loopDocId,
  offsetUtcId,
  SCHEDULE_COLLECTION,
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

  // Eligible archives: high + medium priority, public, fully uploaded.
  // Single collection.get() + in-code filter (matches /api/archives — keeps
  // us from needing a new composite index).
  const archivesSnap = await db.collection('archives').get();
  const archives: EligibleArchive[] = [];
  for (const doc of archivesSnap.docs) {
    const d = doc.data();
    if (d.uploadStatus === 'uploading') continue;
    if (d.isPublic === false) continue;
    const priority = (d.priority || 'medium') as string;
    if (priority !== 'high' && priority !== 'medium') continue;
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
    const priority = (d.priority || 'medium') as string;
    if (priority !== 'high' && priority !== 'medium') continue;
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
  // Short-mode only: explicit ordered list of archives that play AFTER the
  // anchor archive. Sized so the loop ends in [3am, 4am] PT of the 2nd
  // anchor's UTC day.
  postAnchorArchiveIds: string[] | null;
  // 'long' (no 2nd anchor in 48h): highs 2×, mediums 1×, run to natural end.
  // 'short' (2nd anchor exists): every archive 1×, pre + post anchor subsets
  // explicit, loop ends in the target window.
  mode: 'long' | 'short';
  // Soft cap on loop duration. Set in long-mode-with-next-anchor edge cases.
  // Ignored by buildLoop when postAnchorArchiveIds is set.
  maxDurationSec: number | null;
  // Earliest moment this loop is allowed to start (= max(now, prevLoopEnd)).
  // Used as a final clamp after the anchor two-pass shift in generateLoop so
  // the new doc never overlaps the previous loop.
  earliestStartMs: number;
  reason: 'override' | 'first-loop' | 'aligned-subset' | 'aligned-anchor-fallback' | 'no-anchor-back-to-back' | 'short-mode-two-sided' | 'short-mode-anchor-only';
}

// Decide the loop's startTimeMs (and optionally a pre-anchor archive subset)
// for loop N. The 1am PT cron's algorithm:
//   1. If there's an upcoming live-block end ("anchor") in the next 28h, try
//      to land the cron-run-day's dead-zone window (1-3am PT) on that anchor:
//      search for an archive subset whose total duration places the
//      post-subset interlude EXACTLY on the anchor. If a subset's computed
//      startTime falls in [1am PT, 3am PT] of the cron-run day, use it.
//      The 3am upper bound (not 4am) gives prev — which is capped at 25h
//      when a next anchor exists, and itself starts in [1am, 3am] PT — a
//      guaranteed natural end in [2am, 4am+ε] PT, so N's start always lands
//      before prev's end and there's no silence gap between loops.
//   2. If no subset fits the window, fall back to startTimeMs = anchor.end
//      (Model B: anchor interlude at loop offset 0; loop transition happens
//      whenever live ends rather than in dead zone).
//   3. If no anchor in the next 28h, behave as today (back-to-back from
//      prevNaturalEnd, no alignment).
async function resolveLoopPlan(
  args: GenerateLoopArgs,
  archives: EligibleArchive[],
  interstitials: Interstitial[],
): Promise<LoopPlan> {
  if (typeof args.startTimeMsOverride === 'number') {
    return { startTimeMs: args.startTimeMsOverride, anchor: null, preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'long', maxDurationSec: null, earliestStartMs: args.startTimeMsOverride, reason: 'override' };
  }
  const nowMs = args.nowMsOverride ?? Date.now();
  if (args.loopNumber <= 1) {
    return { startTimeMs: nowMs, anchor: null, preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'long', maxDurationSec: null, earliestStartMs: nowMs, reason: 'first-loop' };
  }
  const db = getAdminDb();
  if (!db) throw new Error('database not configured');

  // Previous loop's natural end is the back-to-back fallback startTime.
  // Loop N must never start before loop N-1 has finished — otherwise the new
  // doc overlaps the currently-playing one and listeners get yanked mid-loop.
  const prev = await db.collection(LOOP_COLLECTION).doc(loopDocId(args.loopNumber - 1)).get();
  let prevNaturalEnd = nowMs;
  if (prev.exists) {
    const data = prev.data() ?? {};
    const prevStart = Number(data.startTimeMs ?? 0);
    const totalDurationSec = Number(data.totalDurationSec ?? 0);
    prevNaturalEnd = prevStart + totalDurationSec * 1000;
  }
  // Earliest moment loop N is allowed to start. Used to filter anchors and to
  // clamp the resolved startTimeMs so we never overlap loop N-1.
  const earliestStartMs = Math.max(nowMs, prevNaturalEnd);

  // Look for the first anchor that lands AFTER loop N-1 ends. Anchors before
  // earliestStartMs belong to the previous loop's window — picking them would
  // place loop N inside loop N-1.
  const anchorHorizonMs = earliestStartMs + 28 * 3600 * 1000;
  const anchors = await loadAnchors(db, earliestStartMs);
  const firstAnchor = anchors.find((a) => a.endTimeMs > earliestStartMs && a.endTimeMs <= anchorHorizonMs);

  // Short-mode detection: if a SECOND anchor exists within ~48h AFTER the
  // first anchor, this is a short loop. (Anchored to firstAnchor, not now —
  // otherwise a regen near midnight could miss an anchor 30h later that the
  // morning cron would have caught.) Every archive plays once, and the loop
  // ends in [3am, 4am] PT of the day the 2nd anchor lands on. When no 2nd
  // anchor, this is a long loop.
  const secondAnchorHorizonMs = firstAnchor
    ? firstAnchor.endTimeMs + 48 * 3600 * 1000
    : 0;
  const secondAnchor = firstAnchor
    ? anchors.find((a) =>
        a.endTimeMs > firstAnchor.endTimeMs && a.endTimeMs <= secondAnchorHorizonMs)
    : undefined;
  const mode: 'long' | 'short' = secondAnchor ? 'short' : 'long';

  if (!firstAnchor) {
    // No anchor in window → back-to-back from prev's natural end.
    return { startTimeMs: prevNaturalEnd, anchor: null, preAnchorArchiveIds: null, postAnchorArchiveIds: null, mode: 'long', maxDurationSec: null, earliestStartMs, reason: 'no-anchor-back-to-back' };
  }

  // Compute the dead-zone window for the cron-run day, in UTC.
  // 1am PT = 08:00 UTC, 3am PT = 10:00 UTC (PST/PDT-aware math is overkill;
  // we use UTC-7 as a simplification).
  // 1-3 AM PT window of the day loop N-1 ends on. Loop N is allowed to start
  // BEFORE loop N-1 ends (small overlap is fine — useArchiveRadio picks the
  // highest-loopNumber loop whose startTimeMs has passed). We anchor the
  // window to the day loop N-1 ends, not "now", so the window is meaningful
  // even when generation runs mid-day.
  const prevEndDay = new Date(prevNaturalEnd);
  prevEndDay.setUTCHours(0, 0, 0, 0);
  const dayStartUtcMs = prevEndDay.getTime();
  const windowStartMs = dayStartUtcMs + 8 * 3600 * 1000;   // 08:00 UTC = 1am PT
  const windowEndMs = dayStartUtcMs + 10 * 3600 * 1000;    // 10:00 UTC = 3am PT

  const avgInterludeSec = interstitials.length === 0
    ? 0
    : interstitials.reduce((s, i) => s + i.durationSec, 0) / interstitials.length;

  // Exclude the curated archive from the catalog passed to the search — it's
  // RESERVED for the post-anchor slot, not for the pre-anchor subset.
  const curatedId = firstAnchor.curatedArchiveId;
  const searchCatalog = curatedId
    ? archives.filter((a) => a.id !== curatedId)
    : archives;

  if (mode === 'long') {
    // Long mode: pre-anchor subset locks startTime, post-anchor block runs
    // out the natural catalog (highs×2 + mediums). No diversity tier — long
    // mode already covers the bulk of the catalog so cross-loop overlap is
    // structural and unavoidable.
    const preResult = findStartTimeAndSubset(
      searchCatalog,
      avgInterludeSec,
      firstAnchor.endTimeMs,
      windowStartMs,
      windowEndMs,
    );
    if (preResult) {
      return {
        startTimeMs: preResult.startTimeMs,
        anchor: firstAnchor,
        preAnchorArchiveIds: preResult.archiveIds,
        postAnchorArchiveIds: null,
        mode: 'long',
        maxDurationSec: null,
        earliestStartMs,
        reason: 'aligned-subset',
      };
    }
    return {
      startTimeMs: firstAnchor.endTimeMs,
      anchor: firstAnchor,
      preAnchorArchiveIds: null,
      postAnchorArchiveIds: null,
      mode: 'long',
      maxDurationSec: null,
      earliestStartMs,
      reason: 'aligned-anchor-fallback',
    };
  }

  // Short mode: also pick the post-anchor subset to land endTimeMs in
  // [3am, 4am] PT the morning AFTER loop start. The next 1am-PT cron
  // generates loop N+1 with start in [1am, 3am] PT — N must end at 3-4am PT
  // the same morning so there's no silence gap (N's tail overlaps N+1's
  // start by ~2h, useArchiveRadio picks the highest-loopNumber).
  // (The 2nd anchor only signals "this should be short" — its actual day
  // doesn't dictate the end window.)
  const loopStartUtcDay = new Date(windowStartMs);  // UTC midnight of the start window's day
  loopStartUtcDay.setUTCHours(0, 0, 0, 0);
  const endDayStartUtcMs = loopStartUtcDay.getTime() + 24 * 3600 * 1000;  // next UTC day
  const endWindowStartMs = endDayStartUtcMs + 10 * 3600 * 1000;  // 10:00 UTC = 3am PT
  const endWindowEndMs = endDayStartUtcMs + 11 * 3600 * 1000;    // 11:00 UTC = 4am PT

  // Find the curated archive's duration so we can compute where the post-anchor
  // block starts (= anchor.endTimeMs + curated.dur).
  let curatedDurSec = 0;
  if (curatedId) {
    const curated = archives.find((a) => a.id === curatedId);
    if (curated) curatedDurSec = curated.durationSec;
  }
  const CROSSFADE_SEC = 5;
  // Post-anchor block starts when the curated archive finishes its audible
  // playback (= anchor.endTimeMs + curated.dur - crossfade).
  const postBlockStartMs = firstAnchor.endTimeMs + (curatedDurSec - CROSSFADE_SEC) * 1000;

  // Diversity: prefer archives that did NOT play in the last 24h. Try
  // subset search with fresh-only pool first; fall back to full pool when no
  // fresh subset fits the duration window. Whatever repeats end up in the
  // subset will be reordered below so their wall-clock slot is ~8h offset
  // from yesterday's slot (best-effort).
  const recentPlays = await loadRecentPlays(db, nowMs);
  const freshArchives = archives.filter((a) => !recentPlays.has(a.id));

  // ── Pre-anchor: fresh-first, then full pool fallback ──
  const preFreshSearchCatalog = freshArchives.filter((a) => a.id !== curatedId);
  let preResultShort = findStartTimeAndSubset(
    preFreshSearchCatalog,
    avgInterludeSec,
    firstAnchor.endTimeMs,
    windowStartMs,
    windowEndMs,
  );
  if (!preResultShort) {
    preResultShort = findStartTimeAndSubset(
      searchCatalog,
      avgInterludeSec,
      firstAnchor.endTimeMs,
      windowStartMs,
      windowEndMs,
    );
  }

  // ── Post-anchor: fresh-first, then full pool fallback. Both pools exclude
  // the curated archive AND any archive already picked for pre-anchor. ──
  const preIds = new Set(preResultShort?.archiveIds ?? []);
  const postFreshSearchCatalog = freshArchives.filter((a) =>
    a.id !== curatedId && !preIds.has(a.id),
  );
  let postResult = findEndSubset(
    postFreshSearchCatalog,
    avgInterludeSec,
    postBlockStartMs,
    endWindowStartMs,
    endWindowEndMs,
  );
  if (!postResult) {
    const postFullSearchCatalog = archives.filter((a) =>
      a.id !== curatedId && !preIds.has(a.id),
    );
    postResult = findEndSubset(
      postFullSearchCatalog,
      avgInterludeSec,
      postBlockStartMs,
      endWindowStartMs,
      endWindowEndMs,
    );
  }

  // Reorder both subsets so any repeats from yesterday land at a wall-clock
  // time-of-day with the largest available offset from yesterday's slot.
  // Resolves IDs → EligibleArchive once so we can call the reorder helper.
  const byId = new Map(archives.map((a) => [a.id, a] as const));
  const resolveSubset = (ids: string[] | undefined): EligibleArchive[] => {
    if (!ids) return [];
    const out: EligibleArchive[] = [];
    for (const id of ids) {
      const a = byId.get(id);
      if (a) out.push(a);
    }
    return out;
  };
  const reorderedPreIds = preResultShort
    ? reorderForTimeOfDayDiversity(
        resolveSubset(preResultShort.archiveIds),
        recentPlays,
        preResultShort.startTimeMs + avgInterludeSec * 1000,  // skip the start interlude
        avgInterludeSec,
      ).map((a) => a.id)
    : null;
  const reorderedPostIds = postResult
    ? reorderForTimeOfDayDiversity(
        resolveSubset(postResult.archiveIds),
        recentPlays,
        postBlockStartMs,
        avgInterludeSec,
      ).map((a) => a.id)
    : null;

  if (preResultShort) {
    return {
      startTimeMs: preResultShort.startTimeMs,
      anchor: firstAnchor,
      preAnchorArchiveIds: reorderedPreIds,
      postAnchorArchiveIds: reorderedPostIds,
      mode: 'short',
      maxDurationSec: null,
      earliestStartMs,
      reason: 'short-mode-two-sided',
    };
  }
  // Pre-anchor search failed (e.g. anchor lands well outside the 1–3am window).
  // Anchor wall-clock alignment wins: start at anchor.endTimeMs with the anchor
  // interlude at offset 0. Post-anchor subset still applies.
  return {
    startTimeMs: firstAnchor.endTimeMs,
    anchor: firstAnchor,
    preAnchorArchiveIds: null,
    postAnchorArchiveIds: reorderedPostIds,
    mode: 'short',
    maxDurationSec: null,
    earliestStartMs,
    reason: 'short-mode-anchor-only',
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

// Per-archive recency info: when (UTC seconds-of-day) it last played in the
// 24h window before `nowMs`. Used by short-mode reorder to land yesterday's
// repeats at a wall-clock offset of ~8h from yesterday's slot, so a listener
// tuning in at a given time-of-day doesn't hear the same show two days running.
interface RecentPlay {
  // UTC seconds-of-day of the START of this archive's most-recent prior play.
  // 0–86399. Used modulo 86400 to compute time-of-day offsets.
  todStartSec: number;
}

async function loadRecentPlays(
  db: FirebaseFirestore.Firestore,
  nowMs: number,
): Promise<Map<string, RecentPlay>> {
  const windowStartMs = nowMs - 24 * 3600 * 1000;
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
          out.set(it.archiveId, { todStartSec });
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
      startTimeMs = plan.anchor.endTimeMs - anchorInterludeOffset * 1000;
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
        return { skipped: 'already-future', loopNumber: Number(data.loopNumber ?? 0) };
      }
    }
  }
  const next = (await maxLoopNumber()) + 1;
  return generateLoop({ loopNumber: next, generatedBy: args.generatedBy });
}
