import type {
  ArchiveRadioLoop,
  ArchiveScheduleDay,
  Interstitial,
  ScheduleItem,
} from '@/types/broadcast';

export const SCHEDULE_COLLECTION = 'archive-schedule';
export const LOOP_COLLECTION = 'archive-radio-loop';
export const INTERSTITIALS_COLLECTION = 'interstitials';

// Doc id for a loop: 'loop-0001', 'loop-0042', etc. Padded to 4 digits so
// Firestore's lexicographic sort matches numeric order up to loop 9999.
export function loopDocId(n: number): string {
  return `loop-${String(n).padStart(4, '0')}`;
}

const DAY_SECONDS = 24 * 60 * 60;
const SECONDS_MS = 1000;

// Listener-side crossfade overlap: each transition compresses the schedule by
// CROSSFADE_SEC because the incoming item's audio becomes audible CROSSFADE_SEC
// before the schedule boundary. Items are NOT shorter in playback (the file
// plays its full durationSec), but each item's audible tail overlaps the next
// item's audible head by CROSSFADE_SEC. Listener-side CROSSFADE_MS = 5000 in
// useArchiveRadio.ts. Exported so the admin loop-editor (PUT route + UI) reuses
// the SAME math the generator does — re-deriving it without the subtraction
// drifts every item ~5s × its position later (see loop#28 ~70s-late handoff).
export const CROSSFADE_SEC = 5;

// Canonical cumulative-offset pass. Sets each item's startOffsetSec to the
// running cursor; each item starts CROSSFADE_SEC earlier than the previous
// one's nominal end (the last item is not decremented since nothing follows it).
// Returns the total loop duration in seconds. Mutates items in place (matching
// buildLoop's pass) AND returns the total, so callers can write totalDurationSec.
export function reflowOffsets(items: ScheduleItem[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    items[i].startOffsetSec = total;
    const isLast = i === items.length - 1;
    total += items[i].durationSec - (isLast ? 0 : CROSSFADE_SEC);
  }
  return total;
}

// UTC date helpers — schedule docs are keyed by UTC date so listeners across
// timezones agree on "what day's queue am I in." Doc id = YYYY-MM-DD.
export function utcDateId(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function utcDayStartMs(dateId: string): number {
  return Date.parse(`${dateId}T00:00:00.000Z`);
}

export function todayUtcId(): string {
  return utcDateId(new Date());
}

export function tomorrowUtcId(): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  return utcDateId(t);
}

