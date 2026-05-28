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
}

export interface BuildLoopResult {
  items: ScheduleItem[];
  totalDurationSec: number;
  highCount: number;
  mediumCount: number;
  interstitialCount: number;        // # interstitials inserted between archives
  alignedAnchorCount: number;       // 1 when first-anchor alignment was applied
  missedAnchorCount: number;        // always 0 with the simplified model
  warnings: string[];
}

// Fisher-Yates shuffle using the supplied rng; returns a new array.
function shuffle<T>(arr: T[], rng: () => number): T[] {
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

// Build a single catalog loop. Each medium archive contributes one
// ScheduleItem; each high archive contributes two, with the second play placed
// roughly half-loop after the first. Same-DJ adjacency is reduced by a
// post-pass swap. Items are written back-to-back; total duration = sum of all
// included archive durations (high archives counted twice).
export function buildLoop(opts: BuildLoopOptions): BuildLoopResult {
  const rng = opts.rng ?? Math.random;
  const warnings: string[] = [];
  const highs = opts.archives.filter((a) => a.priority === 'high');
  const mediums = opts.archives.filter((a) => a.priority === 'medium');
  const highCount = highs.length;
  const mediumCount = mediums.length;
  const totalEntries = highCount * 2 + mediumCount;

  if (totalEntries === 0) {
    warnings.push('no eligible archives');
    return { items: [], totalDurationSec: 0, highCount: 0, mediumCount: 0, interstitialCount: 0, alignedAnchorCount: 0, missedAnchorCount: 0, warnings };
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

  // Sequence step 1: shuffle mediums into a base sequence with empty slots
  // reserved for high plays. We work in entry-space first (no durations yet),
  // then compute startOffsetSec at the end.
  const shuffledHighs = shuffle(highs, rng);
  const shuffledMediums = shuffle(mediums, rng);

  // Build the sequence as an array of EligibleArchive references. Strategy:
  // 1. Allocate `totalEntries` slots. For each high i, target firstPos = round(i * spacing)
  //    and secondPos = firstPos + floor(totalEntries / 2), where
  //    spacing = totalEntries / (highCount * 2). This evenly distributes the
  //    2*highCount high entries through the loop while keeping each high's
  //    two plays roughly half-loop apart.
  // 2. Fill remaining slots with shuffled mediums in order.
  // 3. Run a same-DJ adjacency pass.
  const sequence: (EligibleArchive | null)[] = new Array(totalEntries).fill(null);

  if (highCount > 0) {
    const spacing = totalEntries / (highCount * 2);
    const halfShift = Math.floor(totalEntries / 2);
    for (let i = 0; i < highCount; i++) {
      const high = shuffledHighs[i];
      let firstPos = Math.floor(i * spacing);
      let secondPos = (firstPos + halfShift) % totalEntries;
      // Resolve collisions: if a slot is already taken, walk forward to the
      // next free slot. This can happen when totalEntries is small and the
      // computed positions collide.
      while (sequence[firstPos] !== null) {
        firstPos = (firstPos + 1) % totalEntries;
      }
      sequence[firstPos] = high;
      while (sequence[secondPos] !== null) {
        secondPos = (secondPos + 1) % totalEntries;
      }
      sequence[secondPos] = high;
    }
  }

  // Fill remaining slots with mediums in shuffled order.
  let mediumIdx = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (sequence[i] !== null) continue;
    if (mediumIdx >= shuffledMediums.length) {
      warnings.push(`ran out of mediums at slot ${i}`);
      break;
    }
    sequence[i] = shuffledMediums[mediumIdx++];
  }

  // Convert to ScheduleItem[] (offsets recomputed after the spacing pass).
  let items: ScheduleItem[] = sequence
    .filter((a): a is EligibleArchive => a !== null)
    .map((a) => archiveToItem(a, 0));

  // Same-DJ adjacency pass.
  items = spaceSameDj(items);

  const interstitialPool = opts.interstitials ?? [];
  const pickInterstitial = (): ScheduleItem | null => {
    if (interstitialPool.length === 0) return null;
    const ix = interstitialPool[Math.floor(rng() * interstitialPool.length)];
    return {
      kind: 'interstitial',
      interstitialId: ix.id,
      recordingUrl: ix.url,
      durationSec: ix.durationSec,
      startOffsetSec: 0, // recomputed cumulatively below
      title: ix.label,
    };
  };

  // Anchor placement. Two modes:
  //   A) opts.preAnchorArchiveIds is set → cron picked a specific subset to
  //      play BEFORE the anchor. The anchor interlude lands AFTER those items.
  //   B) only opts.anchor is set → caller has set startTimeMs = anchor end,
  //      so the anchor interlude lands at offset 0 of the loop (Model B
  //      fallback when subset-sum didn't find a fit).
  let alignedAnchorCount = 0;
  const anchor = opts.anchor ?? null;
  const preAnchorIds = opts.preAnchorArchiveIds ?? null;

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

  let anchorInterlude: ScheduleItem | null = null;
  let anchorArchive: ScheduleItem | null = null;
  if (anchor) {
    anchorInterlude = pickInterstitial();
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

  // Every loop starts with an interlude at position 0 (per cron contract).
  const startInterlude = pickInterstitial();

  // Assemble. Order: [startInterlude, preAnchorItems, anchorInterlude,
  // anchorArchive, rest of catalog].
  let interstitialCount = 0;
  const assembled: ScheduleItem[] = [];
  if (startInterlude) { assembled.push(startInterlude); interstitialCount++; }
  for (const it of preAnchorItems) assembled.push(it);
  if (anchorInterlude) { assembled.push(anchorInterlude); interstitialCount++; }
  if (anchorArchive) assembled.push(anchorArchive);
  for (const it of items) assembled.push(it);
  items = assembled;

  // Interleave one interstitial between every pair of consecutive archive
  // entries (skips when previous is already an interlude).
  if (interstitialPool.length > 0 && items.length > 1) {
    const withInterludes: ScheduleItem[] = [];
    for (let i = 0; i < items.length; i++) {
      withInterludes.push(items[i]);
      const cur = items[i];
      const nxt = i < items.length - 1 ? items[i + 1] : null;
      if (nxt && cur.kind === 'archive' && nxt.kind === 'archive') {
        const ins = pickInterstitial();
        if (ins) { withInterludes.push(ins); interstitialCount++; }
      }
    }
    items = withInterludes;
  }

  // Cumulative startOffsetSec — each item starts CROSSFADE_SEC EARLIER than
  // the previous one's nominal end, because the listener fades in the next
  // item that many seconds before the schedule boundary. The schedule
  // represents when audio actually starts being audible.
  //   next.startOffsetSec = prev.startOffsetSec + prev.durationSec - CROSSFADE_SEC
  // Listener-side CROSSFADE_MS = 5000 in useArchiveRadio.ts.
  const CROSSFADE_SEC = 5;
  let totalDurationSec = 0;
  for (let i = 0; i < items.length; i++) {
    items[i].startOffsetSec = totalDurationSec;
    // Advance cursor by full duration for the last item; subtract the
    // crossfade overlap for every transition before that.
    const isLast = i === items.length - 1;
    totalDurationSec += items[i].durationSec - (isLast ? 0 : CROSSFADE_SEC);
  }

  return {
    items,
    totalDurationSec,
    highCount,
    mediumCount,
    interstitialCount,
    alignedAnchorCount,
    missedAnchorCount: 0,
    warnings,
  };
}

// Find a subset of the catalog (and the exact startTime) such that, when the
// loop plays those archives back-to-back with one interlude interleaved
// between each pair, the NEXT item after the subset (an interlude) starts
// exactly at `anchorEndTimeMs`.
//
// For each candidate subset S, the cumulative duration up to the post-subset
// interlude is:
//   total = sum(durationSec for s in S) + (|S| - 1) * avgInterludeSec
//   startTime = anchorEndTimeMs - total * 1000
//
// A subset is accepted when its computed startTime falls in
// [windowStartMs, windowEndMs]. Among accepted subsets, the one with startTime
// closest to the window midpoint is returned.
//
// Algorithm: meet-in-the-middle subset enumeration. Catalog is capped at
// MAX_N entries; each half enumerates 2^h subsets. Since the startTime
// formula is *linear in the subset's total duration*, we can enumerate both
// halves independently and combine in O(2^(N/2)) per call.
export function findStartTimeAndSubset(
  catalog: EligibleArchive[],
  avgInterludeSec: number,
  anchorEndTimeMs: number,
  windowStartMs: number,
  windowEndMs: number,
): { startTimeMs: number; archiveIds: string[] } | null {
  if (catalog.length === 0) return null;
  const MAX_N = 36;            // cap subset search; 2^18 each half
  const n = Math.min(catalog.length, MAX_N);
  const halfSize = Math.ceil(n / 2);
  const leftIdx = Array.from({ length: halfSize }, (_, i) => i);
  const rightIdx = Array.from({ length: n - halfSize }, (_, i) => halfSize + i);

  const midpointMs = (windowStartMs + windowEndMs) / 2;

  type Entry = { sum: number; count: number; mask: number };
  const enumerate = (idxs: number[]): Entry[] => {
    const out: Entry[] = new Array(1 << idxs.length);
    const total = 1 << idxs.length;
    for (let mask = 0; mask < total; mask++) {
      let sum = 0;
      let count = 0;
      for (let bit = 0; bit < idxs.length; bit++) {
        if (mask & (1 << bit)) {
          sum += catalog[idxs[bit]].durationSec;
          count++;
        }
      }
      out[mask] = { sum, count, mask };
    }
    return out;
  };

  const LS = enumerate(leftIdx);
  const RS = enumerate(rightIdx);

  // For each combined subset (L, R), compute total = L.sum + R.sum +
  // (L.count + R.count - 1) * avgInterlude. Check if the implied startTime
  // is in window. Track the best (closest to midpoint).
  let bestDist = Number.POSITIVE_INFINITY;
  let bestL = -1;
  let bestR = -1;
  let bestStart = 0;
  // To prune: for each L, the target R.sum range is determined by the
  // window constraint, but for simplicity we just iterate all pairs.
  // ~262k × 262k = 68B is too slow at MAX_N=36. Cap MAX_N lower or sort R by
  // sum and binary search.
  // For the actual catalog size (~36), each half is 2^18 ≈ 262k. Iterating
  // L × R is 68 billion — too slow. Use sorted-R binary search instead.
  RS.sort((a, b) => a.sum - b.sum);
  const rSums = RS.map((e) => e.sum);

  // Listener-side crossfade: each transition compresses the schedule by
  // CROSSFADE_SEC seconds. Every loop starts with an interlude (position 0),
  // then N pre-anchor archives interleaved with N-1 interludes, then the
  // anchor interlude (position 2N). The anchor interlude's startOffsetSec is:
  //   dur(start_int) + sum(arc) + (N-1) * avg_int - CROSSFADE_SEC * 2N
  // (where 2N is the count of transitions before the anchor interlude.)
  const CROSSFADE_SEC = 5;
  for (const l of LS) {
    for (let rCount = 0; rCount <= rightIdx.length; rCount++) {
      const combinedCount = l.count + rCount; // N = archive count
      if (combinedCount < 1) continue;
      const gapAdj = Math.max(0, combinedCount - 1) * avgInterludeSec;
      const crossfadeAdj = 2 * combinedCount * CROSSFADE_SEC;
      // Approximate the start-interlude duration as avg (we don't know which
      // of the pool will be picked at position 0). The two-pass shift in
      // generateLoop corrects the residual.
      const startInterludeAdj = avgInterludeSec;
      const idealRSum = (anchorEndTimeMs - midpointMs) / 1000 - l.sum - gapAdj - startInterludeAdj + crossfadeAdj;
      let lo = 0;
      let hi = rSums.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rSums[mid] < idealRSum) lo = mid + 1;
        else hi = mid;
      }
      for (let k = Math.max(0, lo - 4); k <= Math.min(rSums.length - 1, lo + 4); k++) {
        const r = RS[k];
        if (r.count !== rCount) continue;
        const actualCount = l.count + r.count;
        const actualGap = Math.max(0, actualCount - 1) * avgInterludeSec;
        const actualCrossfade = 2 * actualCount * CROSSFADE_SEC;
        const totalSec = l.sum + r.sum + actualGap + startInterludeAdj - actualCrossfade;
        const startMs = anchorEndTimeMs - totalSec * 1000;
        if (startMs < windowStartMs || startMs > windowEndMs) continue;
        const dist = Math.abs(startMs - midpointMs);
        if (dist < bestDist) {
          bestDist = dist;
          bestL = l.mask;
          bestR = r.mask;
          bestStart = startMs;
        }
      }
    }
  }

  if (bestL < 0) return null;

  const archiveIds: string[] = [];
  for (let bit = 0; bit < leftIdx.length; bit++) {
    if (bestL & (1 << bit)) archiveIds.push(catalog[leftIdx[bit]].id);
  }
  for (let bit = 0; bit < rightIdx.length; bit++) {
    if (bestR & (1 << bit)) archiveIds.push(catalog[rightIdx[bit]].id);
  }
  return { startTimeMs: bestStart, archiveIds };
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
