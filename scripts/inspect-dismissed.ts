import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
(async () => {
  const db = getAdminDb(); if (!db) throw new Error('no db');
  const uid='D7qeojfaJdNLUPPjz7FAAA0wi303';
  const ud=(await db.collection('users').doc(uid).get()).data()||{};
  const ids=Object.keys(ud.dismissedArchiveIds||{});
  console.log('dismissed archive ids:', ids);
  for (const id of ids) {
    const a=(await db.collection('archives').doc(id).get()).data();
    console.log(`  ${id}: ${a?.showName ?? '(missing)'}`);
  }
  process.exit(0);
})();
