import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archiveRef = db.collection('archives').doc(id);
    const doc = await archiveRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    // Increment the stream count
    await archiveRef.update({
      streamCount: FieldValue.increment(1),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error incrementing stream count:', error);
    return NextResponse.json({ error: 'Failed to increment stream count' }, { status: 500 });
  }
}
