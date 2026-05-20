import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Save the show vibe onto a broadcast slot. Editable any time; if the
// vibe has already been posted as a chat message (at go-live), the posted
// message is updated in place so the pinned message stays current.
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, showVibe } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    if (typeof showVibe !== 'string') {
      return NextResponse.json({ error: 'Vibe must be a string' }, { status: 400 });
    }

    const trimmed = showVibe.trim().slice(0, 120);
    if (!trimmed) {
      return NextResponse.json({ error: 'Vibe cannot be empty' }, { status: 400 });
    }

    // Vibe lives on broadcast-slots only — studio-sessions is recording-only
    // and has no listener chat.
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    const slotDoc = snapshot.docs[0];
    const slotData = slotDoc.data();

    await slotDoc.ref.update({ showVibe: trimmed });

    // If the vibe was already posted to chat, update those messages in place
    // so the pinned message reflects the edit. Best-effort.
    if (slotData.vibeMessagePosted) {
      try {
        if (slotData.vibeMessageRoom && slotData.vibeMessageId) {
          await db.collection('chats')
            .doc(slotData.vibeMessageRoom)
            .collection('messages')
            .doc(slotData.vibeMessageId)
            .update({ message: trimmed });
        }
        if (slotData.vibeMessageBroadcastId) {
          await db.collection('chats')
            .doc('channelbroadcast')
            .collection('messages')
            .doc(slotData.vibeMessageBroadcastId)
            .update({ message: trimmed });
        }
      } catch (msgError) {
        console.error('[update-vibe] Failed to update posted vibe message:', msgError);
      }
    }

    return NextResponse.json({ success: true, showVibe: trimmed });
  } catch (error) {
    console.error('[update-vibe] Error:', error);
    return NextResponse.json({ error: 'Failed to update vibe' }, { status: 500 });
  }
}
