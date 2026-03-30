import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
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
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

function formatTimeRange(startTime: number, endTime: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' };
  const start = new Date(startTime).toLocaleTimeString('en-US', opts);
  const end = new Date(endTime).toLocaleTimeString('en-US', opts);
  // Get timezone abbreviation
  const tzAbbr = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })
    .formatToParts(new Date(startTime))
    .find(p => p.type === 'timeZoneName')?.value || 'ET';
  return `${start} – ${end} ${tzAbbr}`;
}

// Look up DJ's normalized username from pending-dj-profiles or users collection
async function lookupDjUsername(db: FirebaseFirestore.Firestore, email: string): Promise<string | null> {
  // Check users collection first
  const usersSnap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!usersSnap.empty) {
    const user = usersSnap.docs[0].data();
    if (user.chatUsernameNormalized) return user.chatUsernameNormalized;
  }
  // Check pending-dj-profiles
  const pendingSnap = await db.collection('pending-dj-profiles').where('email', '==', email).limit(1).get();
  if (!pendingSnap.empty) {
    const profile = pendingSnap.docs[0].data();
    if (profile.chatUsernameNormalized) return profile.chatUsernameNormalized;
  }
  return null;
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
    const windowStart = now + 23.5 * 60 * 60 * 1000; // 23.5 hours from now
    const windowEnd = now + 24.5 * 60 * 60 * 1000;   // 24.5 hours from now

    // Find scheduled slots starting in ~24 hours
    const snapshot = await db
      .collection('broadcast-slots')
      .where('status', '==', 'scheduled')
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

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

      if (slot.djSlots && Array.isArray(slot.djSlots) && slot.djSlots.length > 0) {
        // Venue slot with multiple DJs — each DJ gets their own reminder with their specific time
        for (const djSlot of slot.djSlots as DJSlot[]) {
          if (djSlot.djEmail) {
            emailTargets.push({
              email: djSlot.djEmail,
              djName: djSlot.djName || 'there',
              startTime: djSlot.startTime,
              endTime: djSlot.endTime,
              djUsername: djSlot.djUsername,
            });
          }
        }
      } else if (slot.djEmail) {
        // Single DJ slot
        emailTargets.push({
          email: slot.djEmail,
          djName: slot.djName || 'there',
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }

      for (const target of emailTargets) {
        try {
          // Look up DJ username for profile URL
          let djUsername = target.djUsername;
          if (!djUsername && target.email) {
            djUsername = await lookupDjUsername(db, target.email) || undefined;
          }
          const profileUrl = djUsername ? `${APP_URL}/dj/${djUsername}` : null;

          const success = await sendBroadcastReminderEmail({
            to: target.email,
            djName: target.djName,
            showName,
            broadcastUrl,
            profileUrl,
            startTime: formatDate(target.startTime),
            timeRange: formatTimeRange(target.startTime, target.endTime),
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
