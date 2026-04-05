import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slotId: string }> }
) {
  try {
    const { slotId } = await params;
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const doc = await slotRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Broadcast slot not found' }, { status: 404 });
    }

    await slotRef.update({
      streamCount: FieldValue.increment(1),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error incrementing broadcast stream count:', error);
    return NextResponse.json({ error: 'Failed to increment stream count' }, { status: 500 });
  }
}
