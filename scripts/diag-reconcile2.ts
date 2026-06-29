import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  // archive resolution maps (same as cron)
  const archSnap = await db.collection('archives').get();
  const archiveBySlot = new Map<string, { id: string; data: any }>();
  const archiveById = new Map<string, { id: string; data: any }>();
  for (const d of archSnap.docs) {
    const e = { id: d.id, data: d.data() };
    archiveById.set(d.id, e);
    const sid = d.data().broadcastSlotId;
    if (sid) archiveBySlot.set(sid, e);
  }
  const archiveIdBySlot = new Map<string, string>();
  const slotsSnap = await db.collection('broadcast-slots').get();
  for (const d of slotsSnap.docs) {
    const aId = d.data().archiveId;
    if (aId) archiveIdBySlot.set(d.id, aId);
  }

  const cg = await db.collectionGroup('streamHistory')
    .where('sourceType', '==', 'live')
    .where('lastStreamedAt', '>=', new Date(0)).get();

  let total = 0, resolvable = 0, alreadyLinked = 0, needsLink = 0, noArchive = 0;
  const orphanShows = new Map<string, { name: string; cnt: number }>();
  for (const d of cg.docs) {
    total++;
    const dd = d.data();
    const slotId = (dd.archiveId as string) || d.id;
    const restreamAid = archiveIdBySlot.get(slotId);
    const archive = archiveBySlot.get(slotId) ?? (restreamAid ? archiveById.get(restreamAid) : undefined);
    if (!archive) { noArchive++; continue; }
    resolvable++;
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const linkRef = db.collection('users').doc(uid).collection('streamHistory').doc(archive.id);
    const exists = (await linkRef.get()).exists;
    if (exists) { alreadyLinked++; }
    else {
      needsLink++;
      const key = archive.id;
      const e = orphanShows.get(key) ?? { name: archive.data.showName || dd.showName || '?', cnt: 0 };
      e.cnt++; orphanShows.set(key, e);
    }
  }
  console.log(JSON.stringify({ total, resolvable, alreadyLinked, needsLink, noArchive }, null, 2));
  console.log('\n=== shows with UNLINKED live listens (would be backfilled) ===');
  for (const [aid, e] of [...orphanShows.entries()].sort((a,b)=>b[1].cnt-a[1].cnt)) {
    console.log(`${String(e.cnt).padStart(3)} listens  archive=${aid}  "${e.name}"`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
