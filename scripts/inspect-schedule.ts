import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const snap = await db.collection('archive-schedule').doc('2026-05-09').get();
  const data = snap.data() ?? {};
  const items = (data.items as Array<Record<string, unknown>>) ?? [];
  console.log(`generatedBy=${data.generatedBy}, items=${items.length}`);
  console.log(`generatedAtMs=${data.generatedAtMs}`);
  let withScenes = 0;
  let withoutScenes = 0;
  for (const it of items) {
    if (Array.isArray(it.sceneSlugs) && it.sceneSlugs.length > 0) withScenes++;
    else withoutScenes++;
  }
  console.log(`items with sceneSlugs: ${withScenes}, without: ${withoutScenes}`);
  // Show what's at index 0 (the current item likely)
  console.log('First item:');
  console.log(JSON.stringify(items[0], null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
