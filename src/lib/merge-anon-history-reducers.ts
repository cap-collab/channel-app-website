/**
 * Pure merge reducers for combining an anonymous user's captured history into a
 * real account (see /api/users/merge-anon-history). Kept Firestore-free so they
 * can be unit-tested in isolation and reasoned about on their own.
 *
 * The golden rule (why these are "compute-from-read", not FieldValue.increment):
 * the merge reads BOTH the source and dest concrete values and writes the result.
 * A re-run therefore cannot double — combined with deleting the source docs after
 * copy, the same (fromUid → toUid) merge is idempotent. NEVER swap these for
 * increment(): a retry would then double-count.
 */

// Minimal Timestamp-ish shape: anything with toMillis(), a {seconds}/{_seconds},
// a Date, an ISO string, or a number. Mirrors the coercion the crons already do.
export type TimeLike =
  | { toMillis?: () => number; seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number }
  | Date
  | string
  | number
  | null
  | undefined;

export function toMillis(v: TimeLike): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const p = Date.parse(v);
    return Number.isNaN(p) ? null : p;
  }
  const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  const s = o.seconds ?? o._seconds;
  if (typeof s === "number") return s * 1000 + Math.floor((o.nanoseconds ?? o._nanoseconds ?? 0) / 1e6);
  return null;
}

/** Sum two numeric counters, treating missing as 0. */
export function addCount(a: unknown, b: unknown): number {
  const na = typeof a === "number" ? a : 0;
  const nb = typeof b === "number" ? b : 0;
  return na + nb;
}

/**
 * Keep the earliest of two times (for first*At). Returns the raw value that is
 * earliest so the stored shape (a real Timestamp) is preserved; falls back to
 * whichever is present.
 */
export function earliest<T extends TimeLike>(a: T, b: T): T {
  const ma = toMillis(a);
  const mb = toMillis(b);
  if (ma == null) return b;
  if (mb == null) return a;
  return ma <= mb ? a : b;
}

/** Keep the latest of two times (for last*At). */
export function latest<T extends TimeLike>(a: T, b: T): T {
  const ma = toMillis(a);
  const mb = toMillis(b);
  if (ma == null) return b;
  if (mb == null) return a;
  return ma >= mb ? a : b;
}

/** Union two primitive arrays, deduped, order = dest-first then new-from-source. */
export function unionArray<T>(dest: T[] | undefined, src: T[] | undefined): T[] {
  const out: T[] = [];
  const seen = new Set<unknown>();
  for (const arr of [dest ?? [], src ?? []]) {
    for (const item of arr) {
      const key = typeof item === "object" ? JSON.stringify(item) : item;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

type DjEntry = { name?: string; username?: string | null; photoUrl?: string | null };

/** Union djs[] by username (fallback name), dest entries win on conflict. */
export function unionDjs(dest: DjEntry[] | undefined, src: DjEntry[] | undefined): DjEntry[] {
  const byKey = new Map<string, DjEntry>();
  for (const arr of [dest ?? [], src ?? []]) {
    for (const d of arr) {
      const key = (d.username || d.name || "").toString().toLowerCase();
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, d); // dest processed first → dest wins
    }
  }
  return Array.from(byKey.values());
}

/**
 * Merge one streamHistory doc (dest may be undefined = source-only key).
 * Keyed by archiveId. Counts add, first=earliest, last=latest, arrays union,
 * gate stamps preserved (earliest if both).
 */
export function mergeStreamHistory(
  dest: Record<string, unknown> | undefined,
  src: Record<string, unknown>,
): Record<string, unknown> {
  if (!dest) return { ...src };
  return {
    ...dest,
    ...srcOnlyScalars(dest, src),
    streamCount: addCount(dest.streamCount, src.streamCount),
    firstStreamedAt: earliest(dest.firstStreamedAt as TimeLike, src.firstStreamedAt as TimeLike),
    lastStreamedAt: latest(dest.lastStreamedAt as TimeLike, src.lastStreamedAt as TimeLike),
    djUsernames: unionArray(dest.djUsernames as string[], src.djUsernames as string[]),
    djUsernamesNormalized: unionArray(dest.djUsernamesNormalized as string[], src.djUsernamesNormalized as string[]),
    djs: unionDjs(dest.djs as DjEntry[], src.djs as DjEntry[]),
    ...(mergeGateStamp("gateCreditedAt", dest, src)),
    ...(mergeGateStamp("gateTriggeredAt", dest, src)),
  };
}

/** Merge one loveHistory doc. Keyed by djUsername. */
export function mergeLoveHistory(
  dest: Record<string, unknown> | undefined,
  src: Record<string, unknown>,
): Record<string, unknown> {
  if (!dest) return { ...src };
  return {
    ...dest,
    ...srcOnlyScalars(dest, src),
    loveCount: addCount(dest.loveCount, src.loveCount),
    firstLovedAt: earliest(dest.firstLovedAt as TimeLike, src.firstLovedAt as TimeLike),
    lastLovedAt: latest(dest.lastLovedAt as TimeLike, src.lastLovedAt as TimeLike),
    contexts: unionArray(dest.contexts as string[], src.contexts as string[]),
  };
}

/** Merge one tracklistViews doc. Keyed by archiveId. */
export function mergeTracklistView(
  dest: Record<string, unknown> | undefined,
  src: Record<string, unknown>,
): Record<string, unknown> {
  if (!dest) return { ...src };
  return {
    ...dest,
    ...srcOnlyScalars(dest, src),
    viewCount: addCount(dest.viewCount, src.viewCount),
    firstViewedAt: earliest(dest.firstViewedAt as TimeLike, src.firstViewedAt as TimeLike),
    lastViewedAt: latest(dest.lastViewedAt as TimeLike, src.lastViewedAt as TimeLike),
  };
}

/**
 * Merge two playedArchiveIds maps ({ archiveId: playedAtMs }). Latest play wins
 * per archive; result trimmed to `cap` most-recent (mirrors recordPlay pruning).
 */
export function mergePlayedArchiveIds(
  dest: Record<string, number> | undefined,
  src: Record<string, number> | undefined,
  cap: number,
): Record<string, number> {
  const combined: Record<string, number> = { ...(dest ?? {}) };
  for (const [id, ts] of Object.entries(src ?? {})) {
    const cur = combined[id];
    if (cur === undefined || ts > cur) combined[id] = ts;
  }
  const keys = Object.keys(combined);
  if (keys.length <= cap) return combined;
  // Over cap: keep newest `cap` by timestamp.
  const kept = Object.entries(combined)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap);
  const out: Record<string, number> = {};
  for (const [id, ts] of kept) out[id] = ts;
  return out;
}

// Copy scalar keys that exist ONLY on the source (not on dest) so we don't lose
// source-only metadata; never overwrites a dest key that the reducers manage.
function srcOnlyScalars(
  dest: Record<string, unknown>,
  src: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dest)) out[k] = v;
  }
  return out;
}

// Preserve a gate idempotency stamp: if both sides have it, keep the earliest
// (the original credit time); else whichever exists. Absent on both → omit.
function mergeGateStamp(
  key: string,
  dest: Record<string, unknown>,
  src: Record<string, unknown>,
): Record<string, unknown> {
  const d = dest[key] as TimeLike;
  const s = src[key] as TimeLike;
  if (d == null && s == null) return {};
  return { [key]: earliest(d, s) };
}
