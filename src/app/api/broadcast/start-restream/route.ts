import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL || '';

// POST - Start a restream by calling the restream worker on Hetzner.
// The worker uses FFmpeg to convert the archive MP4 to HLS segments
// and uploads them directly to R2 — same format as the LiveKit egress.
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

    // Resolve archive URL from the source of truth (archives collection), not
    // the slot's cached copy — archives can be normalized/re-hosted after a slot
    // is scheduled, and the stale copy breaks the worker with "Missing required fields".
    let archiveUrl: string | undefined = slot.archiveRecordingUrl;
    if (slot.archiveId) {
      const archiveDoc = await db.collection('archives').doc(slot.archiveId).get();
      const freshUrl = archiveDoc.exists ? archiveDoc.data()?.recordingUrl : undefined;
      if (freshUrl) {
        if (freshUrl !== slot.archiveRecordingUrl) {
          console.log(`[start-restream] slot ${slotId}: using fresh archive URL (slot had stale copy)`);
          // Repair the slot's cached copy so other readers (cron, admin UI) stay consistent
          await slotDoc.ref.update({ archiveRecordingUrl: freshUrl });
        }
        archiveUrl = freshUrl;
      }
    }
    if (!archiveUrl) {
      return NextResponse.json({ error: 'No recordingUrl on archive or slot' }, { status: 400 });
    }

    if (!restreamWorkerUrl) {
      return NextResponse.json({ error: 'RESTREAM_WORKER_URL not configured' }, { status: 500 });
    }

    // Worker needs LiveKit creds to publish into the room on our behalf.
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json({ error: 'LiveKit env vars missing (LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL)' }, { status: 500 });
    }

    // Call the restream worker on Hetzner to start FFmpeg → HLS → R2
    console.log(`[start-restream] Starting worker for slot ${slotId}, archiveUrl: ${archiveUrl}`);
    const workerResp = await fetch(`${restreamWorkerUrl}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        slotId,
        archiveUrl,
        roomName: ROOM_NAME,
        apiKey,
        apiSecret,
        wsUrl,
      }),
    });

    if (!workerResp.ok) {
      const err = await workerResp.text();
      throw new Error(`Worker returned ${workerResp.status}: ${err}`);
    }

    await workerResp.json();
    console.log(`[start-restream] Worker started for slot ${slotId} (FFmpeg → HLS → R2)`);

    // Set slot to live
    await slotDoc.ref.update({
      status: 'live',
      restreamWorkerId: slotId, // Track that this slot uses the worker
    });

    return NextResponse.json({
      success: true,
      slotId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
