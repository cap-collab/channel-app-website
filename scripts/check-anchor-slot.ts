import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb(); if (!db) throw new Error('no db');
  // Is etcradio a collective?
  const coll = await db.collection('collectives').where('slug', '==', 'etcradio').limit(1).get();
  console.log(`collectives where slug==etcradio: ${coll.size}`);
  coll.docs.forEach(d => console.log(`  owners: ${JSON.stringify(d.data().owners)}`));

  // Does the etcradio user exist + is it a DJ?
  const u = await db.collection('users').doc('7aEGF1QPxWhi0ZxyDAuxlnzH4ep2').get();
  console.log(`\nuser 7aEGF1QPxWhi0ZxyDAuxlnzH4ep2 exists: ${u.exists}`);
  if (u.exists) {
    const d = u.data() as any;
    console.log(`  chatUsername: ${d.chatUsername} / norm: ${d.chatUsernameNormalized}`);
    console.log(`  isDJ/role: ${d.isDJ} ${d.role} djProfile? ${!!d.djProfile}`);
  }

  // How many users favorite/watchlist "featuring danyo" by show name? (favorites collection)
  // favorites are subcollection per-user typically; just sample the structure.
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
