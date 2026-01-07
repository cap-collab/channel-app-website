import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';

// POST - Check Stripe Connect account status and update if onboarded
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
      return NextResponse.json({
        onboarded: false,
        error: 'No Stripe account found'
      });
    }

    // Check account status with Stripe
    const account = await stripe.accounts.retrieve(stripeAccountId);

    const isOnboarded = account.charges_enabled && account.payouts_enabled;

    // Update Firebase if onboarded
    if (isOnboarded && !userData?.djProfile?.stripeOnboarded) {
      await userDoc.ref.update({
        'djProfile.stripeOnboarded': true,
      });
    }

    return NextResponse.json({
      onboarded: isOnboarded,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch (error) {
    console.error('Error checking Stripe status:', error);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}
