import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Find archive by slug
    const archivesRef = db.collection('archives');
    const snapshot = await archivesRef
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const archiveRef = snapshot.docs[0].ref;

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
