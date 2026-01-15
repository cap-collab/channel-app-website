import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendTipReminderEmail } from '@/lib/email';
import { FieldValue } from 'firebase-admin/firestore';

const CLAIM_WINDOW_DAYS = 60;
const REMINDER_DAY_MARKERS = [1, 7, 30, 45, 50, 59]; // Days since first tip when to send reminders

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// GET - Send reminder emails to DJs with pending tips
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get all pending tips grouped by DJ
    const pendingTips = await db.collection('tips')
      .where('status', '==', 'succeeded')
      .get();

    if (pendingTips.empty) {
      console.log('[cron/send-tip-reminders] No tips found');
      return NextResponse.json({ sent: 0, message: 'No tips to process' });
    }

    // Group pending tips by DJ
    const djPendingTips: Map<string, {
      djUserId: string;
      djEmail?: string;
      djUsername: string;
      totalPendingCents: number;
      oldestTipDate: Date;
    }> = new Map();

    for (const tipDoc of pendingTips.docs) {
      const tip = tipDoc.data();

      // Only count pending tips
      if (tip.payoutStatus !== 'pending' && tip.payoutStatus !== 'pending_dj_account') {
        continue;
      }

      const djUserId = tip.djUserId;
      if (!djUserId || djUserId === 'pending') continue;

      const tipDate = tip.createdAt?.toDate();
      if (!tipDate) continue;

      if (djPendingTips.has(djUserId)) {
        const existing = djPendingTips.get(djUserId)!;
        existing.totalPendingCents += tip.tipAmountCents;
        if (tipDate < existing.oldestTipDate) {
          existing.oldestTipDate = tipDate;
        }
      } else {
        djPendingTips.set(djUserId, {
          djUserId,
          djEmail: tip.djEmail,
          djUsername: tip.djUsername,
          totalPendingCents: tip.tipAmountCents,
          oldestTipDate: tipDate,
        });
      }
    }

    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com';

    for (const [djUserId, djData] of Array.from(djPendingTips.entries())) {
      try {
        // Check if DJ has Stripe connected
        const djDoc = await db.collection('users').doc(djUserId).get();
        if (!djDoc.exists) continue;

        const djUserData = djDoc.data();
        const stripeAccountId = djUserData?.djProfile?.stripeAccountId;

        // Skip DJs who already have Stripe connected
        if (stripeAccountId) {
          continue;
        }

        // Calculate days since oldest tip
        const now = new Date();
        const daysSinceOldestTip = Math.floor(
          (now.getTime() - djData.oldestTipDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Find which reminder marker we're at (if any)
        const applicableMarker = REMINDER_DAY_MARKERS.find(
          marker => daysSinceOldestTip >= marker && daysSinceOldestTip < marker + 1
        );

        if (!applicableMarker) {
          skippedCount++;
          continue;
        }

        // Check if we already sent this reminder
        const existingReminder = await db.collection('tipRemindersSent')
          .where('djUserId', '==', djUserId)
          .where('dayMarker', '==', applicableMarker)
          .limit(1)
          .get();

        if (!existingReminder.empty) {
          skippedCount++;
          continue;
        }

        // Get DJ's email
        const djEmail = djUserData?.email || djData.djEmail;
        if (!djEmail) {
          console.log(`[cron/send-tip-reminders] No email for DJ ${djUserId}`);
          continue;
        }

        // Calculate days remaining
        const daysRemaining = CLAIM_WINDOW_DAYS - daysSinceOldestTip;

        // Generate Stripe onboarding URL with redirect
        const stripeOnboardingUrl = `${origin}/dj-profile?connect=stripe`;

        // Send reminder email
        const sent = await sendTipReminderEmail({
          to: djEmail,
          djName: djUserData?.chatUsername || djData.djUsername,
          pendingAmountCents: djData.totalPendingCents,
          daysRemaining,
          stripeOnboardingUrl,
        });

        if (sent) {
          // Record that we sent this reminder
          await db.collection('tipRemindersSent').add({
            djUserId,
            dayMarker: applicableMarker,
            sentAt: FieldValue.serverTimestamp(),
            pendingAmountCents: djData.totalPendingCents,
          });

          sentCount++;
          console.log(`[cron/send-tip-reminders] Sent day ${applicableMarker} reminder to ${djEmail} (${daysRemaining} days left, $${(djData.totalPendingCents / 100).toFixed(2)})`);
        } else {
          errors.push(`${djEmail}: Failed to send email`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${djUserId}: ${errorMessage}`);
        console.error(`[cron/send-tip-reminders] Error processing DJ ${djUserId}:`, error);
      }
    }

    const result = {
      sent: sentCount,
      skipped: skippedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Sent ${sentCount} reminder emails, skipped ${skippedCount}`,
    };

    console.log('[cron/send-tip-reminders] Complete:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/send-tip-reminders] Error:', error);
    return NextResponse.json({ error: 'Failed to send tip reminders' }, { status: 500 });
  }
}
