/**
 * Manually send the 48h "test your audio setup" reminder for a SINGLE slot,
 * for DJs the broadcast-emails cron missed (e.g. scheduled inside the 46-50h
 * window so the cron never saw them).
 *
 * Replicates the exact production send path from
 *   src/app/api/cron/broadcast-emails/route.ts  (Phase 0 / run48hReminders)
 * — same target extraction, DJ lookup, tz-aware date formatting, and template.
 *
 * Does NOT touch the reminder48hEmailSent* dedup fields, and ignores the
 * cron's 46-50h window (that's the whole point — the cron already skipped it).
 *
 * Usage:
 *   npx tsx scripts/send-48h-reminder-for-slot.ts <slotId>          # dry-run (prints targets, sends nothing)
 *   npx tsx scripts/send-48h-reminder-for-slot.ts <slotId> --send   # actually send
 */
import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
import { sendBroadcast48HourReminderEmail } from '../src/lib/email';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

function toMillis(t: unknown): number {
  if (t && typeof t === 'object' && 'toMillis' in t) return (t as any).toMillis();
  if (t && typeof t === 'object' && '_seconds' in (t as any)) return (t as any)._seconds * 1000;
  return t as number;
}

interface EmailTarget {
  email: string;
  djName: string;
  startTime: number;
  endTime: number;
}

async function getDjEmailTargets(db: FirebaseFirestore.Firestore, slot: any): Promise<EmailTarget[]> {
  const targets: EmailTarget[] = [];

  if (Array.isArray(slot.djSlots) && slot.djSlots.length > 0) {
    for (const ds of slot.djSlots) {
      if (ds.djEmail) {
        targets.push({
          email: ds.djEmail,
          djName: ds.djName || 'there',
          startTime: toMillis(ds.startTime),
          endTime: toMillis(ds.endTime),
        });
      }
    }
  } else if (slot.djEmail) {
    targets.push({
      email: slot.djEmail,
      djName: slot.djName || 'there',
      startTime: toMillis(slot.startTime),
      endTime: toMillis(slot.endTime),
    });
  }

  // Collective fan-out to owners (mirrors the cron)
  const candidateSlug = slot.djUsername || slot.liveDjUsername;
  if (candidateSlug) {
    const collSnap = await db.collection('collectives').where('slug', '==', candidateSlug).limit(1).get();
    if (!collSnap.empty) {
      const cData = collSnap.docs[0].data();
      const ownerUids: string[] = Array.isArray(cData.owners) ? cData.owners : [];
      const startTime = toMillis(slot.startTime);
      const endTime = toMillis(slot.endTime);
      for (let i = 0; i < ownerUids.length; i += 10) {
        const chunk = ownerUids.slice(i, i + 10);
        if (chunk.length === 0) continue;
        const ownersSnap = await db.collection('users').where('__name__', 'in', chunk).get();
        ownersSnap.forEach((u) => {
          const data = u.data();
          if (typeof data.email === 'string' && data.email.length > 0) {
            targets.push({
              email: data.email,
              djName: data.chatUsername || data.name || data.displayName || 'there',
              startTime,
              endTime,
            });
          }
        });
      }
    }
  }

  const seen = new Map<string, EmailTarget>();
  for (const t of targets) seen.set(t.email.toLowerCase(), t);
  return Array.from(seen.values());
}

async function lookupDjInfo(db: FirebaseFirestore.Firestore, email: string) {
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!usersSnap.empty) {
    const user = usersSnap.docs[0].data();
    const djProfile = user.djProfile || {};
    const cadence = djProfile.residency?.cadence;
    return {
      name: user.name || djProfile.name || null,
      timezone: user.timezone || DEFAULT_TIMEZONE,
      isResident: cadence === 'monthly' || cadence === 'quarterly',
      signInMethod: typeof user.signInMethod === 'string' ? user.signInMethod : undefined,
      email,
    };
  }
  const pendingSnap = await db.collection('pending-dj-profiles').where('email', '==', email).limit(1).get();
  if (!pendingSnap.empty) {
    const profile = pendingSnap.docs[0].data();
    return { name: profile.name || null, timezone: DEFAULT_TIMEZONE, isResident: false, signInMethod: undefined, email };
  }
  return { name: null, timezone: DEFAULT_TIMEZONE, isResident: false, signInMethod: undefined, email };
}

function formatDate(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
}

function formatTimeRange(startTime: number, endTime: number, tz: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: tz };
  const start = new Date(startTime).toLocaleTimeString('en-US', opts);
  const end = new Date(endTime).toLocaleTimeString('en-US', opts);
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date(startTime)).find((p) => p.type === 'timeZoneName')?.value || tz;
  return `${start} – ${end} ${tzAbbr}`;
}

async function main() {
  const slotId = process.argv[2];
  const doSend = process.argv.includes('--send');
  if (!slotId) {
    console.error('Usage: npx tsx scripts/send-48h-reminder-for-slot.ts <slotId> [--send]');
    process.exit(1);
  }

  const db = getAdminDb();
  const snap = await db.collection('broadcast-slots').doc(slotId).get();
  if (!snap.exists) { console.error(`Slot ${slotId} not found`); process.exit(1); }
  const slot = snap.data()!;

  console.log(`Slot: "${slot.showName}"  dj=${slot.djName}  type=${slot.broadcastType || 'remote'}`);
  console.log(`Start: ${new Date(toMillis(slot.startTime)).toISOString()}`);
  console.log(`Dedup: reminder48hEmailSentForDay=${slot.reminder48hEmailSentForDay || null} (NOT modified by this script)\n`);

  if (slot.broadcastType === 'restream' || slot.broadcastType === 'anchor') {
    console.warn(`⚠️  broadcastType is ${slot.broadcastType} — cron would normally skip this. Proceeding anyway (manual override).`);
  }

  const targets = await getDjEmailTargets(db, slot);
  if (targets.length === 0) { console.error('No email targets on this slot.'); process.exit(1); }

  for (const target of targets) {
    const info = await lookupDjInfo(db, target.email);
    const tz = info.timezone;
    const line = {
      to: target.email,
      djName: info.name || target.djName,
      showName: slot.showName || 'Your show',
      startTime: formatDate(target.startTime, tz),
      timeRange: formatTimeRange(target.startTime, target.endTime, tz),
      isResident: info.isResident,
      resolvedSubject: info.isResident ? 'Looking forward to your show' : 'Test your audio set up, please',
    };
    console.log(`→ ${line.to}`);
    console.log(`   djName=${line.djName}  isResident=${line.isResident}  subject="${line.resolvedSubject}"`);
    console.log(`   ${line.showName} — ${line.startTime}, ${line.timeRange}`);

    if (!doSend) { console.log('   (dry-run — not sent)\n'); continue; }

    const ok = await sendBroadcast48HourReminderEmail({
      to: target.email,
      djName: info.name || target.djName,
      showName: slot.showName || 'Your show',
      broadcastUrl: '',
      profileUrl: null,
      startTime: formatDate(target.startTime, tz),
      timeRange: formatTimeRange(target.startTime, target.endTime, tz),
      isResident: info.isResident,
      signInMethod: info.signInMethod,
      signInEmail: info.email,
    });
    console.log(ok ? '   ✅ sent\n' : '   ❌ send failed\n');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
