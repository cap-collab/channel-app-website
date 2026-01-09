import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Fetch tip details by Stripe session ID (for thank you popup)
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Find tip by Stripe session ID
    const tipsSnapshot = await db.collection('tips')
      .where('stripeSessionId', '==', sessionId)
      .limit(1)
      .get();

    if (tipsSnapshot.empty) {
      return NextResponse.json({ error: 'Tip not found' }, { status: 404 });
    }

    const tipDoc = tipsSnapshot.docs[0];
    const tipData = tipDoc.data();

    // Fetch DJ photo URL from user profile if djUserId exists
    let djPhotoUrl: string | null = null;
    if (tipData.djUserId) {
      const userDoc = await db.collection('users').doc(tipData.djUserId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        djPhotoUrl = userData?.djProfile?.photoUrl || null;
      }
    }

    // Return only the fields needed for the thank you popup
    return NextResponse.json({
      id: tipDoc.id,
      djUsername: tipData.djUsername,
      djPhotoUrl,
      djThankYouMessage: tipData.djThankYouMessage || 'Thanks for the tip!',
      tipAmountCents: tipData.tipAmountCents,
      showName: tipData.showName,
      createdAt: tipData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching tip by session:', error);
    return NextResponse.json({ error: 'Failed to fetch tip' }, { status: 500 });
  }
}
