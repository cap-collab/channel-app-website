import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { sendBroadcastReminderEmail } from '@/lib/email';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com';

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

interface DJSlot {
  id: string;
  djName?: string;
  djEmail?: string;
  djUsername?: string;
  startTime: number;
  endTime: number;
}

// Format a timestamp for the email
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

function formatDate(timestamp: number, timezone: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  });
}

function formatTimeRange(startTime: number, endTime: number, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  const start = new Date(startTime).toLocaleTimeString('en-US', opts);
  const end = new Date(endTime).toLocaleTimeString('en-US', opts);
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date(startTime))
    .find(p => p.type === 'timeZoneName')?.value || timezone;
  return `${start} – ${end} ${tzAbbr}`;
}

// Look up DJ's normalized username from pending-dj-profiles or users collection
async function lookupDjInfo(db: FirebaseFirestore.Firestore, email: string): Promise<{ username: string | null; timezone: string }> {
  // Check users collection first
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!usersSnap.empty) {
    const user = usersSnap.docs[0].data();
    return {
      username: user.chatUsernameNormalized || null,
      timezone: user.timezone || DEFAULT_TIMEZONE,
    };
  }
  // Check pending-dj-profiles
  const pendingSnap = await db.collection('pending-dj-profiles').where('email', '==', email).limit(1).get();
  if (!pendingSnap.empty) {
    const profile = pendingSnap.docs[0].data();
    return {
      username: profile.chatUsernameNormalized || null,
      timezone: DEFAULT_TIMEZONE,
    };
  }
  return { username: null, timezone: DEFAULT_TIMEZONE };
}

// This cron job runs every hour to send reminder emails 24h before broadcast slots
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
    // Use Firestore Timestamps for comparison since startTime is stored as a Timestamp
    const windowStart = Timestamp.fromMillis(now + 22 * 60 * 60 * 1000); // 22 hours from now
    const windowEnd = Timestamp.fromMillis(now + 25 * 60 * 60 * 1000);   // 25 hours from now

    console.log(`[broadcast-reminder-emails] Window: ${new Date(windowStart.toMillis()).toISOString()} to ${new Date(windowEnd.toMillis()).toISOString()}`);

    // Find scheduled slots starting in ~24 hours
    const snapshot = await db
      .collection('broadcast-slots')
      .where('status', '==', 'scheduled')
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

    console.log(`[broadcast-reminder-emails] Found ${snapshot.docs.length} slots in window`);

    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const doc of snapshot.docs) {
      const slot = doc.data();

      // Skip if reminder already sent
      if (slot.reminderEmailSentAt) {
        skippedCount++;
        continue;
      }

      const showName = slot.showName || 'Your show';
      const broadcastUrl = `${APP_URL}/broadcast/live?token=${slot.broadcastToken}`;

      // Collect all DJ emails to send to (handles both single-DJ and venue multi-DJ slots)
      const emailTargets: { email: string; djName: string; startTime: number; endTime: number; djUsername?: string }[] = [];

      // Helper to convert Firestore Timestamp or millis number to millis
      const toMillis = (t: unknown): number => {
        if (t && typeof t === 'object' && 'toMillis' in t) return (t as Timestamp).toMillis();
        return t as number;
      };

      if (slot.djSlots && Array.isArray(slot.djSlots) && slot.djSlots.length > 0) {
        // Venue slot with multiple DJs — each DJ gets their own reminder with their specific time
        for (const djSlot of slot.djSlots as DJSlot[]) {
          if (djSlot.djEmail) {
            emailTargets.push({
              email: djSlot.djEmail,
              djName: djSlot.djName || 'there',
              startTime: toMillis(djSlot.startTime),
              endTime: toMillis(djSlot.endTime),
              djUsername: djSlot.djUsername,
            });
          }
        }
      } else if (slot.djEmail) {
        // Single DJ slot
        emailTargets.push({
          email: slot.djEmail,
          djName: slot.djName || 'there',
          startTime: toMillis(slot.startTime),
          endTime: toMillis(slot.endTime),
        });
      }

      for (const target of emailTargets) {
        try {
          // Look up DJ username and timezone
          const djInfo = await lookupDjInfo(db, target.email);
          const djUsername = target.djUsername || djInfo.username;
          const djTimezone = djInfo.timezone;
          const profileUrl = djUsername ? `${APP_URL}/dj/${djUsername}` : null;

          const success = await sendBroadcastReminderEmail({
            to: target.email,
            djName: target.djName,
            showName,
            broadcastUrl,
            profileUrl,
            startTime: formatDate(target.startTime, djTimezone),
            timeRange: formatTimeRange(target.startTime, target.endTime, djTimezone),
          });

          if (success) {
            sentCount++;
          } else {
            errors.push(`Failed to send to ${target.email}`);
          }
        } catch (error) {
          console.error(`Error sending reminder to ${target.email}:`, error);
          errors.push(`Error for ${target.email}: ${error}`);
        }
      }

      // Mark slot as reminded (even if some individual sends failed, to avoid spam)
      await doc.ref.update({ reminderEmailSentAt: now });
    }

    console.log(`[broadcast-reminder-emails] Sent: ${sentCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

    return NextResponse.json({
      success: true,
      sent: sentCount,
      skipped: skippedCount,
      slotsProcessed: snapshot.docs.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error in broadcast reminder emails cron:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
