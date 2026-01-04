import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot } from '@/types/broadcast';

// POST - Update DJ username for a broadcast slot
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, username, userId } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    if (!username) {
      return NextResponse.json({ error: 'No username provided' }, { status: 400 });
    }

    // Validate username format (2-20 chars, alphanumeric and single spaces)
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2 || trimmedUsername.length > 20) {
      return NextResponse.json({ error: 'Username must be 2-20 characters' }, { status: 400 });
    }

    // Must contain at least 2 alphanumeric characters (when spaces removed)
    const handle = trimmedUsername.replace(/\s+/g, '');
    if (handle.length < 2) {
      return NextResponse.json({ error: 'Username must have at least 2 characters (excluding spaces)' }, { status: 400 });
    }

    // Alphanumeric and single spaces only
    if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmedUsername)) {
      return NextResponse.json({ error: 'Username can only contain letters, numbers, and spaces' }, { status: 400 });
    }

    // Check reserved usernames against normalized handle
    const reserved = ['channel', 'admin', 'system', 'moderator', 'mod'];
    if (reserved.includes(handle.toLowerCase())) {
      return NextResponse.json({ error: 'This username is reserved' }, { status: 400 });
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const slot = doc.data() as Omit<BroadcastSlot, 'id'>;

    // Check if token has expired
    const now = Date.now();
    if (slot.tokenExpiresAt.toMillis() < now) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 410 });
    }

    // Check if slot is still valid
    if (slot.status === 'completed' || slot.status === 'missed') {
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Update the slot with DJ info
    const updateData: Record<string, string> = {
      liveDjUsername: trimmedUsername,
    };

    // If userId is provided (logged in), store it too
    if (userId) {
      updateData.liveDjUserId = userId;
    }

    await doc.ref.update(updateData);

    return NextResponse.json({
      success: true,
      username: trimmedUsername,
      slotId: doc.id,
    });
  } catch (error) {
    console.error('Error updating DJ username:', error);
    return NextResponse.json({ error: 'Failed to update username' }, { status: 500 });
  }
}
