import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Update the liveDjUserId on a broadcast slot (for when DJ logs in after going live)
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[update-dj-user] Database not configured');
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, djUserId } = body;

    if (!broadcastToken || !djUserId) {
      return NextResponse.json({ error: 'Missing broadcastToken or djUserId' }, { status: 400 });
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .where('status', '==', 'live')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'No live slot found for this token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];

    // Only update if liveDjUserId is not already set
    const currentData = doc.data();
    if (currentData.liveDjUserId) {
      // Already has a DJ user ID, don't overwrite
      return NextResponse.json({ success: true, message: 'DJ user already set' });
    }

    await doc.ref.update({ liveDjUserId: djUserId });
    console.log('[update-dj-user] Updated liveDjUserId:', { slotId: doc.id, djUserId });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[update-dj-user] Error:', error);
    return NextResponse.json({ error: 'Failed to update DJ user' }, { status: 500 });
  }
}
