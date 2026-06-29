import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  if (!db) throw new Error('no db');

  const NEEDLES = ['dewpont', 'keppy', 'b rod', 'brod', 'b. rod', 'david l'];
  const matches = (s: string | undefined) =>
    !!s && NEEDLES.some((n) => s.toLowerCase().includes(n));

  // 1. status doc
  const status = await db.collection('system').doc('reconcile-live-streams-status').get();
  console.log('=== reconcile status ===');
  console.log(JSON.stringify(status.data(), null, 2));

  const now = Date.now();
  const WEEK = 8 * 24 * 60 * 60 * 1000;

  // 2. slots in the last ~8 days that look like our shows
  console.log('\n=== broadcast-slots (last ~8d, name match) ===');
  const slotsSnap = await db.collection('broadcast-slots').get();
  const interestingSlots: any[] = [];
  for (const d of slotsSnap.docs) {
    const s = d.data();
    const name = (s.showName || s.title || s.djName || '') as string;
    const djNames = Array.isArray(s.djs) ? s.djs.map((x: any) => x?.name).join(', ') : '';
    if (matches(name) || matches(djNames)) {
      // try to resolve a start time
      const t = s.startTime ?? s.scheduledStartTime ?? s.date;
      let ms = 0;
      try { ms = t?.toMillis?.() ?? (typeof t === 'number' ? t : (t?._seconds ? t._seconds * 1000 : 0)); } catch {}
      interestingSlots.push({
        id: d.id,
        name,
        djNames,
        broadcastType: s.broadcastType,
        status: s.status,
        archiveId: s.archiveId,
        recordings: Array.isArray(s.recordings) ? s.recordings.length : 0,
        startMs: ms,
        startISO: ms ? new Date(ms).toISOString() : null,
        ageDays: ms ? ((now - ms) / 86400000).toFixed(1) : null,
        goLiveEmailsDisabled: s.goLiveEmailsDisabled,
      });
    }
  }
  interestingSlots.sort((a, b) => (b.startMs || 0) - (a.startMs || 0));
  for (const s of interestingSlots) console.log(JSON.stringify(s));

  // 3. archives matching those names
  console.log('\n=== archives (name match) ===');
  const archSnap = await db.collection('archives').get();
  const archBySlot = new Map<string, any>();
  for (const d of archSnap.docs) {
    const a = d.data();
    if (a.broadcastSlotId) archBySlot.set(a.broadcastSlotId, { id: d.id, ...a });
    const name = (a.showName || '') as string;
    const djNames = Array.isArray(a.djs) ? a.djs.map((x: any) => x?.name).join(', ') : '';
    if (matches(name) || matches(djNames)) {
      console.log(JSON.stringify({
        id: d.id,
        showName: name,
        djNames,
        broadcastSlotId: a.broadcastSlotId,
        streamCount: a.streamCount,
        priority: a.priority,
        createdAtISO: a.createdAt?.toMillis ? new Date(a.createdAt.toMillis()).toISOString() : null,
      }));
    }
  }

  // 4. for each interesting slot, does an archive exist keyed to it?
  console.log('\n=== slot → archive resolution ===');
  for (const s of interestingSlots) {
    const arch = archBySlot.get(s.id);
    console.log(`${s.name} [slot ${s.id}] (${s.startISO}, ${s.ageDays}d ago) -> archive: ${arch ? arch.id + ' (' + arch.showName + ')' : 'NONE'}`);
  }

  // 5. check streamHistory live docs for these slots — were there live listens? and within 25h?
  console.log('\n=== live streamHistory docs for these slots (single CG scan) ===');
  const CUTOFF = now - 25 * 60 * 60 * 1000;
  const slotIds = new Set(interestingSlots.map((s) => s.id));
  const perSlot = new Map<string, { count: number; recent: number; samples: any[] }>();
  // Use the composite index (matches the cron) but with an open lower bound so we
  // see ALL live docs regardless of age — epoch 0 cutoff.
  const cg = await db
    .collectionGroup('streamHistory')
    .where('sourceType', '==', 'live')
    .where('lastStreamedAt', '>=', new Date(0))
    .get();
  console.log(`(total live streamHistory docs in DB: ${cg.size})`);
  for (const d of cg.docs) {
    const dd = d.data();
    const sid = (dd.archiveId as string) || d.id;
    const key = slotIds.has(sid) ? sid : (slotIds.has(d.id) ? d.id : null);
    if (!key) continue;
    let lsMs = 0;
    try { lsMs = dd.lastStreamedAt?.toMillis?.() ?? (dd.lastStreamedAt?._seconds ? dd.lastStreamedAt._seconds * 1000 : 0); } catch {}
    const e = perSlot.get(key) ?? { count: 0, recent: 0, samples: [] };
    e.count++;
    if (lsMs >= CUTOFF) e.recent++;
    if (e.samples.length < 3) e.samples.push({ uid: d.ref.parent.parent?.id, lastStreamedISO: lsMs ? new Date(lsMs).toISOString() : null, ageDays: lsMs ? ((now - lsMs) / 86400000).toFixed(1) : null, streamCount: dd.streamCount });
    perSlot.set(key, e);
  }
  for (const s of interestingSlots) {
    const e = perSlot.get(s.id);
    console.log(`slot ${s.id} (${s.name}): live listen docs=${e?.count ?? 0}, recent(<25h)=${e?.recent ?? 0}, samples=${JSON.stringify(e?.samples ?? [])}`);
  }

  // 6. ALL live streamHistory docs, grouped by slot, sorted by recency — the full
  // picture of what the cron's discovery query can see.
  console.log('\n=== ALL live streamHistory docs grouped by slotId (recency) ===');
  const bySlot = new Map<string, { count: number; maxMs: number; showName: string; djNames: string }>();
  for (const d of cg.docs) {
    const dd = d.data();
    const sid = (dd.archiveId as string) || d.id;
    let lsMs = 0;
    try { lsMs = dd.lastStreamedAt?.toMillis?.() ?? (dd.lastStreamedAt?._seconds ? dd.lastStreamedAt._seconds * 1000 : 0); } catch {}
    const dn = Array.isArray(dd.djs) ? dd.djs.map((x: any) => x?.name).join(', ') : '';
    const e = bySlot.get(sid) ?? { count: 0, maxMs: 0, showName: dd.showName || '', djNames: dn };
    e.count++;
    if (lsMs > e.maxMs) e.maxMs = lsMs;
    if (!e.showName && dd.showName) e.showName = dd.showName;
    if (!e.djNames && dn) e.djNames = dn;
    bySlot.set(sid, e);
  }
  const rows = [...bySlot.entries()].sort((a, b) => b[1].maxMs - a[1].maxMs);
  for (const [sid, e] of rows.slice(0, 30)) {
    const inWindow = e.maxMs >= CUTOFF;
    const archived = archBySlot.has(sid) || [...archBySlot.values()].some(() => false);
    console.log(`${e.maxMs ? new Date(e.maxMs).toISOString() : 'NO-TS'} (${e.maxMs ? ((now - e.maxMs)/86400000).toFixed(1)+'d' : '?'}) win=${inWindow ? 'YES' : 'no '} listens=${e.count} slot=${sid} "${e.showName}" [${e.djNames}]`);
  }

  // 7. recent completed slots (last 8d) regardless of name, to find Dewpont/Keppy
  console.log('\n=== recent completed slots (last 8d, any name) ===');
  const recent: any[] = [];
  for (const d of slotsSnap.docs) {
    const s = d.data();
    const t = s.startTime ?? s.scheduledStartTime ?? s.date;
    let ms = 0;
    try { ms = t?.toMillis?.() ?? (typeof t === 'number' ? t : (t?._seconds ? t._seconds * 1000 : 0)); } catch {}
    if (ms && now - ms <= WEEK && now - ms >= -86400000) {
      const djNames = Array.isArray(s.djs) ? s.djs.map((x: any) => x?.name).join(', ') : '';
      recent.push({ id: d.id, name: s.showName || s.title || s.djName || '', djNames, type: s.broadcastType, status: s.status, recordings: Array.isArray(s.recordings) ? s.recordings.length : 0, startISO: new Date(ms).toISOString(), hasArchive: archBySlot.has(d.id) });
    }
  }
  recent.sort((a, b) => a.startISO < b.startISO ? 1 : -1);
  for (const r of recent) console.log(JSON.stringify(r));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
