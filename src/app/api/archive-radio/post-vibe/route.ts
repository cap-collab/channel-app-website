import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Post an archive's show vibe to the channelbroadcast chat once.
// Called fire-and-forget by every listener's browser when the archive radio
// rolls to a new archive; the deterministic doc ID + .create() collapse all
// concurrent writes into a single message (first writer wins).
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { archiveId, vibe, djName } = body;

    if (typeof archiveId !== 'string' || !archiveId) {
      return NextResponse.json({ error: 'archiveId is required' }, { status: 400 });
    }

    const trimmed = typeof vibe === 'string' ? vibe.trim().slice(0, 120) : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'vibe is required' }, { status: 400 });
    }

    // Deterministic ID — posts once ever per archive. Concurrent listeners all
    // target the same doc; .create() lets the first win and the rest no-op.
    const messageRef = db
      .collection('chats')
      .doc('channelbroadcast')
      .collection('messages')
      .doc(`archive-radio-vibe-${archiveId}`);

    try {
      await messageRef.create({
        stationId: 'channelbroadcast',
        username: typeof djName === 'string' && djName.trim() ? djName.trim() : 'Channel Radio',
        message: trimmed,
        timestamp: FieldValue.serverTimestamp(),
        isDJ: true,
        messageType: 'vibe',
        archiveId,
      });
    } catch {
      // Already posted for this archive — expected when a later/concurrent
      // listener calls in. Not an error.
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[archive-radio/post-vibe] Error:', error);
    return NextResponse.json({ error: 'Failed to post vibe' }, { status: 500 });
  }
}
