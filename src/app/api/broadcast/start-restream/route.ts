import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';
const livekitWsUrl = process.env.LIVEKIT_URL || '';

// POST - Start a restream by calling the restream worker on Hetzner.
// The worker joins the LiveKit room as a participant, decodes the MP4 with FFmpeg,
// and publishes audio — exactly like a live DJ's browser does.
// The HLS egress is then started by the webhook when the worker publishes audio.
export async function POST(request: NextRequest) {
  try {
    // Verify auth (cron secret or admin)
    const authHeader = request.headers.get('authorization');
    const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    if (!hasValidSecret) {
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

    const slotDoc = await db.collection('broadcast-slots').doc(slotId).get();
    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slot = slotDoc.data()!;
    if (slot.broadcastType !== 'restream') {
      return NextResponse.json({ error: 'Not a restream slot' }, { status: 400 });
    }
    if (!slot.archiveRecordingUrl) {
      return NextResponse.json({ error: 'No archiveRecordingUrl on slot' }, { status: 400 });
    }

    if (!restreamWorkerUrl) {
      return NextResponse.json({ error: 'RESTREAM_WORKER_URL not configured' }, { status: 500 });
    }

    // Call the restream worker on Hetzner to join the room and publish audio
    console.log(`[start-restream] Starting worker for slot ${slotId}, archiveUrl: ${slot.archiveRecordingUrl}`);
    const workerResp = await fetch(`${restreamWorkerUrl}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        slotId,
        archiveUrl: slot.archiveRecordingUrl,
        roomName: ROOM_NAME,
        apiKey,
        apiSecret,
        wsUrl: livekitWsUrl,
      }),
    });

    if (!workerResp.ok) {
      const err = await workerResp.text();
      throw new Error(`Worker returned ${workerResp.status}: ${err}`);
    }

    const workerData = await workerResp.json();
    console.log(`[start-restream] Worker started: identity=${workerData.identity} (egress will start via webhook)`);

    // Set slot to live. Egress ID will be set by the webhook when track_published fires.
    await slotDoc.ref.update({
      status: 'live',
      restreamWorkerId: slotId, // Track that this slot uses the worker (not ingress)
    });

    return NextResponse.json({
      success: true,
      slotId,
      identity: workerData.identity,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
