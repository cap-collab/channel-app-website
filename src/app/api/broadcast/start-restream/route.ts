import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL || '';

// POST - Start a restream by calling the restream worker on Hetzner.
// The worker creates a LiveKit RTMP ingress and streams the archive MP4
// into the channel-radio room as a participant with identity
// `restream-<slotId>`. From there the existing webhook→egress→R2 pipeline
// (the `track_published` handler in /api/livekit/webhook) picks it up the
// same way it picks up a DJ going live via RTMP.
export async function POST(request: NextRequest) {
  try {
    // Accept cron secret OR a Firebase ID token from an admin/broadcaster user.
    // The admin UI hits this on restream slot save so the worker starts
    // immediately instead of waiting for the 5-min cron tick.
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
        } catch {
          // fall through — not a valid ID token
        }
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

    // Worker needs LiveKit creds to create the RTMP ingress. The LiveKit
    // server's HTTP API lives at the same host as the ws endpoint, just http(s).
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json({ error: 'LiveKit env vars missing (LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL)' }, { status: 500 });
    }
    const livekitHost = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');

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
        livekitHost,
      }),
    });

    if (!workerResp.ok) {
      const err = await workerResp.text();
      throw new Error(`Worker returned ${workerResp.status}: ${err}`);
    }

    const workerData = await workerResp.json() as { ingressId?: string };
    console.log(`[start-restream] Worker started for slot ${slotId} (RTMP ingress ${workerData.ingressId})`);

    // Set slot to live. Store the ingress id so cleanupSlotLiveKit can tear
    // the ingress down when the slot ends. Clear any prior egress id so the
    // webhook's track_published handler starts a fresh HLS egress (it skips
    // when the field is already set, which would leave listeners on a dead
    // manifest from an earlier run).
    await slotDoc.ref.update({
      status: 'live',
      restreamWorkerId: slotId,
      restreamIngressId: workerData.ingressId || FieldValue.delete(),
      restreamEgressId: FieldValue.delete(),
    });

    return NextResponse.json({
      success: true,
      slotId,
      ingressId: workerData.ingressId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
