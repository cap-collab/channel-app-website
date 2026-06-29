import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  // Pick David L invites: slot iKt6qWxshJZuRLjpLbmC, archive 76xBieH5FtEolg89BGH6
  const SLOT = 'iKt6qWxshJZuRLjpLbmC';
  const ARCH = '76xBieH5FtEolg89BGH6';

  // All live listens for this slot, and whether each user has the archive-keyed doc
  const cg = await db.collectionGroup('streamHistory')
    .where('sourceType', '==', 'live')
    .where('lastStreamedAt', '>=', new Date(0)).get();

  console.log(`=== David L invites: slot=${SLOT} archive=${ARCH} ===`);
  for (const d of cg.docs) {
    const dd = d.data();
    const slotId = (dd.archiveId as string) || d.id;
    if (slotId !== SLOT) continue;
    const uid = d.ref.parent.parent?.id;
    // what archive-keyed docs does this user have?
    const archDoc = await db.collection('users').doc(uid!).collection('streamHistory').doc(ARCH).get();
    // also list ALL archive-sourced docs for this user that reference this slot/show, in case key differs
    const userHist = await db.collection('users').doc(uid!).collection('streamHistory').get();
    const related = userHist.docs
      .filter(h => h.id === ARCH || h.data().slug === '76' || (h.data().showName||'').includes('David L') || h.data().archiveId === ARCH)
      .map(h => ({ id: h.id, sourceType: h.data().sourceType, archiveId: h.data().archiveId, showName: h.data().showName, reconciledFromLive: h.data().reconciledFromLive }));
    console.log(`uid=${uid} liveDoc=${d.id} | archDoc(${ARCH}).exists=${archDoc.exists} | related=${JSON.stringify(related)}`);
  }

  // archive streamCount
  const a = await db.collection('archives').doc(ARCH).get();
  console.log(`\narchive.streamCount = ${a.data()?.streamCount}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