export function offsetUtcId(baseId: string, deltaDays: number): string {
  const base = new Date(`${baseId}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return utcDateId(base);
}

// Find the item that should be playing at `nowMs`, plus the local seek offset
// inside that item. Returns null if before the first item or after the last.
export function findCurrentItem(
  day: ArchiveScheduleDay,
  nowMs: number,
): { index: number; item: ScheduleItem; seekSec: number } | null {
  if (!day.items.length) return null;
  const elapsedSec = (nowMs - day.startTimeMs) / SECONDS_MS;
  if (elapsedSec < 0) return null;
  // Items are sorted by startOffsetSec; binary search.
  let lo = 0;
  let hi = day.items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = day.items[mid];
    const start = it.startOffsetSec;
    const end = start + it.durationSec;
    if (elapsedSec < start) {
      hi = mid - 1;
    } else if (elapsedSec >= end) {
      lo = mid + 1;
    } else {
      return { index: mid, item: it, seekSec: elapsedSec - start };
    }
  }
  return null;
}

// Eligible archive shape for the queue builder. We keep this small on purpose;
// the cron pulls only the fields needed to assemble a ScheduleItem.
export interface EligibleArchive {
  id: string;
  recordingUrl: string;
  durationSec: number;
  priority: 'high' | 'medium';
  title: string;
  djs: { name: string; username?: string; photoUrl?: string }[];
  artworkUrl?: string;
  sceneSlugs?: string[];
  // Wall-clock ms of this archive's most-recent prior play across recent loops.
  // Undefined = never played in the lookback = maximally stale = most preferred.
  // Used to order mediums stalest-first when picking which half goes into a loop,
  // so mediums rotate over ~2 loops instead of repeating.
  lastPlayedMs?: number;
}

export interface BuildQueueOptions {
  archives: EligibleArchive[];
  interstitials: Interstitial[];        // may be empty (v1 default)
  recentPlayCounts: Map<string, number>; // archiveId -> # appearances in prior days window
  targetDurationSec?: number;           // default 24h
  // 'slotted' (default): one archive per hour, multi-hour archives consume
  // adjacent slots. 'continuous': pack archives back-to-back without slot
  // alignment.
  layout?: 'slotted' | 'continuous';
  slotDurationSec?: number;             // default 3600 (1h); used only in 'slotted'
  rng?: () => number;                   // injectable for tests
}

export interface BuildQueueResult {
  items: ScheduleItem[];
  totalDurationSec: number;
  warnings: string[];
}

// Weighted-random pick of an archive. Weight = base priority weight (high=2,
// medium=1) divided by (1 + recent plays in the diversity window). This gives
// fresh archives a strong boost without hard-blocking anything, so a small
// catalog still fills 24h.
function pickArchive(
  pool: EligibleArchive[],
  recentPlayCounts: Map<string, number>,
  forbiddenIds: Set<string>,
  rng: () => number,
): EligibleArchive | null {
  let total = 0;
  const weights: number[] = [];
  for (const a of pool) {
    if (forbiddenIds.has(a.id)) {
      weights.push(0);
      continue;
    }
    const base = a.priority === 'high' ? 2 : 1;
    const recent = recentPlayCounts.get(a.id) ?? 0;
    const w = base / (1 + recent);
    weights.push(w);
    total += w;
  }
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

// Compute how many hourly slots an archive should occupy. We round to the
// nearest whole slot with a generous threshold so a 65-minute show fills one
// slot, not two. Minimum 1 slot regardless of duration.
export function slotSpanFor(durationSec: number, slotDurationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 1;
  // Round up only when the archive overruns the slot by more than 25%.
  const ratio = durationSec / slotDurationSec;
  return Math.max(1, Math.round(ratio));
}

// Build a 24h schedule. Two layouts:
// - 'slotted' (default): one archive per hourly slot, multi-hour archives
//   consume adjacent slots. Archive starts on the slot boundary; the next
//   pick happens at boundary + (span * slotDurationSec). Interstitials are
//   skipped in slotted mode (they'd break boundary alignment).
// - 'continuous': pack archives back-to-back, optional interstitial between
//   each, schedule rolls past the day target if the last archive overruns.
//
// Same-day repeat avoidance: an archive that just played can't be picked again
// until 6h have elapsed in the queue (relaxes to 3h, then 1h, then anything-
// goes if the catalog can't fill the day otherwise).
export function buildQueue(opts: BuildQueueOptions): BuildQueueResult {
  const target = opts.targetDurationSec ?? DAY_SECONDS;
  // Default to 'continuous' (back-to-back). 'slotted' (hourly alignment) is
  // kept as an option but unused in production — short archives in slotted
  // mode left silent gaps until the next hour boundary.
  const layout = opts.layout ?? 'continuous';
  const slotDurationSec = opts.slotDurationSec ?? 3600;
  const rng = opts.rng ?? Math.random;
  const items: ScheduleItem[] = [];
  const warnings: string[] = [];
  if (opts.archives.length === 0) {
    warnings.push('no eligible archives');
    return { items, totalDurationSec: 0, warnings };
  }

  const lastOffsetById = new Map<string, number>();
  // Block the same archive id from repeating within this many seconds.
  // Relaxes step-by-step if the catalog is too small to fill 24h otherwise.
  const repeatWindows = [8 * 3600, 4 * 3600, 1 * 3600, 0];
  let cursor = 0;

  while (cursor < target) {
    let picked: EligibleArchive | null = null;
    let usedWindow = repeatWindows[0];
    for (const window of repeatWindows) {
      const forbidden = new Set<string>();
      if (window > 0) {
        lastOffsetById.forEach((lastOff, id) => {
          if (cursor - lastOff < window) forbidden.add(id);
        });
      }
      picked = pickArchive(opts.archives, opts.recentPlayCounts, forbidden, rng);
      if (picked) {
        usedWindow = window;
        break;
      }
    }
    if (!picked) {
      warnings.push('archive pick exhausted');
      break;
    }
    if (usedWindow === 0 && repeatWindows[0] !== 0) {
      warnings.push(`relaxed repeat window to 0 at offset ${Math.round(cursor)}s`);
    }

    const archiveItem: ScheduleItem = {
      kind: 'archive',
      archiveId: picked.id,
      recordingUrl: picked.recordingUrl,
      durationSec: picked.durationSec,
      startOffsetSec: cursor,
      title: picked.title,
      djs: picked.djs,
      artworkUrl: picked.artworkUrl,
      sceneSlugs: picked.sceneSlugs,
    };
    items.push(archiveItem);
    lastOffsetById.set(picked.id, cursor);

    if (layout === 'slotted') {
      const span = slotSpanFor(picked.durationSec, slotDurationSec);
      cursor += span * slotDurationSec;
    } else {
      cursor += picked.durationSec;
      if (cursor < target && opts.interstitials.length > 0) {
        const ix = opts.interstitials[Math.floor(rng() * opts.interstitials.length)];
        items.push({
          kind: 'interstitial',
          interstitialId: ix.id,
          recordingUrl: ix.url,
          durationSec: ix.durationSec,
          startOffsetSec: cursor,
          title: ix.label,
        });
        cursor += ix.durationSec;
      }
    }
  }

  return { items, totalDurationSec: cursor, warnings };
}

// Tally per-archive appearances across a list of prior schedule docs.
// Used to compute the diversity weight penalty.
export function tallyRecentPlays(days: ArchiveScheduleDay[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of days) {
    for (const it of d.items) {
      if (it.kind === 'archive' && it.archiveId) {
        counts.set(it.archiveId, (counts.get(it.archiveId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog-loop builder. Replaces buildQueue for production use. Each loop is
// one full pass through the eligible catalog: every medium archive plays once,
// every high archive plays twice with the two plays placed roughly half a loop
// apart so the listener doesn't hear the same show twice in quick succession.
// ─────────────────────────────────────────────────────────────────────────────

// A live-broadcast block boundary surfaced by computeLiveBlocks. Each boundary
// is a moment the loop must align an item-start to so the listener-side
// handoff lands cleanly on an interlude + a fresh archive at offset 0.
export interface LiveBlockBoundary {
  endTimeMs: number;
  curatedArchiveId: string | null;  // optional admin pick for the post-block archive
}

// Group contiguous live broadcast-slots into blocks (consecutive slots whose
// gap is < joinGapMs). Emits one boundary per block — at the endTime of the
// final slot — carrying that slot's postLiveArchiveId so the builder can
// honour the admin's curation choice.
export function computeLiveBlocks(
  slots: Array<{ startTimeMs: number; endTimeMs: number; postLiveArchiveId: string | null }>,
  joinGapMs = 60_000,
): LiveBlockBoundary[] {
  if (slots.length === 0) return [];
  const sorted = slots.slice().sort((a, b) => a.startTimeMs - b.startTimeMs);
  const out: LiveBlockBoundary[] = [];
  let curEnd = sorted[0].endTimeMs;
  let curCurated = sorted[0].postLiveArchiveId;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.startTimeMs - curEnd < joinGapMs) {
      // Same block — extend; the LAST slot's curated id wins.
      curEnd = Math.max(curEnd, next.endTimeMs);
      curCurated = next.postLiveArchiveId;
    } else {
      out.push({ endTimeMs: curEnd, curatedArchiveId: curCurated });
      curEnd = next.endTimeMs;
      curCurated = next.postLiveArchiveId;
    }
  }
  out.push({ endTimeMs: curEnd, curatedArchiveId: curCurated });
  return out;
}

export interface BuildLoopOptions {
  archives: EligibleArchive[];
  interstitials?: Interstitial[];   // empty/undefined = no interludes inserted
  rng?: () => number;
  // Deprecated/ignored. Every archive now plays once regardless. Kept on the
  // type so existing callers (generateLoop) compile; remove on a later cleanup.
  mode?: 'long' | 'short';
  // Single anchor (≤1 per loop by cron contract). When provided, an interlude
  // + curated/random archive land at the anchor moment. If preAnchorArchiveIds
  // is ALSO provided, those archives fill the pre-anchor window (cron picked
  // them via subset-sum). Otherwise the anchor stuff is placed at offset 0
  // and the caller is responsible for setting startTimeMs = anchor.endTimeMs.
  anchor?: LiveBlockBoundary;
  // Cron-picked subset of archive IDs to place BEFORE the anchor. Order is
  // preserved (after the same-DJ adjacency pass). The caller is responsible
  // for setting startTimeMs such that the anchor lands at the correct
  // cumulative offset (= sum of these archives' durations + interleave
  // interludes).
  preAnchorArchiveIds?: string[];
  // Short-mode only: explicit archive IDs to play AFTER the anchor archive,
  // in order. Picked by the cron to land endTimeMs in the target window.
  // When set, post-anchor truncation/catalog-looping is bypassed entirely —
  // the post-anchor block is exactly these archives plus interleaved interludes.
  postAnchorArchiveIds?: string[];
  // Soft cap on the loop's total duration. When set, post-anchor archives are
  // dropped after this point. If the natural catalog can't fill the cap, the
  // catalog is looped (replayed from the start). Used by the cron to avoid
  // wasting Firestore storage on items that the next loop will truncate.
  maxDurationSec?: number;
}

export interface BuildLoopResult {
  items: ScheduleItem[];
  totalDurationSec: number;
  highCount: number;                // # high-priority archives PLACED in the loop
  mediumCount: number;              // # medium-priority archives PLACED in the loop
  placedHighDurationSec: number;    // total raw duration of placed highs
  placedMediumDurationSec: number;  // total raw duration of placed mediums
  interstitialCount: number;        // # interstitials inserted between archives
  alignedAnchorCount: number;       // 1 when first-anchor alignment was applied
  missedAnchorCount: number;        // always 0 with the simplified model
  warnings: string[];
}

// Fisher-Yates shuffle using the supplied rng; returns a new array.
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Primary DJ identifier for adjacency comparison. Prefer username; fall back to
// name. Returns null when no DJ is present so we don't treat two empty-DJ
// items as "same DJ".
function primaryDjKey(item: ScheduleItem): string | null {
  const dj = item.djs?.[0];
  if (!dj) return null;
  if (dj.username) return `u:${dj.username.toLowerCase()}`;
  if (dj.name) return `n:${dj.name.toLowerCase()}`;
  return null;
}

// Walk the sequence; for each pair of adjacent items that share a primary DJ,
// try to swap one of them with a nearby item that breaks the adjacency on both
// sides. Bounded by maxPasses so a small catalog (where same-DJ adjacency may
// be unavoidable) doesn't loop forever.
function spaceSameDj(items: ScheduleItem[], maxPasses = 2): ScheduleItem[] {
  const out = items.slice();
  for (let pass = 0; pass < maxPasses; pass++) {
    let swaps = 0;
    for (let i = 0; i < out.length - 1; i++) {
      const a = primaryDjKey(out[i]);
      const b = primaryDjKey(out[i + 1]);
      if (!a || a !== b) continue;
      // Find a swap candidate j (j != i, j != i+1) such that placing out[j]
      // at i+1 doesn't create a new same-DJ adjacency at j-1/j or j/j+1, and
      // doesn't reintroduce one at i/i+1.
      let swapped = false;
      for (let j = i + 2; j < out.length; j++) {
        const cand = primaryDjKey(out[j]);
        if (!cand || cand === a) continue;
        const prevAtJ = j > 0 ? primaryDjKey(out[j - 1]) : null;
        const nextAtJ = j < out.length - 1 ? primaryDjKey(out[j + 1]) : null;
        // After swap, position j holds out[i+1] (key = a). Check it doesn't
        // collide with j's neighbours.
        if (prevAtJ === a || nextAtJ === a) continue;
        // After swap, position i+1 holds out[j] (key = cand). It must differ
        // from out[i] (key = a) — already true since cand !== a.
        [out[i + 1], out[j]] = [out[j], out[i + 1]];
        swapped = true;
        swaps++;
        break;
      }
      if (!swapped) {
        // Try earlier positions too.
        for (let j = i - 1; j >= 0; j--) {
          const cand = primaryDjKey(out[j]);
          if (!cand || cand === a) continue;
          const prevAtJ = j > 0 ? primaryDjKey(out[j - 1]) : null;
          const nextAtJ = j < out.length - 1 ? primaryDjKey(out[j + 1]) : null;
          if (prevAtJ === a || nextAtJ === a) continue;
          [out[i + 1], out[j]] = [out[j], out[i + 1]];
          swaps++;
          break;
        }
      }
    }
    if (swaps === 0) break;
  }
  return out;
}

// Build a single catalog loop. Every archive plays once. The cron decides which
// archives go in (the pool) and their pre/post-anchor ordering via
// preAnchorArchiveIds / postAnchorArchiveIds; this function lays them into a
// timeline with interludes between archives and (when an anchor is present)
// pins the hand-back interlude + curated archive to the anchor slot. Same-DJ
// adjacency is reduced by a post-pass swap. Items are written back-to-back with
// a crossfade overlap between each.
export function buildLoop(opts: BuildLoopOptions): BuildLoopResult {
  const rng = opts.rng ?? Math.random;
  const warnings: string[] = [];

  if (opts.archives.length === 0) {
    warnings.push('no eligible archives');
    return { items: [], totalDurationSec: 0, highCount: 0, mediumCount: 0, placedHighDurationSec: 0, placedMediumDurationSec: 0, interstitialCount: 0, alignedAnchorCount: 0, missedAnchorCount: 0, warnings };
  }

  const archiveToItem = (a: EligibleArchive, startOffsetSec: number): ScheduleItem => ({
    kind: 'archive',
    archiveId: a.id,
    recordingUrl: a.recordingUrl,
    durationSec: a.durationSec,
    startOffsetSec,
    title: a.title,
    djs: a.djs,
    artworkUrl: a.artworkUrl,
    sceneSlugs: a.sceneSlugs,
  });

  // Base pool: every archive once, fully shuffled (priority order is
  // intentionally random — no high/medium spacing). The pre/post-anchor ID
  // lists below pull their picks out of this pool in their specified order; any
  // archive not referenced is dropped.
  let items: ScheduleItem[] = shuffle(opts.archives, rng).map((a) => archiveToItem(a, 0));

  // Same-DJ adjacency pass (no same DJ back-to-back).
  items = spaceSameDj(items);

  // Interlude picker: round-robin through ONE shuffled order. Every interlude
  // plays once before any repeats; the order is the same throughout the loop
  // (e.g. A B C D A B C D A B C D…).
  //
  // CRITICAL: pick interludes ONLY when finalising the array, in left-to-right
  // order. Earlier code picked startInterlude (pick 0) and anchorInterlude
  // (pick 1) up front before assembly, which placed pool[1] in the MIDDLE of
  // the array while the interleaves filled left-to-right with pool[2, 3, ...].
  // That created A,arc,A duplicates near the anchor when preLen ≡ 0 (mod L).
  // The placeholder + finalise pass keeps every picked index sequential in
  // the final array.
  const interstitialPool = opts.interstitials ?? [];
  const shuffledInterludes = interstitialPool.length > 0 ? shuffle(interstitialPool, rng) : [];
  // Sentinel for an interlude slot to be filled in the finalise pass. The
  // assembly + interleave passes only inspect `kind`, so a placeholder behaves
  // like a real interlude during assembly. The finalise pass replaces each
  // placeholder with a real pool pick in left-to-right order.
  const PLACEHOLDER_URL = '__placeholder__';
  // The anchor interlude (the hand-back played immediately AFTER the live block
  // ends) is always the "toilet therapist" interlude per Cap. It gets its own
  // placeholder sentinel so the finalise pass can pin it instead of round-
  // robining, and so it's excluded from the round-robin pool to avoid landing
  // adjacent to itself.
  const ANCHOR_PLACEHOLDER_URL = '__anchor_placeholder__';
  const TOILET_THERAPIST_ID = 'mGUjchuXuFAtTa4dmAls';
  const interludePlaceholder = (): ScheduleItem => ({
    kind: 'interstitial',
    recordingUrl: PLACEHOLDER_URL,
    durationSec: 0,
    startOffsetSec: 0,
  });
  const anchorInterludePlaceholder = (): ScheduleItem => ({
    kind: 'interstitial',
    recordingUrl: ANCHOR_PLACEHOLDER_URL,
    durationSec: 0,
    startOffsetSec: 0,
  });

  // Anchor placement. Two modes:
  //   A) opts.preAnchorArchiveIds is set → cron picked a specific subset to
  //      play BEFORE the anchor. The anchor interlude lands AFTER those items.
  //   B) only opts.anchor is set → caller has set startTimeMs = anchor end,
  //      so the anchor interlude lands at offset 0 of the loop (Model B
  //      fallback when subset-sum didn't find a fit).
  let alignedAnchorCount = 0;
  const anchor = opts.anchor ?? null;
  const preAnchorIds = opts.preAnchorArchiveIds ?? null;
  const postAnchorIds = opts.postAnchorArchiveIds ?? null;

  // Pull preAnchor items in given order (if set) and the curated archive out
  // of `items`, so the assembler can place them deliberately.
  let preAnchorItems: ScheduleItem[] = [];
  if (preAnchorIds && preAnchorIds.length > 0) {
    for (const id of preAnchorIds) {
      const idx = items.findIndex((it) => it.archiveId === id);
      if (idx >= 0) preAnchorItems.push(items.splice(idx, 1)[0]);
    }
    // Run same-DJ adjacency separately on the pre-anchor block so the cron
    // subset doesn't accidentally introduce back-to-back DJs.
    preAnchorItems = spaceSameDj(preAnchorItems);
  }

  let anchorArchive: ScheduleItem | null = null;
  if (anchor) {
    if (anchor.curatedArchiveId) {
      const idx = items.findIndex((it) => it.archiveId === anchor.curatedArchiveId);
      if (idx >= 0) {
        anchorArchive = items.splice(idx, 1)[0];
      } else {
        const cat = opts.archives.find((a) => a.id === anchor.curatedArchiveId);
        if (cat) anchorArchive = archiveToItem(cat, 0);
      }
    }
    if (!anchorArchive && items.length > 0) {
      const ridx = Math.floor(rng() * items.length);
      anchorArchive = items.splice(ridx, 1)[0];
    }
    if (anchorArchive) alignedAnchorCount = 1;
  }

  // Short-mode post-anchor: pull the cron-picked subset out of `items` in the
  // order specified. Anything left in `items` is dropped — short loops end
  // when the post-anchor subset ends, no tail catalog.
  let postAnchorItems: ScheduleItem[] = [];
  if (postAnchorIds) {
    for (const id of postAnchorIds) {
      const idx = items.findIndex((it) => it.archiveId === id);
      if (idx >= 0) postAnchorItems.push(items.splice(idx, 1)[0]);
    }
    postAnchorItems = spaceSameDj(postAnchorItems);
  }

  // Assemble with placeholder interludes. Order:
  //   [startInterlude(placeholder), preAnchorItems,
  //    anchorInterlude(placeholder), anchorArchive,
  //    postAnchorItems (when the cron passed an explicit tail) OR
  //    rest-of-pool (fallback)].
  const assembled: ScheduleItem[] = [];
  const usingInterludes = interstitialPool.length > 0;
  if (usingInterludes) assembled.push(interludePlaceholder());
  for (const it of preAnchorItems) assembled.push(it);
  // The interlude landing on the anchor (between the live block ending and the
  // first post-block archive) is pinned to toilet-therapist in the finalise pass.
  if (anchor && usingInterludes) assembled.push(anchorInterludePlaceholder());
  if (anchorArchive) assembled.push(anchorArchive);
  if (postAnchorIds) {
    // Short mode with explicit tail — drop unused catalog items.
    for (const it of postAnchorItems) assembled.push(it);
  } else {
    for (const it of items) assembled.push(it);
  }
  items = assembled;

  // Interleave placeholder interludes between every pair of consecutive
  // archive entries. Real pool picks happen in the finalise pass below.
  if (usingInterludes && items.length > 1) {
    const withInterludes: ScheduleItem[] = [];
    for (let i = 0; i < items.length; i++) {
      withInterludes.push(items[i]);
      const cur = items[i];
      const nxt = i < items.length - 1 ? items[i + 1] : null;
      if (nxt && cur.kind === 'archive' && nxt.kind === 'archive') {
        withInterludes.push(interludePlaceholder());
      }
    }
    items = withInterludes;
  }

  // Finalise pass: walk the final array left-to-right and fill each
  // interlude placeholder with pool[cursor++]. This keeps the pool's
  // round-robin order aligned with the listener's left-to-right experience,
  // so the same interlude can't appear with only one archive between picks
  // unless the pool length itself is 1.
  let interstitialCount = 0;
  if (usingInterludes) {
    const toiletTherapist = interstitialPool.find((ix) => ix.id === TOILET_THERAPIST_ID) ?? null;
    // Round-robin pool for the generic placeholders. When toilet-therapist is
    // being pinned to the anchor slot, exclude it from the round-robin so it
    // can't appear adjacent to its pinned placement (unless it's the only
    // interlude in the pool, in which case there's nothing else to rotate).
    const rrPool = toiletTherapist && shuffledInterludes.length > 1
      ? shuffledInterludes.filter((ix) => ix.id !== TOILET_THERAPIST_ID)
      : shuffledInterludes;
    const fillFrom = (ix: Interstitial): ScheduleItem => ({
      kind: 'interstitial',
      interstitialId: ix.id,
      recordingUrl: ix.url,
      durationSec: ix.durationSec,
      startOffsetSec: 0,
      title: ix.label,
    });
    let cursor = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].recordingUrl === ANCHOR_PLACEHOLDER_URL) {
        // Pin the anchor interlude to toilet-therapist; fall back to the normal
        // round-robin pick if it's missing from the pool for some reason.
        const ix = toiletTherapist ?? rrPool[cursor % rrPool.length];
        if (!toiletTherapist) cursor++;
        items[i] = fillFrom(ix);
        interstitialCount++;
        continue;
      }
      if (items[i].recordingUrl !== PLACEHOLDER_URL) continue;
      const ix = rrPool[cursor % rrPool.length];
      cursor++;
      items[i] = fillFrom(ix);
      interstitialCount++;
    }
  }

  // CROSSFADE_SEC is the module-scope constant (shared with the admin loop
  // editor). See its definition near the top of this file.

  // Optional truncation: when a maxDurationSec cap is set (because a NEXT
  // loop will truncate this one), drop items past the cap. If the natural
  // sequence is shorter than the cap, loop the catalog by repeating items
  // (with an interlude between) until the cap is met.
  // Skipped when postAnchorIds is set — short mode already sized the tail.
  if (!postAnchorIds && typeof opts.maxDurationSec === 'number' && opts.maxDurationSec > 0) {
    const cap = opts.maxDurationSec;
    let cursor = 0;
    let keepUntilIdx = items.length;
    for (let i = 0; i < items.length; i++) {
      if (cursor >= cap) { keepUntilIdx = i; break; }
      const isLast = i === items.length - 1;
      cursor += items[i].durationSec - (isLast ? 0 : CROSSFADE_SEC);
    }
    if (keepUntilIdx < items.length) {
      items = items.slice(0, keepUntilIdx);
    } else if (cursor < cap && usingInterludes) {
      // Catalog tail repeats with a separator interlude. The finalise pass
      // already ran; pick directly from shuffledInterludes here with a cursor
      // continuing from where finalise left off so we don't restart the
      // round-robin mid-loop.
      let sepCursor = interstitialCount;
      const catalogTail = items.slice();
      let pass = 0;
      while (cursor < cap && pass < 5) {
        const ix = shuffledInterludes[sepCursor % shuffledInterludes.length];
        sepCursor++;
        const sep: ScheduleItem = {
          kind: 'interstitial',
          interstitialId: ix.id,
          recordingUrl: ix.url,
          durationSec: ix.durationSec,
          startOffsetSec: 0,
          title: ix.label,
        };
        items.push(sep);
        cursor += sep.durationSec - CROSSFADE_SEC;
        interstitialCount++;
        for (const it of catalogTail) {
          if (cursor >= cap) break;
          items.push({ ...it });
          cursor += it.durationSec - CROSSFADE_SEC;
        }
        pass++;
      }
    }
  }

  // Cumulative startOffsetSec via the shared reflowOffsets pass — each item
  // starts CROSSFADE_SEC earlier than the previous one's nominal end (listener
  // begins fading in that many seconds before the boundary). startOffsetSec
  // represents when the audio becomes audible.
  const totalDurationSec = reflowOffsets(items);

  // Count what actually got PLACED (not the input catalog), so callers can
  // verify the high/medium mix of the real loop. Includes the curated anchor
  // archive. Durations are raw (pre-crossfade) per priority.
  const priorityById = new Map(opts.archives.map((a) => [a.id, a.priority] as const));
  let placedHighCount = 0;
  let placedMediumCount = 0;
  let placedHighDurationSec = 0;
  let placedMediumDurationSec = 0;
  for (const it of items) {
    if (it.kind !== 'archive' || !it.archiveId) continue;
    const p = priorityById.get(it.archiveId);
    if (p === 'high') {
      placedHighCount++;
      placedHighDurationSec += it.durationSec;
    } else if (p === 'medium') {
      placedMediumCount++;
      placedMediumDurationSec += it.durationSec;
    }
  }

  return {
    items,
    totalDurationSec,
    highCount: placedHighCount,
    mediumCount: placedMediumCount,
    placedHighDurationSec,
    placedMediumDurationSec,
    interstitialCount,
    alignedAnchorCount,
    missedAnchorCount: 0,
    warnings,
  };
}

// Find the item playing at `nowMs` inside a loop. Returns null when nowMs is
// before the loop starts or after it ends (caller should advance to next loop).
export function findCurrentItemInLoop(
  loop: ArchiveRadioLoop,
  nowMs: number,
): { index: number; item: ScheduleItem; seekSec: number } | null {
  if (!loop.items.length) return null;
  const elapsedSec = (nowMs - loop.startTimeMs) / SECONDS_MS;
  if (elapsedSec < 0) return null;
  if (elapsedSec >= loop.totalDurationSec) return null;
  let lo = 0;
  let hi = loop.items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = loop.items[mid];
    const start = it.startOffsetSec;
    const end = start + it.durationSec;
    if (elapsedSec < start) {
      hi = mid - 1;
    } else if (elapsedSec >= end) {
      lo = mid + 1;
    } else {
      return { index: mid, item: it, seekSec: elapsedSec - start };
    }
  }
  return null;
}

// End time of a loop in Unix ms. Convenience helper for "is this loop done?"
// and "should we ensure the next loop?" checks.
export function loopEndMs(loop: ArchiveRadioLoop): number {
  return loop.startTimeMs + loop.totalDurationSec * SECONDS_MS;
}
