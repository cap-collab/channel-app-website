import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  sendBroadcastReminderEmail,
  sendBroadcast2HourReminderEmail,
  sendPostBroadcastEmail,
} from '@/lib/email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com';

// Verify request is from Vercel Cron or has valid secret
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// ── Shared helpers ──────────────────────────────────────────────────

interface DJSlot {
  id: string;
  djName?: string;
  djEmail?: string;
  djUsername?: string;
  startTime: number;
  endTime: number;
}

interface EmailTarget {
  email: string;
  djName: string;
  startTime: number;
  endTime: number;
  djUsername?: string;
}

// Convert Firestore Timestamp or millis number to millis
function toMillis(t: unknown): number {
  if (t && typeof t === 'object' && 'toMillis' in t) return (t as Timestamp).toMillis();
  return t as number;
}

// Extract email targets from a broadcast slot (handles single-DJ and multi-DJ venue slots)
function getDjEmailTargets(slot: FirebaseFirestore.DocumentData): EmailTarget[] {
  const targets: EmailTarget[] = [];

  if (slot.djSlots && Array.isArray(slot.djSlots) && slot.djSlots.length > 0) {
    for (const djSlot of slot.djSlots as DJSlot[]) {
      if (djSlot.djEmail) {
        targets.push({
          email: djSlot.djEmail,
          djName: djSlot.djName || 'there',
          startTime: toMillis(djSlot.startTime),
          endTime: toMillis(djSlot.endTime),
          djUsername: djSlot.djUsername,
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

  return targets;
}

interface DjInfo {
  username: string | null;
  name: string | null;
  timezone: string;
  hasTipLink: boolean;
  hasLocation: boolean;
  hasGenres: boolean;
  photoUrl: string | null;
  genres: string[];
  bio: string | null;
}

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

// Look up DJ info from users or pending-dj-profiles collection
async function lookupDjInfo(db: FirebaseFirestore.Firestore, email: string): Promise<DjInfo> {
  // Check users collection first
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!usersSnap.empty) {
    const user = usersSnap.docs[0].data();
    const djProfile = user.djProfile || {};
    return {
      username: user.chatUsernameNormalized || null,
      name: user.name || djProfile.name || null,
      timezone: user.timezone || DEFAULT_TIMEZONE,
      hasTipLink: !!djProfile.tipButtonLink,
      hasLocation: !!djProfile.location,
      hasGenres: Array.isArray(djProfile.genres) && djProfile.genres.length > 0,
      photoUrl: djProfile.photoUrl || null,
      genres: Array.isArray(djProfile.genres) ? djProfile.genres : [],
      bio: djProfile.bio || null,
    };
  }
  // Check pending-dj-profiles
  const pendingSnap = await db.collection('pending-dj-profiles').where('email', '==', email).limit(1).get();
  if (!pendingSnap.empty) {
    const profile = pendingSnap.docs[0].data();
    return {
      username: profile.chatUsernameNormalized || null,
      name: profile.name || null,
      timezone: DEFAULT_TIMEZONE,
      hasTipLink: false,
      hasLocation: false,
      hasGenres: false,
      photoUrl: profile.photoUrl || null,
      genres: Array.isArray(profile.genres) ? profile.genres : [],
      bio: profile.bio || null,
    };
  }
  return { username: null, name: null, timezone: DEFAULT_TIMEZONE, hasTipLink: false, hasLocation: false, hasGenres: false, photoUrl: null, genres: [], bio: null };
}

// Build a natural-language string of missing profile items
function buildMissingItems(info: DjInfo): string | null {
  const items: string[] = [];
  if (!info.hasLocation) items.push('your location');
  if (!info.hasGenres) items.push('genre');
  if (!info.hasTipLink) items.push('a tip link');

  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items[0]}, ${items[1]}, and ${items[2]}`;
}

// Format date for email display
function formatDate(timestamp: number, timezone: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  });
}

// Format time range for email display
function formatTimeRange(startTime: number, endTime: number, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  const start = new Date(startTime).toLocaleTimeString('en-US', opts);
  const end = new Date(endTime).toLocaleTimeString('en-US', opts);
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date(startTime))
    .find(p => p.type === 'timeZoneName')?.value || timezone;
  return `${start} – ${end} ${tzAbbr}`;
}

// Build social card image URL for email embedding
function buildSocialCardUrl(params: {
  showName: string;
  djName: string;
  startTime: number;
  imageUrl?: string | null;
  genres?: string[];
  description?: string | null;
}): string {
  const url = new URL(`${APP_URL}/api/social-card`);
  url.searchParams.set('showName', params.showName);
  url.searchParams.set('djName', params.djName);
  url.searchParams.set('startTime', String(params.startTime));
  if (params.imageUrl) url.searchParams.set('imageUrl', params.imageUrl);
  if (params.genres && params.genres.length > 0) url.searchParams.set('genres', params.genres.join(','));
  if (params.description) url.searchParams.set('description', params.description);
  return url.toString();
}

// ── Phase results ─────────────────────────────────────────���─────────

interface PhaseResult {
  sent: number;
  skipped: number;
  errors: string[];
}

// ── Main cron handler ───────────────────────────────────────────────
// Runs every 2 hours. Three phases: 24h reminder, 2h reminder, post-broadcast thank you.

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const now = Date.now();

    // ── Phase 1: 24h reminders ────────────────────────────────────
    const phase1 = await run24hReminders(db, now);

    // ── Phase 2: 2h reminders ─────────────────────────────────────
    const phase2 = await run2hReminders(db, now);

    // ── Phase 3: Post-broadcast thank you ─────────────────────────
    const phase3 = await runPostBroadcast(db, now);

    const allErrors = [...phase1.errors, ...phase2.errors, ...phase3.errors];

    console.log(`[broadcast-emails] Phase 1 (24h): sent=${phase1.sent}, skipped=${phase1.skipped}`);
    console.log(`[broadcast-emails] Phase 2 (2h): sent=${phase2.sent}, skipped=${phase2.skipped}`);
    console.log(`[broadcast-emails] Phase 3 (post): sent=${phase3.sent}, skipped=${phase3.skipped}`);

    return NextResponse.json({
      success: true,
      phase1: { sent: phase1.sent, skipped: phase1.skipped },
      phase2: { sent: phase2.sent, skipped: phase2.skipped },
      phase3: { sent: phase3.sent, skipped: phase3.skipped },
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (error) {
    console.error('Error in broadcast-emails cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── Phase 1: 24h reminders ──────────────────────────────────────────

async function run24hReminders(db: FirebaseFirestore.Firestore, now: number): Promise<PhaseResult> {
  const result: PhaseResult = { sent: 0, skipped: 0, errors: [] };

  // Window: 22-26h from now (wide enough for 2h cron cycle)
  const windowStart = Timestamp.fromMillis(now + 22 * 60 * 60 * 1000);
  const windowEnd = Timestamp.fromMillis(now + 26 * 60 * 60 * 1000);

  const snapshot = await db
    .collection('broadcast-slots')
    .where('status', '==', 'scheduled')
    .where('startTime', '>=', windowStart)
    .where('startTime', '<=', windowEnd)
    .get();

  for (const doc of snapshot.docs) {
    const slot = doc.data();

    if (slot.broadcastType === 'restream') { result.skipped++; continue; }
    if (slot.reminderEmailSentAt) { result.skipped++; continue; }

    const showName = slot.showName || 'Your show';
    const broadcastUrl = `${APP_URL}/broadcast/live?token=${slot.broadcastToken}`;
    const targets = getDjEmailTargets(slot);

    for (const target of targets) {
      try {
        const djInfo = await lookupDjInfo(db, target.email);
        const djUsername = target.djUsername || djInfo.username;
        const djTimezone = djInfo.timezone;

        const djImageUrl = slot.showImageUrl || slot.liveDjPhotoUrl || djInfo.photoUrl;
        const socialCardUrl = buildSocialCardUrl({
          showName,
          djName: djInfo.name || target.djName,
          startTime: target.startTime,
          imageUrl: djImageUrl,
          genres: djInfo.genres,
          description: djInfo.bio,
        });

        const success = await sendBroadcastReminderEmail({
          to: target.email,
          djName: djInfo.name || target.djName,
          showName,
          broadcastUrl,
          profileUrl: djUsername ? `${APP_URL}/dj/${djUsername}` : null,
          startTime: formatDate(target.startTime, djTimezone),
          timeRange: formatTimeRange(target.startTime, target.endTime, djTimezone),
          socialCardUrl,
          hasDjPhoto: !!djImageUrl,
        });

        if (success) { result.sent++; } else { result.errors.push(`Failed to send 24h reminder to ${target.email}`); }
      } catch (error) {
        result.errors.push(`Error sending 24h reminder to ${target.email}: ${error}`);
      }
    }

    await doc.ref.update({ reminderEmailSentAt: now });
  }

  return result;
}

// ── Phase 2: 2h reminders ───────────────────────────────────────────

async function run2hReminders(db: FirebaseFirestore.Firestore, now: number): Promise<PhaseResult> {
  const result: PhaseResult = { sent: 0, skipped: 0, errors: [] };

  // Window: 1-3h from now (wide enough for 2h cron cycle)
  const windowStart = Timestamp.fromMillis(now + 1 * 60 * 60 * 1000);
  const windowEnd = Timestamp.fromMillis(now + 3 * 60 * 60 * 1000);

  const snapshot = await db
    .collection('broadcast-slots')
    .where('status', '==', 'scheduled')
    .where('startTime', '>=', windowStart)
    .where('startTime', '<=', windowEnd)
    .get();

  for (const doc of snapshot.docs) {
    const slot = doc.data();

    if (slot.broadcastType === 'restream') { result.skipped++; continue; }
    if (slot.reminder2hEmailSentAt) { result.skipped++; continue; }

    const showName = slot.showName || 'Your show';
    const broadcastUrl = `${APP_URL}/broadcast/live?token=${slot.broadcastToken}`;
    const targets = getDjEmailTargets(slot);

    for (const target of targets) {
      try {
        const djInfo = await lookupDjInfo(db, target.email);
        const djTimezone = djInfo.timezone;

        const djImageUrl = slot.showImageUrl || slot.liveDjPhotoUrl || djInfo.photoUrl;
        const socialCardUrl = buildSocialCardUrl({
          showName,
          djName: djInfo.name || target.djName,
          startTime: target.startTime,
          imageUrl: djImageUrl,
          genres: djInfo.genres,
          description: djInfo.bio,
        });

        const success = await sendBroadcast2HourReminderEmail({
          to: target.email,
          djName: djInfo.name || target.djName,
          showName,
          broadcastUrl,
          profileUrl: null,
          startTime: formatDate(target.startTime, djTimezone),
          timeRange: formatTimeRange(target.startTime, target.endTime, djTimezone),
          socialCardUrl,
          hasDjPhoto: !!djImageUrl,
        });

        if (success) { result.sent++; } else { result.errors.push(`Failed to send 2h reminder to ${target.email}`); }
      } catch (error) {
        result.errors.push(`Error sending 2h reminder to ${target.email}: ${error}`);
      }
    }

    await doc.ref.update({ reminder2hEmailSentAt: now });
  }

  return result;
}

// ── Phase 3: Post-broadcast thank you ───────────────────────────────

async function runPostBroadcast(db: FirebaseFirestore.Firestore, now: number): Promise<PhaseResult> {
  const result: PhaseResult = { sent: 0, skipped: 0, errors: [] };

  // Window: 22-26h ago (wide enough for 2h cron cycle)
  const windowStart = Timestamp.fromMillis(now - 26 * 60 * 60 * 1000);
  const windowEnd = Timestamp.fromMillis(now - 22 * 60 * 60 * 1000);

  const snapshot = await db
    .collection('broadcast-slots')
    .where('status', '==', 'completed')
    .where('endTime', '>=', windowStart)
    .where('endTime', '<=', windowEnd)
    .get();

  for (const doc of snapshot.docs) {
    const slot = doc.data();

    if (slot.broadcastType === 'restream') { result.skipped++; continue; }
    if (slot.postBroadcastEmailSentAt) { result.skipped++; continue; }

    const targets = getDjEmailTargets(slot);

    for (const target of targets) {
      try {
        const djInfo = await lookupDjInfo(db, target.email);
        const username = target.djUsername || djInfo.username;

        if (!username) {
          result.errors.push(`No username found for ${target.email}, skipping post-broadcast email`);
          continue;
        }

        const missingItems = buildMissingItems(djInfo);

        const success = await sendPostBroadcastEmail({
          to: target.email,
          djName: djInfo.name || target.djName,
          username,
          missingItems,
          showTipParagraph: !djInfo.hasTipLink,
        });

        if (success) { result.sent++; } else { result.errors.push(`Failed to send post-broadcast email to ${target.email}`); }
      } catch (error) {
        result.errors.push(`Error sending post-broadcast email to ${target.email}: ${error}`);
      }
    }

    await doc.ref.update({ postBroadcastEmailSentAt: now });
  }

  return result;
}
