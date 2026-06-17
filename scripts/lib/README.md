# scripts/lib — shared helpers for admin / one-off Firestore scripts

## The timestamp-corruption rule (read this before writing a script that writes Firestore)

Firestore stores times as `Timestamp`. A read-modify-write that writes a doc
back **wholesale** can flatten a `Timestamp` into a plain `{_seconds,_nanoseconds}`
object or a number (via JSON round-trips, spreads of already-flattened values, an
HTTP boundary, etc.). Once flattened, any `.toMillis()` on it throws — this is what
blanked the broadcast-admin Schedule + Marketing tabs on 2026-06-17 and left ~130
corrupted time fields across the DB.

**Rules for scripts:**

1. **Never write a whole doc back.** Update only the fields you actually changed:
   `doc.ref.update({ priority: 'high' })`, not `doc.ref.set({ ...data, priority })`.
2. **If you must write back a read object**, run it through `reviveTimestamps()`
   first so flattened time fields become real `Timestamp`s again.
3. **When reading a time for logic**, use `coerceMillis(v)` instead of `v.toMillis()`
   so a single already-corrupt doc can't throw.

## Files

- `load-env.ts` — loads `.env.prod` (NOT `.env.local`). Side-effect import; put it FIRST.
- `firestore-safe.ts` — `isPlainTsObject`, `toTimestamp`, `coerceMillis`, `reviveTimestamps`.

## Maintenance scripts (repo root `scripts/`)

- `audit-timestamp-fields.ts` — READ-ONLY. Reports type distribution per time field;
  flags `plainTsObject` (corruption) and `MIXED` (design inconsistency). Re-run after
  any bulk script to catch regressions.
- `fix-flattened-timestamps.ts` — converts every `plainTsObject` time field back to a
  real `Timestamp`, per-field, dry-run by default. `--execute` to write.

## Usage

```ts
import './lib/load-env';                 // must be first
import { getAdminDb } from '../src/lib/firebase-admin';
import { coerceMillis, reviveTimestamps } from './lib/firestore-safe';
```
