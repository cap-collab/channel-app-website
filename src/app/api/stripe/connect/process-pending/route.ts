import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Process pending tips for a DJ who just connected Stripe
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();
    const stripeAccountId = userData?.djProfile?.stripeAccountId;

    if (!stripeAccountId) {
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 400 });
    }

    // Get pending tips for this DJ
    const pendingTips = await db.collection('tips')
      .where('djUserId', '==', userId)
      .where('payoutStatus', '==', 'pending')
      .where('status', '==', 'succeeded')
      .get();

    if (pendingTips.empty) {
      return NextResponse.json({
        processed: 0,
        totalAmountCents: 0,
        message: 'No pending tips to process',
      });
    }

    let processedCount = 0;
    let totalAmountCents = 0;
    const errors: string[] = [];

    for (const tipDoc of pendingTips.docs) {
      const tip = tipDoc.data();

      try {
        const transfer = await stripe.transfers.create({
          amount: tip.tipAmountCents,
          currency: 'usd',
          destination: stripeAccountId,
          transfer_group: tipDoc.id,
          metadata: {
            tipId: tipDoc.id,
            djUserId: userId,
          },
        });

        await tipDoc.ref.update({
          stripeTransferId: transfer.id,
          payoutStatus: 'transferred',
          transferredAt: FieldValue.serverTimestamp(),
        });

        processedCount++;
        totalAmountCents += tip.tipAmountCents;
      } catch (error) {
        console.error(`Failed to transfer tip ${tipDoc.id}:`, error);
        errors.push(tipDoc.id);
      }
    }

    return NextResponse.json({
      processed: processedCount,
      totalAmountCents,
      failed: errors.length,
      message: `Transferred $${(totalAmountCents / 100).toFixed(2)} from ${processedCount} tips`,
    });
  } catch (error) {
    console.error('Error processing pending tips:', error);
    return NextResponse.json({ error: 'Failed to process pending tips' }, { status: 500 });
  }
}
