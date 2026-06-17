/**
 * Shared helpers for one-off / admin Firestore scripts.
 *
 * THE PROBLEM THIS PREVENTS
 * -------------------------
 * Firestore stores times as `Timestamp` objects. When a script does a
 * read-modify-write — `const data = doc.data(); ...; doc.ref.set(data)` or
 * `.update({ ...data, x })` — it is easy to accidentally flatten a Timestamp
 * into a plain `{_seconds, _nanoseconds}` object or a number, especially if the
 * value passes through `JSON.parse(JSON.stringify(...))`, a structured clone, an
 * HTTP boundary, or a spread that copies an already-flattened value. Once a time
 * field is a plain object, anything that calls `.toMillis()` on it throws — which
 * is exactly what blanked the broadcast-admin Schedule + Marketing tabs
 * (2026-06-17) and left ~71 corrupted time fields across the database.
 *
 * THE RULE
 * --------
 * NEVER write a whole doc back wholesale. Write only the fields you changed.
 * If you MUST write back a read object, run it through `reviveTimestamps()`
 * first so any flattened time fields become real Timestamps again. And when you
 * read a time field for logic, use `coerceMillis()` instead of `.toMillis()` so
 * a single bad doc can't throw.
 */
import { Timestamp } from 'firebase-admin/firestore';

/** True if v is a plain {_seconds,_nanoseconds} / {seconds,nanoseconds} object (a flattened Timestamp), NOT a real Timestamp. */
export function isPlainTsObject(v: unknown): v is { _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number } {
  if (v == null || typeof v !== 'object' || v instanceof Timestamp || v instanceof Date) return false;
  const o = v as Record<string, unknown>;
  const hasSeconds = typeof o._seconds === 'number' || typeof o.seconds === 'number';
  // Only treat as a flattened Timestamp if seconds is the *only* meaningful shape
  // (avoid misfiring on unrelated objects that happen to carry a `seconds` field).
  const keys = Object.keys(o);
  const allowed = new Set(['_seconds', 'seconds', '_nanoseconds', 'nanoseconds']);
  return hasSeconds && keys.every(k => allowed.has(k));
}

/** Convert a flattened-Timestamp plain object to a real Timestamp. Returns the value unchanged if it isn't one. */
export function toTimestamp(v: unknown): unknown {
  if (!isPlainTsObject(v)) return v;
  const o = v as { _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number };
  const seconds = (o._seconds ?? o.seconds) as number;
  const nanos = (o._nanoseconds ?? o.nanoseconds ?? 0) as number;
  return new Timestamp(seconds, nanos);
}

/**
 * Coerce any time-field shape to millis without throwing. Use this instead of
 * `someTimeField.toMillis()` when reading a time for comparison/logic. Handles
 * Timestamp, flattened {_seconds} object, Date, number, and ISO string.
 */
export function coerceMillis(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (isPlainTsObject(v)) {
    const o = v as { _seconds?: number; seconds?: number; _nanoseconds?: number; nanoseconds?: number };
    const seconds = (o._seconds ?? o.seconds) as number;
    const nanos = (o._nanoseconds ?? o.nanoseconds ?? 0) as number;
    return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  if (typeof v === 'string') { const p = Date.parse(v); return Number.isNaN(p) ? 0 : p; }
  return 0;
}

/**
 * Deep-revive any flattened-Timestamp plain objects inside a value back into
 * real Timestamps. Use this to sanitize a doc you intend to write back wholesale
 * (arrays and nested maps are walked too). Real Timestamps/Dates are left as-is.
 *
 * Returns the count of fields revived (for logging) via the optional `stats`.
 */
export function reviveTimestamps<T>(value: T, stats?: { count: number }): T {
  if (value == null) return value;
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (isPlainTsObject(value)) {
    if (stats) stats.count++;
    return toTimestamp(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => reviveTimestamps(v, stats)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reviveTimestamps(v, stats);
    }
    return out as T;
  }
  return value;
}
