import type {
  ArchiveScheduleDay,
  Interstitial,
  ScheduleItem,
} from '@/types/broadcast';

export const SCHEDULE_COLLECTION = 'archive-schedule';
export const INTERSTITIALS_COLLECTION = 'interstitials';

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
