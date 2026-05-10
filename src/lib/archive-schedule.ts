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

export interface BuildLoopOptions {
  archives: EligibleArchive[];
  rng?: () => number;
}

export interface BuildLoopResult {
  items: ScheduleItem[];
  totalDurationSec: number;
  highCount: number;
  mediumCount: number;
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
    return { items: [], totalDurationSec: 0, highCount: 0, mediumCount: 0, warnings };
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

  // Recompute startOffsetSec cumulatively now that order is final.
  let cursor = 0;
  for (const it of items) {
    it.startOffsetSec = cursor;
    cursor += it.durationSec;
  }

  return {
    items,
    totalDurationSec: cursor,
    highCount,
    mediumCount,
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
