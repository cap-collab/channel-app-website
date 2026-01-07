import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe, calculateTotalCharge } from '@/lib/stripe';

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
      djUserId,
      djUsername,
      broadcastSlotId,
      showName,
      tipperUserId,
      tipperUsername,
    } = body;

    // Validate required fields
    if (!tipAmountCents || typeof tipAmountCents !== 'number') {
      return NextResponse.json({ error: 'Invalid tip amount' }, { status: 400 });
    }

    if (tipAmountCents < 100) {
      return NextResponse.json({ error: 'Minimum tip is $1' }, { status: 400 });
    }

    if (tipAmountCents > 50000) {
      return NextResponse.json({ error: 'Maximum tip is $500' }, { status: 400 });
    }

    if (!djUserId || !djUsername) {
      return NextResponse.json({ error: 'DJ information required' }, { status: 400 });
    }

    if (!broadcastSlotId || !showName) {
      return NextResponse.json({ error: 'Show information required' }, { status: 400 });
    }

    if (!tipperUserId || !tipperUsername) {
      return NextResponse.json({ error: 'Tipper information required' }, { status: 400 });
    }

    // Calculate fees
    const { tipAmountCents: tipCents, platformFeeCents, totalCents } = calculateTotalCharge(tipAmountCents);

    // Check if tipper has a Stripe Customer ID for saved cards
    let stripeCustomerId: string | undefined;
    const tipperDoc = await db.collection('users').doc(tipperUserId).get();
    if (tipperDoc.exists) {
      stripeCustomerId = tipperDoc.data()?.stripeCustomerId;
    }

    // Create new Stripe Customer if they don't have one
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        metadata: {
          firebaseUserId: tipperUserId,
          username: tipperUsername,
        },
      });
      stripeCustomerId = customer.id;

      // Save customer ID to user document
      await db.collection('users').doc(tipperUserId).update({
        stripeCustomerId: customer.id,
      });
    }

    // Get the base URL for redirects
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
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
      success_url: `${origin}/channel?tip=success`,
      cancel_url: `${origin}/channel?tip=cancelled`,
      payment_intent_data: {
        setup_future_usage: 'on_session', // Save card for future tips
        metadata: {
          tipAmountCents: tipCents.toString(),
          platformFeeCents: platformFeeCents.toString(),
          djUserId,
          djUsername,
          broadcastSlotId,
          showName,
          tipperUserId,
          tipperUsername,
        },
      },
      metadata: {
        type: 'tip',
        tipAmountCents: tipCents.toString(),
        platformFeeCents: platformFeeCents.toString(),
        djUserId,
        djUsername,
        broadcastSlotId,
        showName,
        tipperUserId,
        tipperUsername,
      },
    });

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Error creating tip checkout:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
