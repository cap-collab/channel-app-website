import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Save the show vibe onto a broadcast slot. Locked once set: a slot
// that already has a non-empty showVibe is not overwritten.
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

    // Lock rule — once a vibe is set it cannot be changed.
    const existing = slotData.showVibe;
    if (typeof existing === 'string' && existing.trim()) {
      return NextResponse.json(
        { error: 'Vibe already set', showVibe: existing, locked: true },
        { status: 409 },
      );
    }

    await slotDoc.ref.update({ showVibe: trimmed });

    return NextResponse.json({ success: true, showVibe: trimmed, locked: true });
  } catch (error) {
    console.error('[update-vibe] Error:', error);
    return NextResponse.json({ error: 'Failed to update vibe' }, { status: 500 });
  }
}
