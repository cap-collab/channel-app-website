import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe, calculateTotalCharge } from '@/lib/stripe';
import Stripe from 'stripe';

// POST - Create Stripe Checkout Session for a tip
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const {
      tipAmountCents,
      djUserId: djUserIdFromRequest,  // Preferred: DJ's Firebase UID set at go-live
      djEmail,                         // Fallback: DJ's email from application
      djUsername,
      broadcastSlotId,
      showName,
      tipperUserId,
      tipperUsername,
      isGuest,
    } = body;

    // Validate required fields
    if (!tipAmountCents || typeof tipAmountCents !== 'number') {
      return NextResponse.json({ error: 'Invalid tip amount' }, { status: 400 });
    }

    if (tipAmountCents < 100) {
      return NextResponse.json({ error: 'Minimum tip is $1' }, { status: 400 });
    }

    // Single tip max: $20 for guests, $200 for logged in
    const maxSingleTipCents = isGuest ? 2000 : 20000;
    if (tipAmountCents > maxSingleTipCents) {
      if (isGuest) {
        return NextResponse.json({ error: 'Log in to tip more than $20' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Maximum tip is $200' }, { status: 400 });
    }

    // For logged-in users, check total tips for this session (max $200 per user per DJ session)
    const MAX_SESSION_TIP_CENTS = 20000;
    if (!isGuest && tipperUserId) {
      const existingTipsSnapshot = await db.collection('tips')
        .where('tipperUserId', '==', tipperUserId)
        .where('broadcastSlotId', '==', broadcastSlotId)
        .where('status', '==', 'succeeded')
        .get();

      const existingTotalCents = existingTipsSnapshot.docs.reduce((sum, doc) => {
        return sum + (doc.data().tipAmountCents || 0);
      }, 0);

      if (existingTotalCents + tipAmountCents > MAX_SESSION_TIP_CENTS) {
        const remainingCents = MAX_SESSION_TIP_CENTS - existingTotalCents;
        if (remainingCents <= 0) {
          return NextResponse.json({ error: 'You have reached the $200 tip limit for this session' }, { status: 400 });
        }
        return NextResponse.json({
          error: `You can only tip $${(remainingCents / 100).toFixed(2)} more for this session (max $200 per session)`
        }, { status: 400 });
      }
    }

    if (!djUsername) {
      return NextResponse.json({ error: 'DJ information required' }, { status: 400 });
    }

    // Get DJ's user ID, Stripe account, and thank you message - prefer direct ID from go-live, fallback to email lookup
    let djUserId: string;
    let djStripeAccountId: string | null = null;
    let djThankYouMessage: string = 'Thanks for the tip!'; // Default message

    if (djUserIdFromRequest) {
      // Use the DJ's Firebase UID directly (set at go-live)
      djUserId = djUserIdFromRequest;
      // Look up their Stripe account and thank you message
      const djUserDoc = await db.collection('users').doc(djUserIdFromRequest).get();
      if (djUserDoc.exists) {
        const djProfile = djUserDoc.data()?.djProfile;
        djStripeAccountId = djProfile?.stripeAccountId || null;
        djThankYouMessage = djProfile?.thankYouMessage || 'Thanks for the tip!';
      }
    } else if (djEmail) {
      // Try to look up DJ's user ID from email
      const djUserSnapshot = await db.collection('users')
        .where('email', '==', djEmail)
        .limit(1)
        .get();

      if (!djUserSnapshot.empty) {
        djUserId = djUserSnapshot.docs[0].id;
        const djProfile = djUserSnapshot.docs[0].data()?.djProfile;
        djStripeAccountId = djProfile?.stripeAccountId || null;
        djThankYouMessage = djProfile?.thankYouMessage || 'Thanks for the tip!';
      } else {
        // DJ not found by email - use 'pending' for later reconciliation
        // Tip will be held until DJ creates an account and links Stripe
        djUserId = 'pending';
        console.log('[tip] DJ not found by email, using pending status:', { djEmail, djUsername });
      }
    } else {
      return NextResponse.json({ error: 'DJ information required' }, { status: 400 });
    }

    if (!broadcastSlotId || !showName) {
      return NextResponse.json({ error: 'Show information required' }, { status: 400 });
    }

    // For authenticated users, require user info. For guests, we'll collect email via Stripe.
    if (!isGuest && (!tipperUserId || !tipperUsername)) {
      return NextResponse.json({ error: 'Tipper information required' }, { status: 400 });
    }

    // Calculate fees
    const { tipAmountCents: tipCents, platformFeeCents, totalCents } = calculateTotalCharge(tipAmountCents);

    // For authenticated users, check/create Stripe Customer for saved cards
    let stripeCustomerId: string | undefined;

    if (!isGuest && tipperUserId) {
      const tipperDoc = await db.collection('users').doc(tipperUserId).get();
      if (tipperDoc.exists) {
        stripeCustomerId = tipperDoc.data()?.stripeCustomerId;
      }

      // Create new Stripe Customer if they don't have one
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          metadata: {
            firebaseUserId: tipperUserId,
            username: tipperUsername || 'anonymous',
          },
        });
        stripeCustomerId = customer.id;

        // Save customer ID to user document
        await db.collection('users').doc(tipperUserId).update({
          stripeCustomerId: customer.id,
        });
      }
    }
    // For guests, we don't create a customer - Stripe will collect email in checkout

    // Get the base URL for redirects
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Prepare tipper info for metadata (use 'guest' placeholders for guest tippers)
    const effectiveTipperUserId = tipperUserId || 'guest';
    const effectiveTipperUsername = tipperUsername || 'Guest';

    // Determine if we can use destination charge (DJ has connected Stripe)
    // If yes: payment goes directly to DJ, we take application fee - fully automated
    // If no: payment goes to platform, we transfer later via cron job
    const useDestinationCharge = !!djStripeAccountId;

    // Common metadata for tracking
    const tipMetadata = {
      type: 'tip',
      tipAmountCents: tipCents.toString(),
      platformFeeCents: platformFeeCents.toString(),
      djUserId,
      djStripeAccountId: djStripeAccountId || '',
      djEmail: djEmail || '',
      djUsername,
      djThankYouMessage,
      broadcastSlotId,
      showName,
      tipperUserId: effectiveTipperUserId,
      tipperUsername: effectiveTipperUsername,
      isGuest: isGuest ? 'true' : 'false',
      useDestinationCharge: useDestinationCharge ? 'true' : 'false',
    };

    // Create Stripe Checkout Session
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Tip for ${djUsername}`,
              description: `Supporting ${showName}`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/channel?tip=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/channel?tip=cancelled`,
      metadata: tipMetadata,
    };

    // Set up payment_intent_data based on whether DJ has Stripe
    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
      metadata: tipMetadata,
    };

    if (useDestinationCharge) {
      // DJ has Stripe - use destination charge for automatic transfer
      // Payment goes to DJ's account, we collect application fee
      paymentIntentData.transfer_data = {
        destination: djStripeAccountId!,
      };
      paymentIntentData.application_fee_amount = platformFeeCents;
      console.log('[tip] Using destination charge:', { djStripeAccountId, applicationFee: platformFeeCents });
    }

    if (isGuest) {
      // For guests: collect email for refund purposes
      sessionConfig.customer_email = undefined;
      sessionConfig.customer_creation = 'always';
    } else {
      // For authenticated users: use existing customer, save card for future
      sessionConfig.customer = stripeCustomerId;
      if (!useDestinationCharge) {
        // Only set up future usage if not using destination charge
        paymentIntentData.setup_future_usage = 'on_session';
      }
    }

    sessionConfig.payment_intent_data = paymentIntentData;

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Error creating tip checkout:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
