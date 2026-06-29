import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');
  const archSnap = await db.collection('archives').get();
  const archiveBySlot = new Map<string, any>();
  const archiveById = new Map<string, any>();
  for (const d of archSnap.docs) { const e={id:d.id,data:d.data()}; archiveById.set(d.id,e); const sid=d.data().broadcastSlotId; if(sid)archiveBySlot.set(sid,e); }
  const archiveIdBySlot = new Map<string,string>();
  const slotsSnap = await db.collection('broadcast-slots').get();
  for (const d of slotsSnap.docs){const a=d.data().archiveId;if(a)archiveIdBySlot.set(d.id,a);}

  const cg = await db.collectionGroup('streamHistory').where('sourceType','==','live').where('lastStreamedAt','>=',new Date(0)).get();
  const now=Date.now();
  // group needs-link by show with age + reconciledFromLive presence among already-linked
  type Row={name:string;needs:number;linked:number;newestMs:number;oldestMs:number};
  const m=new Map<string,Row>();
  for(const d of cg.docs){
    const dd=d.data();
    const slotId=(dd.archiveId as string)||d.id;
    const rid=archiveIdBySlot.get(slotId);
    const arch=archiveBySlot.get(slotId)??(rid?archiveById.get(rid):undefined);
    if(!arch)continue;
    const uid=d.ref.parent.parent?.id; if(!uid)continue;
    const exists=(await db.collection('users').doc(uid).collection('streamHistory').doc(arch.id).get()).exists;
    let ls=0; try{ls=dd.lastStreamedAt?.toMillis?.()??0;}catch{}
    const r=m.get(arch.id)??{name:arch.data.showName||'?',needs:0,linked:0,newestMs:0,oldestMs:Infinity};
    if(exists)r.linked++; else {r.needs++; if(ls>r.newestMs)r.newestMs=ls; if(ls<r.oldestMs)r.oldestMs=ls;}
    m.set(arch.id,r);
  }
  const rows=[...m.values()].filter(r=>r.needs>0).sort((a,b)=>b.newestMs-a.newestMs);
  let totalNeeds=0; for(const r of rows)totalNeeds+=r.needs;
  console.log(`shows with unlinked listens: ${rows.length} | total unlinked listens: ${totalNeeds}\n`);
  console.log('newest-unlinked-listen | needs | already | show');
  for(const r of rows){
    const age=r.newestMs?((now-r.newestMs)/86400000).toFixed(1)+'d':'?';
    console.log(`${(r.newestMs?new Date(r.newestMs).toISOString().slice(0,10):'?').padEnd(10)} (${age.padStart(6)}) | ${String(r.needs).padStart(3)} | ${String(r.linked).padStart(3)} | ${r.name}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
