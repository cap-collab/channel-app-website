/**
 * Repair flattened-Timestamp corruption across ALL collections.
 *
 * Finds every field whose value is a plain {_seconds,_nanoseconds} object (a
 * Timestamp that got flattened by a read-modify-write) and rewrites JUST that
 * field back to a real Timestamp. Walks nested maps/arrays too. Numbers and ISO
 * strings are left ALONE — those are legitimate by design in this codebase; only
 * the plain-object shape is corruption.
 *
 *   npx tsx scripts/fix-flattened-timestamps.ts            # dry run
 *   npx tsx scripts/fix-flattened-timestamps.ts --execute  # write
 */
import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
import { isPlainTsObject, toTimestamp } from './lib/firestore-safe';
import { Timestamp, FieldPath } from 'firebase-admin/firestore';

const EXECUTE = process.argv.includes('--execute');

// Recursively find dotted paths to flattened-Timestamp values, and build the
// revived replacement value for the TOP-LEVEL field that contains them.
// We only ever update top-level fields (with their fully-revived value) to keep
// writes minimal and avoid FieldPath escaping headaches on nested keys.
function reviveDeep(value: unknown, found: { n: number }): unknown {
  if (isPlainTsObject(value)) { found.n++; return toTimestamp(value); }
  if (value == null || value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map(v => reviveDeep(v, found));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = reviveDeep(v, found);
    return out;
  }
  return value;
}

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const collections = await db.listCollections();
  console.log(`${EXECUTE ? '=== EXECUTING ===' : '=== DRY RUN ==='}  scanning ${collections.length} collections\n`);

  let docsFixed = 0;
  let fieldsFixed = 0;
  const perField: Record<string, number> = {};

  for (const col of collections) {
    const snap = await col.get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const updates: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(data)) {
        const found = { n: 0 };
        const revived = reviveDeep(value, found);
        if (found.n > 0) {
          updates[field] = revived;
          fieldsFixed += found.n;
          const key = `${col.id}.${field}`;
          perField[key] = (perField[key] || 0) + found.n;
        }
      }
      if (Object.keys(updates).length > 0) {
        docsFixed++;
        console.log(`${EXECUTE ? 'FIX ' : 'would fix '} ${col.id}/${doc.id}  fields: ${Object.keys(updates).join(', ')}`);
        if (EXECUTE) {
          // Update each field by FieldPath to avoid dotted-key interpretation.
          const args: unknown[] = [];
          for (const [k, v] of Object.entries(updates)) { args.push(new FieldPath(k), v); }
          // @ts-expect-error variadic update(FieldPath, value, ...)
          await doc.ref.update(...args);
        }
      }
    }
  }

  console.log(`\nper-field counts:`);
  for (const k of Object.keys(perField).sort()) console.log(`  ${k}: ${perField[k]}`);
  console.log(`\n${EXECUTE ? 'fixed' : 'would fix'} ${fieldsFixed} flattened-Timestamp field(s) across ${docsFixed} doc(s)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
