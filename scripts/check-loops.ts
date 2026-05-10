import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';
import { LOOP_COLLECTION } from '../src/lib/archive-schedule';

async function main() {
  const db = getAdminDb();
  if (!db) { console.error('no db'); process.exit(1); }
  const snap = await db.collection(LOOP_COLLECTION).orderBy('loopNumber', 'desc').limit(10).get();
  console.log('loops found:', snap.size);
  for (const d of snap.docs) {
    const x = d.data();
    console.log(
      d.id,
      '| loop#', x.loopNumber,
      '| start', new Date(Number(x.startTimeMs)).toISOString(),
      '| dur(h)', (Number(x.totalDurationSec) / 3600).toFixed(2),
      '| items', Array.isArray(x.items) ? x.items.length : 0,
      '| stats', JSON.stringify(x.catalogStats),
      '| locked', x.locked,
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
