import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
import { coerceMillis } from './lib/firestore-safe';

async function main() {
  const db = getAdminDb();
  const now = Date.now();
  // Window: now -> +72h so we catch "tomorrow" regardless of tz
  const windowEnd = now + 72 * 60 * 60 * 1000;

  const snap = await db
    .collection('broadcast-slots')
    .where('status', '==', 'scheduled')
    .get();

  const rows: any[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const start = coerceMillis(d.startTime);
    if (!start || start < now || start > windowEnd) return;
    const targets: string[] = [];
    if (Array.isArray(d.djSlots)) {
      for (const s of d.djSlots) {
        if (s?.djEmail) targets.push(`${s.djName || '?'} <${s.djEmail}>`);
      }
    }
    if (d.djEmail) targets.push(`${d.djName || '?'} <${d.djEmail}>`);
    rows.push({
      id: doc.id,
      start: new Date(start).toISOString(),
      show: d.showName,
      djName: d.djName,
      type: d.broadcastType || 'remote',
      goLiveEmailsDisabled: !!d.goLiveEmailsDisabled,
      reminder48hSentForDay: d.reminder48hEmailSentForDay || null,
      targets,
    });
  });

  rows.sort((a, b) => a.start.localeCompare(b.start));
  console.log(`Found ${rows.length} scheduled slot(s) in next 72h:\n`);
  for (const r of rows) {
    console.log(`[${r.start}]  ${r.type.toUpperCase()}  "${r.show}"  dj=${r.djName}`);
    console.log(`   id=${r.id}  goLiveEmailsDisabled=${r.goLiveEmailsDisabled}  reminder48hSentForDay=${r.reminder48hSentForDay}`);
    console.log(`   targets: ${r.targets.join(', ') || '(none)'}`);
    console.log('');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
