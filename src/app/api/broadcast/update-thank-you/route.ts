import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Update DJ's thank you message
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, thankYouMessage, djUserId } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    if (typeof thankYouMessage !== 'string') {
      return NextResponse.json({ error: 'Thank you message must be a string' }, { status: 400 });
    }

    // Trim and limit to 200 chars
    const trimmedMessage = thankYouMessage.trim().slice(0, 200);

    // Verify the token is valid
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    // If user is logged in, save to their profile
    if (djUserId) {
      const userRef = db.collection('users').doc(djUserId);
      await userRef.set({
        'djProfile.thankYouMessage': trimmedMessage,
      }, { merge: true });

      console.log('[update-thank-you] Saved to user profile:', { djUserId, messageLength: trimmedMessage.length });
    }

    return NextResponse.json({
      success: true,
      thankYouMessage: trimmedMessage,
    });
  } catch (error) {
    console.error('[update-thank-you] Error:', error);
    return NextResponse.json({ error: 'Failed to update thank you message' }, { status: 500 });
  }
}
