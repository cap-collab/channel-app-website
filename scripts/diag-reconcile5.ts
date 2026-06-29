import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  // The 3 users flagged "needs link" for David L invites (archive 76xBieH5FtEolg89BGH6)
  const USERS = ['ZOdUDU6RpjNMfLEaa9NBcDkm85x1','ZzLjN712iwWvMyVSVlhc6muLk5v1','iRZUpjrzWzYQDZyugvsIaYCcdDo2'];
  const ARCH='76xBieH5FtEolg89BGH6';
  const SLOT='iKt6qWxshJZuRLjpLbmC';

  for(const uid of USERS){
    console.log(`\n===== uid=${uid} : FULL streamHistory =====`);
    const hist=await db.collection('users').doc(uid).collection('streamHistory').get();
    console.log(`(total docs: ${hist.size})`);
    for(const h of hist.docs){
      const d=h.data();
      // show every doc that could be the David L credit under ANY key/shape
      const rel = h.id===ARCH || h.id===SLOT || d.archiveId===ARCH || d.archiveId===SLOT || (d.showName||'').includes('David L');
      if(rel) console.log(`  docId=${h.id} sourceType=${d.sourceType} archiveId=${d.archiveId} slug=${d.slug} showName="${d.showName}" streamCount=${d.streamCount} reconciledFromLive=${d.reconciledFromLive}`);
    }
    // also: count archive-sourced docs total for this user
    const archDocs=hist.docs.filter(h=>h.data().sourceType==='archive');
    console.log(`  -> total sourceType:'archive' docs for this user: ${archDocs.length}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
