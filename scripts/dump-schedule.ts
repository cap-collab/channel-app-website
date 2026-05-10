import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const dateArg = process.argv.find(a => a.startsWith('--date='));
  const date = dateArg ? dateArg.slice(7) : '2026-05-09';
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const snap = await db.collection('archive-schedule').doc(date).get();
  const data = snap.data() ?? {};
  const items = (data.items as Array<Record<string, unknown>>) ?? [];
  console.log(`${date} — ${items.length} items`);
  const seen = new Map<string, number[]>();
  items.forEach((it, idx) => {
    const id = it.archiveId as string;
    const offset = it.startOffsetSec as number;
    const hr = Math.floor(offset / 3600);
    console.log(`  ${String(idx).padStart(2)} | hr ${String(hr).padStart(2)} | ${id} | ${it.title}`);
    const arr = seen.get(id) ?? [];
    arr.push(hr);
    seen.set(id, arr);
  });
  console.log('\nRepeats within < 6h:');
  for (const [id, hrs] of seen) {
    if (hrs.length < 2) continue;
    for (let i = 1; i < hrs.length; i++) {
      if (hrs[i] - hrs[i-1] < 6) {
        console.log(`  ${id}: hours ${hrs.join(', ')} (gap ${hrs[i] - hrs[i-1]}h)`);
        break;
      }
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
