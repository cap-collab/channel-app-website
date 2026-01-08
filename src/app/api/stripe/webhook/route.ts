import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';

// Disable body parsing - we need raw body for signature verification
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.text();
    const headersList = await headers();
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET is not set');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle different event types - use string cast to avoid TypeScript narrowing issues
    const eventType = event.type as string;
    if (eventType === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only process tip payments
      if (session.metadata?.type === 'tip') {
        await handleTipPayment(db, session);
      }
    } else if (eventType === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      await handleAccountUpdated(db, account);
    } else if (eventType === 'transfer.created') {
      const transfer = event.data.object as Stripe.Transfer;
      await handleTransferCreated(db, transfer);
    } else if (eventType === 'transfer.failed') {
      const transfer = event.data.object as Stripe.Transfer;
      await handleTransferFailed(db, transfer);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function handleTipPayment(
  db: FirebaseFirestore.Firestore,
  session: Stripe.Checkout.Session
) {
  const metadata = session.metadata!;
  const djUserId = metadata.djUserId;
  const djEmail = metadata.djEmail || '';
  const isPendingDj = djUserId === 'pending';

  // Create tip record
  const tipData: Record<string, unknown> = {
    createdAt: FieldValue.serverTimestamp(),
    tipperUserId: metadata.tipperUserId,
    tipperUsername: metadata.tipperUsername,
    djUserId: djUserId,
    djUsername: metadata.djUsername,
    broadcastSlotId: metadata.broadcastSlotId,
    showName: metadata.showName,
    tipAmountCents: parseInt(metadata.tipAmountCents),
    platformFeeCents: parseInt(metadata.platformFeeCents),
    totalChargedCents: parseInt(metadata.tipAmountCents) + parseInt(metadata.platformFeeCents),
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent as string,
    status: 'succeeded',
    // If DJ account is pending, use special status for reconciliation later
    payoutStatus: isPendingDj ? 'pending_dj_account' : 'pending',
  };

  // Store djEmail for reconciliation when djUserId is 'pending'
  if (djEmail) {
    tipData.djEmail = djEmail;
  }

  const tipRef = await db.collection('tips').add(tipData);

  // Post anonymous tip message to chat
  const chatMessage = {
    stationId: 'broadcast',
    username: 'Channel',
    message: `💸 Someone tipped DJ ${metadata.djUsername}`,
    timestamp: FieldValue.serverTimestamp(),
    isDJ: false,
    djSlotId: metadata.broadcastSlotId,
    messageType: 'tip',
  };

  await db.collection('chats').doc('broadcast').collection('messages').add(chatMessage);

  // If DJ account is pending, skip transfer attempt
  if (isPendingDj) {
    console.log('[tip] DJ account pending, tip stored for later reconciliation:', { tipId: tipRef.id, djEmail });
    return;
  }

  // Check if DJ has connected Stripe - if so, transfer immediately
  const djDoc = await db.collection('users').doc(djUserId).get();
  if (djDoc.exists) {
    const djData = djDoc.data();
    const stripeAccountId = djData?.djProfile?.stripeAccountId;

    if (stripeAccountId) {
      // Transfer to DJ immediately
      try {
        const transfer = await stripe.transfers.create({
          amount: parseInt(metadata.tipAmountCents),
          currency: 'usd',
          destination: stripeAccountId,
          transfer_group: tipRef.id,
          metadata: {
            tipId: tipRef.id,
            djUserId: djUserId,
          },
        });

        await tipRef.update({
          stripeTransferId: transfer.id,
          payoutStatus: 'transferred',
          transferredAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error('Failed to transfer to DJ:', error);
        // Keep as pending - will retry later
      }
    }
  }
}

async function handleAccountUpdated(
  db: FirebaseFirestore.Firestore,
  account: Stripe.Account
) {
  // Check if account is now fully onboarded
  if (!account.charges_enabled || !account.payouts_enabled) {
    return;
  }

  // Find user with this Stripe account
  const usersSnapshot = await db.collection('users')
    .where('djProfile.stripeAccountId', '==', account.id)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    return;
  }

  const userDoc = usersSnapshot.docs[0];
  const userId = userDoc.id;
  const userData = userDoc.data();
  const userEmail = userData?.email;

  // Update onboarded status
  await userDoc.ref.update({
    'djProfile.stripeOnboarded': true,
  });

  // Process any pending tips (where djUserId already matches)
  const pendingTips = await db.collection('tips')
    .where('djUserId', '==', userId)
    .where('payoutStatus', '==', 'pending')
    .where('status', '==', 'succeeded')
    .get();

  for (const tipDoc of pendingTips.docs) {
    const tip = tipDoc.data();

    try {
      const transfer = await stripe.transfers.create({
        amount: tip.tipAmountCents,
        currency: 'usd',
        destination: account.id,
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
    } catch (error) {
      console.error(`Failed to transfer tip ${tipDoc.id}:`, error);
    }
  }

  // Reconcile tips where djUserId is 'pending' but djEmail matches user's email
  if (userEmail) {
    const pendingByEmail = await db.collection('tips')
      .where('djEmail', '==', userEmail)
      .where('djUserId', '==', 'pending')
      .where('status', '==', 'succeeded')
      .get();

    console.log(`[webhook] Found ${pendingByEmail.docs.length} pending tips to reconcile by email for ${userEmail}`);

    for (const tipDoc of pendingByEmail.docs) {
      const tip = tipDoc.data();

      try {
        // First update the djUserId to the real user ID
        await tipDoc.ref.update({
          djUserId: userId,
        });

        // Then create the transfer
        const transfer = await stripe.transfers.create({
          amount: tip.tipAmountCents,
          currency: 'usd',
          destination: account.id,
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

        console.log(`[webhook] Reconciled and transferred tip ${tipDoc.id} to DJ ${userId}`);
      } catch (error) {
        console.error(`Failed to reconcile/transfer tip ${tipDoc.id}:`, error);
        // Update djUserId even if transfer fails, so it's ready for retry
        await tipDoc.ref.update({
          djUserId: userId,
          payoutStatus: 'pending', // Ready for retry
        });
      }
    }
  }
}

async function handleTransferCreated(
  db: FirebaseFirestore.Firestore,
  transfer: Stripe.Transfer
) {
  const tipId = transfer.metadata?.tipId;
  if (!tipId) return;

  await db.collection('tips').doc(tipId).update({
    stripeTransferId: transfer.id,
    payoutStatus: 'transferred',
    transferredAt: FieldValue.serverTimestamp(),
  });
}

async function handleTransferFailed(
  db: FirebaseFirestore.Firestore,
  transfer: Stripe.Transfer
) {
  const tipId = transfer.metadata?.tipId;
  if (!tipId) return;

  await db.collection('tips').doc(tipId).update({
    payoutStatus: 'failed',
  });
}
