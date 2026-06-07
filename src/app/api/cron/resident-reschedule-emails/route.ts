import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { sendResidentRescheduleEmail } from '@/lib/email';
import { resolveFirstName, EXCLUDE_EMAILS } from '@/lib/channel-newsletter';
import { normalizeUsername } from '@/lib/dj-matching';

// One full sweep of broadcast-slots per run, in memory. Roster is ~tens of
// residents — runs comfortably under the default budget, but give it headroom.
export const maxDuration = 120;

// Eligibility windows.
const RECENT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000; // played OR uploaded in last 3 weeks
const UPCOMING_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // nothing booked in next 60 days
// Don't re-nudge the same DJ more than once every 30 days.
const RENUDGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

function toMillis(t: unknown): number | null {
  if (t && typeof t === 'object' && 'toMillis' in t) return (t as Timestamp).toMillis();
  if (typeof t === 'number') return t;
  return null;
}

interface Resident {
  userId: string;
  email: string;
  firstName: string;
  usernames: Set<string>; // normalized usernames this resident may appear under
  hasUpcoming: boolean; // a non-cancelled slot in (now, now + 60d]
  playedRecently: boolean; // a slot that ended within the last 3 weeks
  uploadedRecently: boolean; // an archive recording uploaded within the last 3 weeks
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not available' }, { status: 500 });
  }
  const now = Date.now();
  const upcomingCutoff = now + UPCOMING_WINDOW_MS;
  const recentCutoff = now - RECENT_WINDOW_MS;

  // ── 1. Gather monthly residents ──────────────────────────────────────
  // residency.cadence is a nested field; query the (small) DJ roster and
  // filter in memory rather than relying on a nested-field index.
  const djsSnap = await db.collection('users').where('role', '==', 'dj').get();

  const residents: Resident[] = [];
  const byUserId = new Map<string, Resident>();
  const byUsername = new Map<string, Resident>();
  // Raw user doc data, keyed by userId — used later to read lastResidentNudgeAt.
  const byUserIdData = new Map<string, FirebaseFirestore.DocumentData>();

  for (const doc of djsSnap.docs) {
    const data = doc.data();
    if (data.djProfile?.residency?.cadence !== 'monthly') continue;

    const email = typeof data.email === 'string' ? data.email.trim() : '';
    if (!email) continue;
    if (EXCLUDE_EMAILS.has(email)) continue;
    // Honour DJ-insiders unsubscribe (same gate as the newsletter DJ cohort).
    if (data.emailNotifications?.djInsiders === false) continue;
    if (data.emailNotifications?.marketing === false) continue;

    const usernames = new Set<string>();
    for (const u of [data.chatUsernameNormalized, data.chatUsername]) {
      if (typeof u === 'string' && u.trim()) usernames.add(normalizeUsername(u));
    }

    const resident: Resident = {
      userId: doc.id,
      email,
      firstName: resolveFirstName(email, data.name, data.chatUsername, data.displayName),
      usernames,
      hasUpcoming: false,
      playedRecently: false,
      uploadedRecently: false,
    };
    residents.push(resident);
    byUserId.set(doc.id, resident);
    byUserIdData.set(doc.id, data);
    for (const u of Array.from(usernames)) byUsername.set(u, resident);
  }

  if (residents.length === 0) {
    return NextResponse.json({ ok: true, residents: 0, sent: 0 });
  }

  const resolveResidents = (djUserId?: unknown, djUsername?: unknown): Resident[] => {
    const hits: Resident[] = [];
    if (typeof djUserId === 'string' && byUserId.has(djUserId)) {
      hits.push(byUserId.get(djUserId)!);
    }
    if (typeof djUsername === 'string' && djUsername.trim()) {
      const r = byUsername.get(normalizeUsername(djUsername));
      if (r && !hits.includes(r)) hits.push(r);
    }
    return hits;
  };

  // ── 2. Single sweep of broadcast-slots ───────────────────────────────
  // Each slot may name a DJ at the slot level (djUserId / djUsername) and/or
  // inside djSlots[] for multi-DJ venue shows. Per resident we flag whether
  // they have an upcoming slot (next 60d) or played one recently (last 3 weeks).
  const markSlot = (r: Resident, startMs: number, endMs: number | null) => {
    if (startMs > now && startMs <= upcomingCutoff) r.hasUpcoming = true;
    // Count a show as "played" once it has ended.
    if (endMs !== null && endMs <= now && endMs >= recentCutoff) r.playedRecently = true;
  };

  const slotsSnap = await db.collection('broadcast-slots').get();
  for (const doc of slotsSnap.docs) {
    const slot = doc.data();
    if (slot.status === 'cancelled' || slot.broadcastType === 'recording') continue;

    const slotStart = toMillis(slot.startTime);
    const slotEnd = toMillis(slot.endTime);

    // Slot-level DJ.
    if (slotStart !== null) {
      for (const r of resolveResidents(slot.djUserId, slot.djUsername)) {
        markSlot(r, slotStart, slotEnd);
      }
    }

    // Multi-DJ venue slots — each entry can have its own DJ + times.
    const djSlots = Array.isArray(slot.djSlots) ? slot.djSlots : [];
    for (const ds of djSlots) {
      const dsStart = toMillis(ds.startTime) ?? slotStart;
      const dsEnd = toMillis(ds.endTime) ?? slotEnd;
      if (dsStart === null) continue;
      for (const r of resolveResidents(ds.djUserId, ds.djUsername)) {
        markSlot(r, dsStart, dsEnd);
      }
    }
  }

  // ── 3. Sweep archives for recent uploads ─────────────────────────────
  // A recording uploaded in the last 3 weeks counts as recent activity even
  // if the DJ never did a live slot. createdAt is the upload moment — but it's
  // stored inconsistently across creation paths (millis number from uploads,
  // Firestore Timestamp from live-recorded/published shows), so we can't use a
  // server-side `where` (it wouldn't compare a number filter against Timestamp
  // docs). Sweep the collection and normalize each createdAt in memory instead.
  const archivesSnap = await db.collection('archives').get();
  for (const doc of archivesSnap.docs) {
    const arch = doc.data();
    const createdAt = toMillis(arch.createdAt);
    if (createdAt === null || createdAt < recentCutoff) continue;
    const djs = Array.isArray(arch.djs) ? arch.djs : [];
    for (const dj of djs) {
      for (const r of resolveResidents(dj.userId, dj.username)) {
        r.uploadedRecently = true;
      }
    }
  }

  // ── 4. Decide + send ─────────────────────────────────────────────────
  let sent = 0;
  let skippedRenudge = 0;
  const sentTo: string[] = [];

  for (const r of residents) {
    if (r.hasUpcoming) continue; // already booked within 60 days
    if (r.playedRecently) continue; // played a slot in the last 3 weeks
    if (r.uploadedRecently) continue; // uploaded a recording in the last 3 weeks

    // 30-day re-nudge guard.
    const data = byUserIdData.get(r.userId);
    const lastNudge = toMillis(data?.lastResidentNudgeAt);
    if (lastNudge !== null && now - lastNudge < RENUDGE_INTERVAL_MS) {
      skippedRenudge++;
      continue;
    }

    const ok = await sendResidentRescheduleEmail({
      to: r.email,
      djName: r.firstName,
    });

    if (ok) {
      await db
        .collection('users')
        .doc(r.userId)
        .update({ lastResidentNudgeAt: Timestamp.fromMillis(now) });
      sent++;
      sentTo.push(r.email);
    }
  }

  return NextResponse.json({
    ok: true,
    residents: residents.length,
    sent,
    skippedRenudge,
    sentTo,
  });
}
