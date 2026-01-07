import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';

// POST - Create Stripe Connect Express account for a DJ
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { userId, email } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Get user document
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();

    // Check if user already has a Stripe account
    if (userData?.djProfile?.stripeAccountId) {
      return NextResponse.json({
        accountId: userData.djProfile.stripeAccountId,
        alreadyExists: true,
      });
    }

    // Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: email || userData?.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        firebaseUserId: userId,
        username: userData?.username || '',
      },
    });

    // Save account ID to user's djProfile
    await userDoc.ref.update({
      'djProfile.stripeAccountId': account.id,
      'djProfile.stripeOnboarded': false,
    });

    return NextResponse.json({
      accountId: account.id,
      alreadyExists: false,
    });
  } catch (error) {
    console.error('Error creating Stripe Connect account:', error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
