import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const snap = await db.collection('archive-schedule').doc('2026-05-09').get();
  if (!snap.exists) { console.log('doc missing'); return; }
  const data = snap.data() ?? {};
  const items = (data.items as Array<Record<string, unknown>>) ?? [];
  console.log(`generatedBy=${data.generatedBy} generatedAt=${data.generatedAt?.toDate?.()}`);
  console.log(`items=${items.length}`);
  for (const it of items.slice(0, 5)) {
    console.log(JSON.stringify({
      title: it.title,
      archiveId: it.archiveId,
      sceneSlugs: it.sceneSlugs,
      djs: it.djs,
    }, null, 2));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
