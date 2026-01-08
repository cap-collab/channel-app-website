import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';
import { FieldValue } from 'firebase-admin/firestore';

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// GET - Process all pending tips (called by Vercel Cron daily)
export async function GET(request: NextRequest) {
  // Verify this is a legitimate cron request
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get all pending tips that have a real DJ (not 'pending' djUserId)
    const pendingTips = await db.collection('tips')
      .where('payoutStatus', '==', 'pending')
      .where('status', '==', 'succeeded')
      .get();

    if (pendingTips.empty) {
      console.log('[cron/process-pending-tips] No pending tips to process');
      return NextResponse.json({
        processed: 0,
        failed: 0,
        message: 'No pending tips to process',
      });
    }

    console.log(`[cron/process-pending-tips] Found ${pendingTips.docs.length} pending tips`);

    // Group tips by DJ to batch lookups
    const tipsByDj: Map<string, FirebaseFirestore.QueryDocumentSnapshot[]> = new Map();
    for (const tipDoc of pendingTips.docs) {
      const djUserId = tipDoc.data().djUserId;
      if (djUserId && djUserId !== 'pending') {
        if (!tipsByDj.has(djUserId)) {
          tipsByDj.set(djUserId, []);
        }
        tipsByDj.get(djUserId)!.push(tipDoc);
      }
    }

    let processedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Process each DJ's tips
    for (const [djUserId, tips] of tipsByDj) {
      // Look up DJ's Stripe account
      const djDoc = await db.collection('users').doc(djUserId).get();
      if (!djDoc.exists) {
        console.log(`[cron/process-pending-tips] DJ ${djUserId} not found, skipping ${tips.length} tips`);
        continue;
      }

      const djData = djDoc.data();
      const stripeAccountId = djData?.djProfile?.stripeAccountId;

      if (!stripeAccountId) {
        console.log(`[cron/process-pending-tips] DJ ${djUserId} has no Stripe account, skipping ${tips.length} tips`);
        continue;
      }

      // Check if account is enabled
      try {
        const account = await stripe.accounts.retrieve(stripeAccountId);
        if (!account.charges_enabled || !account.payouts_enabled) {
          console.log(`[cron/process-pending-tips] DJ ${djUserId} Stripe account not fully enabled, skipping`);
          continue;
        }
      } catch (error) {
        console.error(`[cron/process-pending-tips] Failed to retrieve Stripe account ${stripeAccountId}:`, error);
        continue;
      }

      // Process each tip for this DJ
      for (const tipDoc of tips) {
        const tip = tipDoc.data();

        try {
          const transfer = await stripe.transfers.create({
            amount: tip.tipAmountCents,
            currency: 'usd',
            destination: stripeAccountId,
            transfer_group: tipDoc.id,
            metadata: {
              tipId: tipDoc.id,
              djUserId: djUserId,
              processedBy: 'cron',
            },
          });

          await tipDoc.ref.update({
            stripeTransferId: transfer.id,
            payoutStatus: 'transferred',
            transferredAt: FieldValue.serverTimestamp(),
          });

          processedCount++;
          console.log(`[cron/process-pending-tips] Transferred tip ${tipDoc.id}: $${(tip.tipAmountCents / 100).toFixed(2)} to ${stripeAccountId}`);
        } catch (error) {
          failedCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${tipDoc.id}: ${errorMessage}`);
          console.error(`[cron/process-pending-tips] Failed to transfer tip ${tipDoc.id}:`, error);
        }
      }
    }

    const result = {
      processed: processedCount,
      failed: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Processed ${processedCount} tips, ${failedCount} failed`,
    };

    console.log('[cron/process-pending-tips] Complete:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/process-pending-tips] Error:', error);
    return NextResponse.json({ error: 'Failed to process pending tips' }, { status: 500 });
  }
}
