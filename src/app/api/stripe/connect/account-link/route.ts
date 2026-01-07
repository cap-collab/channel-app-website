import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';

// POST - Generate Stripe onboarding link for a DJ
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
      return NextResponse.json({ error: 'No Stripe account found. Create one first.' }, { status: 400 });
    }

    // Get the base URL for redirects
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/dj-profile?stripe=refresh`,
      return_url: `${origin}/dj-profile?stripe=success`,
      type: 'account_onboarding',
    });

    return NextResponse.json({
      url: accountLink.url,
    });
  } catch (error) {
    console.error('Error creating account link:', error);
    return NextResponse.json({ error: 'Failed to create onboarding link' }, { status: 500 });
  }
}
