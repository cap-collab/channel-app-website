import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Mark a slot as paused (called via sendBeacon on browser close)
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { slotId } = body;

    if (!slotId) {
      return NextResponse.json({ error: 'Missing slotId' }, { status: 400 });
    }

    // Get the slot to verify it's currently live
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slot = slotDoc.data();

    // Only pause if currently live
    if (slot?.status === 'live') {
      await slotRef.update({ status: 'paused' });
      console.log('Slot paused:', slotId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error pausing slot:', error);
    return NextResponse.json({ error: 'Failed to pause slot' }, { status: 500 });
  }
}
