import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const snap = await db.collection('archives').doc('PKHiDKklduYUyKehHMu5').get();
  const data = snap.data() ?? {};
  console.log({
    sceneSlugs: data.sceneSlugs,
    sceneIdsOverride: data.sceneIdsOverride,
    showName: data.showName,
  });
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
