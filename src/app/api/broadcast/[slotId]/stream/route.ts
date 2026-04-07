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

    // Parse optional userId from body
    let userId: string | null = null;
    try {
      const body = await request.json();
      userId = body.userId || null;
    } catch {
      // No body or invalid JSON — skip user tracking
    }

    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Broadcast slot not found' }, { status: 404 });
    }

    const slotData = slotDoc.data()!;

    // Increment the global stream count
    await slotRef.update({
      streamCount: FieldValue.increment(1),
    });

    // Write per-user stream history if authenticated
    if (userId) {
      const streamHistoryRef = db
        .collection('users')
        .doc(userId)
        .collection('streamHistory')
        .doc(slotId);

      // Build DJ array from slot data (single DJ or multi-DJ slots)
      const djs: { name: string; username: string | null; photoUrl: string | null }[] = [];
      if (slotData.djSlots && slotData.djSlots.length > 0) {
        for (const ds of slotData.djSlots) {
          djs.push({
            name: ds.djName || '',
            username: ds.liveDjUsername || ds.djUsername || null,
            photoUrl: ds.liveDjPhotoUrl || ds.djPhotoUrl || null,
          });
        }
      } else {
        djs.push({
          name: slotData.djName || slotData.showName || '',
          username: slotData.liveDjUsername || slotData.djUsername || null,
          photoUrl: slotData.liveDjPhotoUrl || null,
        });
      }

      const existing = await streamHistoryRef.get();
      const historyData: Record<string, unknown> = {
        archiveId: slotId,
        showName: slotData.showName || '',
        djs,
        stationId: slotData.stationId || 'broadcast',
        showImageUrl: slotData.showImageUrl || null,
        sourceType: 'live',
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
    console.error('Error incrementing broadcast stream count:', error);
    return NextResponse.json({ error: 'Failed to increment stream count' }, { status: 500 });
  }
}
