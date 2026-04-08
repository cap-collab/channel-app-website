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

    // Parse optional userId from body
    let userId: string | null = null;
    try {
      const body = await request.json();
      userId = body.userId || null;
      console.log('[archive/stream] userId from body:', userId);
    } catch {
      console.log('[archive/stream] No body or invalid JSON, skipping user tracking');
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

    const archiveDoc = snapshot.docs[0];
    const archiveRef = archiveDoc.ref;
    const archiveData = archiveDoc.data();

    // Increment the global stream count
    await archiveRef.update({
      streamCount: FieldValue.increment(1),
    });

    // Write per-user stream history if authenticated
    if (userId) {
      const streamHistoryRef = db
        .collection('users')
        .doc(userId)
        .collection('streamHistory')
        .doc(archiveDoc.id);

      const existing = await streamHistoryRef.get();
      const historyData: Record<string, unknown> = {
        archiveId: archiveDoc.id,
        slug,
        showName: archiveData.showName || '',
        djs: (archiveData.djs || []).map((d: { name?: string; username?: string; photoUrl?: string }) => ({
          name: d.name || '',
          username: d.username || null,
          photoUrl: d.photoUrl || null,
        })),
        stationId: archiveData.stationId || '',
        showImageUrl: archiveData.showImageUrl || null,
        sourceType: 'archive',
        streamCount: FieldValue.increment(1),
        lastStreamedAt: FieldValue.serverTimestamp(),
      };

      if (!existing.exists) {
        historyData.firstStreamedAt = FieldValue.serverTimestamp();
      }

      await streamHistoryRef.set(historyData, { merge: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error incrementing stream count:', error);
    return NextResponse.json({ error: 'Failed to increment stream count' }, { status: 500 });
  }
}
