/**
 * READ-ONLY audit: scan every collection for time-like fields and report the
 * type distribution per (collection, field). A field that is MOSTLY Timestamp
 * but partly number/object is the fingerprint of read-modify-write corruption.
 */
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.prod', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let val = m[2].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[m[1]] = val;
}
import { getAdminDb } from '../src/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Field is "time-like" if its name matches these patterns.
const TIME_NAME = /(^|[a-z])(At|Time|TimeMs|ExpiresAt|Date|edAt|RunAt)$/;
const EXTRA_TIME_FIELDS = new Set(['startTime', 'endTime', 'recordedAt', 'publishedAt', 'normalizedAt', 'tokenExpiresAt', 'createdAt', 'updatedAt', 'transferredAt', 'reallocatedAt', 'goLiveEmailsLastRunAt']);

function classify(v: unknown): string {
  if (v == null) return 'null';
  if (v instanceof Timestamp) return 'Timestamp';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('_seconds' in o || 'seconds' in o) return 'plainTsObject';
    return 'otherObject';
  }
  return typeof v;
}

function isTimeField(name: string): boolean {
  return EXTRA_TIME_FIELDS.has(name) || TIME_NAME.test(name);
}

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  const collections = await db.listCollections();
  console.log(`scanning ${collections.length} top-level collections...\n`);

  // (collection.field) -> { type -> count }
  const report: Record<string, Record<string, number>> = {};

  for (const col of collections) {
    const snap = await col.limit(2000).get();
    snap.forEach(doc => {
      const data = doc.data();
      for (const [k, v] of Object.entries(data)) {
        if (!isTimeField(k)) continue;
        const key = `${col.id}.${k}`;
        report[key] ??= {};
        const t = classify(v);
        report[key][t] = (report[key][t] || 0) + 1;
      }
    });
  }

  // Print: flag MIXED fields (more than one non-null type) and any with plainTsObject
  const keys = Object.keys(report).sort();
  console.log('collection.field  ->  type distribution   [FLAG]');
  console.log('='.repeat(80));
  for (const key of keys) {
    const dist = report[key];
    const nonNull = Object.keys(dist).filter(t => t !== 'null');
    const types = new Set(nonNull);
    const hasPlainObj = dist.plainTsObject > 0;
    const mixed = types.size > 1;
    const flag = hasPlainObj ? '  <<< CORRUPT (plain {_seconds})' : mixed ? '  <<< MIXED types' : '';
    console.log(`${key}  ->  ${JSON.stringify(dist)}${flag}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
