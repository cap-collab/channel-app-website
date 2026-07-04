import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { cleanupSlotLiveKit } from '@/lib/livekit-cleanup';

// POST /api/broadcast/delete-slot — release the slot's LiveKit resources
// (HLS/recording/restream egresses, restream worker, RTMP ingress, room
// participant) before dropping the Firestore doc. Without this, deleting a
// live/active slot leaves zombie participants occupying the room and blocks
// the next broadcast.
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const hasCronSecret = !!token && token === process.env.CRON_SECRET;

    let authorized = hasCronSecret;
    if (!authorized && token) {
      const auth = getAdminAuth();
      const db = getAdminDb();
      if (auth && db) {
        try {
          const decoded = await auth.verifyIdToken(token);
          const userDoc = await db.collection('users').doc(decoded.uid).get();
          const role = userDoc.data()?.role;
          authorized = role === 'admin' || role === 'broadcaster';
        } catch { /* fall through */ }
      }
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slotId } = await request.json();
    if (!slotId) {
      return NextResponse.json({ error: 'slotId required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();
    if (!slotDoc.exists) {
      // Already gone — idempotent success.
      return NextResponse.json({ success: true, alreadyGone: true });
    }
    const slot = slotDoc.data()!;

    // Release LiveKit resources first so the room isn't left with a zombie
    // participant/ingress when the Firestore doc disappears (the cron can
    // only reconcile what it can find in Firestore).
    const cleanup = await cleanupSlotLiveKit({
      slotId,
      egressId: slot.egressId,
      recordingEgressId: slot.recordingEgressId,
      restreamEgressId: slot.restreamEgressId,
      restreamWorkerId: slot.restreamWorkerId,
      restreamIngressId: slot.restreamIngressId,
      liveDjUsername: slot.liveDjUsername,
      liveDjUserId: slot.liveDjUserId,
    });

    await slotRef.delete();

    return NextResponse.json({ success: true, cleanup });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[delete-slot] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
