import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const CLAIM_WINDOW_DAYS = 60;

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// GET - Reallocate tips older than 60 days to DJ Support Pool
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Calculate cutoff date (60 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CLAIM_WINDOW_DAYS);

    // Get all pending tips older than 60 days
    // We need to query both 'pending' and 'pending_dj_account' statuses
    const pendingTips = await db.collection('tips')
      .where('status', '==', 'succeeded')
      .where('createdAt', '<', cutoffDate)
      .get();

    if (pendingTips.empty) {
      console.log('[cron/reallocate-expired-tips] No tips to check');
      return NextResponse.json({
        reallocated: 0,
        message: 'No expired tips to reallocate',
      });
    }

    let reallocatedCount = 0;
    let totalAmountCents = 0;
    const errors: string[] = [];

    const batch = db.batch();
    const reallocations: Array<{
      tipId: string;
      djUserId: string;
      djUsername: string;
      djEmail?: string;
      amountCents: number;
      originalTipDate: FirebaseFirestore.Timestamp;
    }> = [];

    for (const tipDoc of pendingTips.docs) {
      const tip = tipDoc.data();

      // Only reallocate tips that are still pending (not transferred or already reallocated)
      if (tip.payoutStatus !== 'pending' && tip.payoutStatus !== 'pending_dj_account') {
        continue;
      }

      try {
        // Update tip status to reallocated
        batch.update(tipDoc.ref, {
          payoutStatus: 'reallocated_to_pool',
          reallocatedAt: FieldValue.serverTimestamp(),
        });

        // Prepare reallocation record
        reallocations.push({
          tipId: tipDoc.id,
          djUserId: tip.djUserId,
          djUsername: tip.djUsername,
          djEmail: tip.djEmail,
          amountCents: tip.tipAmountCents,
          originalTipDate: tip.createdAt,
        });

        reallocatedCount++;
        totalAmountCents += tip.tipAmountCents;

        console.log(`[cron/reallocate-expired-tips] Reallocating tip ${tipDoc.id}: $${(tip.tipAmountCents / 100).toFixed(2)} from DJ ${tip.djUsername}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${tipDoc.id}: ${errorMessage}`);
        console.error(`[cron/reallocate-expired-tips] Failed to reallocate tip ${tipDoc.id}:`, error);
      }
    }

    // Commit all tip updates
    if (reallocatedCount > 0) {
      await batch.commit();

      // Create reallocation records
      for (const reallocation of reallocations) {
        await db.collection('supportPoolReallocations').add({
          ...reallocation,
          reallocatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    const result = {
      reallocated: reallocatedCount,
      totalAmountCents,
      totalAmountDollars: (totalAmountCents / 100).toFixed(2),
      errors: errors.length > 0 ? errors : undefined,
      message: `Reallocated ${reallocatedCount} tips ($${(totalAmountCents / 100).toFixed(2)}) to Support Pool`,
    };

    console.log('[cron/reallocate-expired-tips] Complete:', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cron/reallocate-expired-tips] Error:', error);
    return NextResponse.json({ error: 'Failed to reallocate expired tips' }, { status: 500 });
  }
}
