import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  // resolution maps (same as cron)
  const archSnap = await db.collection('archives').get();
  const archiveBySlot = new Map<string, any>();
  const archiveById = new Map<string, any>();
  for (const d of archSnap.docs) { const e={id:d.id,data:d.data()}; archiveById.set(d.id,e); const sid=d.data().broadcastSlotId; if(sid)archiveBySlot.set(sid,e); }
  const archiveIdBySlot = new Map<string,string>();
  const slotsSnap = await db.collection('broadcast-slots').get();
  for (const d of slotsSnap.docs){const a=d.data().archiveId;if(a)archiveIdBySlot.set(d.id,a);}

  const isZnc=(s:string|undefined)=>!!s && s.toLowerCase().replace(/[\s-]+/g,'').includes('znc');

  // 1. znc archives
  console.log('=== archives crediting znc ===');
  const zncArchSlots = new Set<string>();
  for(const d of archSnap.docs){
    const a=d.data();
    const dn = Array.isArray(a.djs)?a.djs.map((x:any)=>x?.name).join(', '):'';
    const un = Array.isArray(a.djs)?a.djs.map((x:any)=>x?.username).join(', '):'';
    if(isZnc(dn)||isZnc(un)||isZnc(a.showName)){
      console.log(`archive=${d.id} show="${a.showName}" djs=[${dn}] usernames=[${un}] slot=${a.broadcastSlotId} streamCount=${a.streamCount}`);
      if(a.broadcastSlotId)zncArchSlots.add(a.broadcastSlotId);
    }
  }

  // 2. znc slots
  console.log('\n=== broadcast-slots crediting znc ===');
  const zncSlots = new Set<string>();
  for(const d of slotsSnap.docs){
    const s=d.data();
    const dn = Array.isArray(s.djs)?s.djs.map((x:any)=>x?.name).join(', '):'';
    const un = Array.isArray(s.djs)?s.djs.map((x:any)=>x?.username).join(', '):'';
    if(isZnc(dn)||isZnc(un)||isZnc(s.showName)||isZnc(s.djName)){
      zncSlots.add(d.id);
      const t=s.startTime??s.date; let ms=0; try{ms=t?.toMillis?.()??(t?._seconds?t._seconds*1000:0);}catch{}
      console.log(`slot=${d.id} show="${s.showName||s.title}" djName="${s.djName}" djs=[${dn}] type=${s.broadcastType} status=${s.status} archiveId=${s.archiveId||''} hasArchive=${archiveBySlot.has(d.id)} start=${ms?new Date(ms).toISOString():'?'}`);
    }
  }

  // 3. all live listens for any znc slot, and their link state
  console.log('\n=== live listens for znc slots + link state ===');
  const cg = await db.collectionGroup('streamHistory').where('sourceType','==','live').where('lastStreamedAt','>=',new Date(0)).get();
  const allZncSlotIds = new Set<string>([...zncSlots, ...zncArchSlots]);
  let needs=0, linked=0, noArch=0;
  for(const d of cg.docs){
    const dd=d.data();
    const slotId=(dd.archiveId as string)||d.id;
    // match either by slot membership OR by djs on the live doc
    const dn=Array.isArray(dd.djs)?dd.djs.map((x:any)=>x?.name).join(', '):'';
    const un=Array.isArray(dd.djUsernames)?dd.djUsernames.join(', '):'';
    if(!allZncSlotIds.has(slotId) && !isZnc(dn) && !isZnc(un) && !isZnc(dd.showName)) continue;
    const rid=archiveIdBySlot.get(slotId);
    const arch=archiveBySlot.get(slotId)??(rid?archiveById.get(rid):undefined);
    const uid=d.ref.parent.parent?.id;
    if(!arch){noArch++; console.log(`  [NO ARCHIVE] uid=${uid} slot=${slotId} show="${dd.showName}" djs=[${dn}]`); continue;}
    const exists=uid?(await db.collection('users').doc(uid).collection('streamHistory').doc(arch.id).get()).exists:false;
    if(exists)linked++; else needs++;
    console.log(`  ${exists?'LINKED ':'ORPHAN '} uid=${uid} slot=${slotId} -> archive=${arch.id} "${arch.data.showName}" streamCount=${dd.streamCount}`);
  }
  console.log(`\nznc summary: linked=${linked} orphan=${needs} noArchive=${noArch}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
