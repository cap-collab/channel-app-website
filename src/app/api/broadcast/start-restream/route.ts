import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { EgressClient, SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from 'livekit-server-sdk';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { ROOM_NAME } from '@/types/broadcast';

const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || 'channel-broadcast';
const r2Endpoint = process.env.R2_ACCOUNT_ID
  ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : '';

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

    // App URL so the worker can call back to complete-slot precisely at
    // slot.endTime (matching how a live DJ's browser ends its own slot).
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    const endTimeMs = slot.endTime?.toMillis?.() ?? slot.endTime ?? null;

    console.log(`[start-restream] Starting worker for slot ${slotId}, archiveUrl: ${archiveUrl}, endTime: ${endTimeMs}`);
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
        appUrl,
        endTime: endTimeMs,
      }),
    });

    if (!workerResp.ok) {
      const err = await workerResp.text();
      throw new Error(`Worker returned ${workerResp.status}: ${err}`);
    }

    const workerData = await workerResp.json() as { ingressId?: string };
    console.log(`[start-restream] Worker started for slot ${slotId} (RTMP ingress ${workerData.ingressId})`);

    // Start the HLS egress here rather than deferring to the track_published
    // webhook. The webhook path is unreliable in practice — LiveKit signs
    // webhook requests with a 5-minute JWT and we've seen them arrive
    // already-expired after bursty delivery or Vercel cold starts, which
    // silently drops the "start egress" action. Kicking it off directly
    // makes the handoff deterministic. It's fine that the ingress hasn't
    // necessarily published yet: startRoomCompositeEgress waits for an
    // audio track to appear in the room.
    let restreamEgressId: string | undefined;
    let reusedEgress = false;
    if (r2AccessKey && r2SecretKey && r2Endpoint) {
      try {
        const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

        // If a live broadcast's HLS egress is still running on this room
        // (complete-slot keeps it alive across transitions for manifest
        // continuity), reuse it. The egress composes whatever audio is in
        // the room, so the restream participant's audio flows through the
        // same playlist the live DJ's did — listener never reloads.
        try {
          const existing = await egressClient.listEgress({ roomName: ROOM_NAME, active: true });
          for (const e of existing) {
            if (!restreamEgressId) {
              restreamEgressId = e.egressId;
              reusedEgress = true;
              console.log(`[start-restream] Reusing existing HLS egress: ${e.egressId}`);
            } else {
              // Any additional stale egresses — stop them
              try {
                await egressClient.stopEgress(e.egressId);
                console.log(`[start-restream] Stopped stale egress: ${e.egressId}`);
              } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }

        if (!restreamEgressId) {
          const s3Upload = new S3Upload({
            accessKey: r2AccessKey,
            secret: r2SecretKey,
            bucket: r2Bucket,
            region: 'auto',
            endpoint: r2Endpoint,
            forcePathStyle: true,
          });
          // Live and restream share this R2 prefix so the listener's HLS
          // url stays the same across transitions.
          const segmentOutput = new SegmentedFileOutput({
            protocol: SegmentedFileProtocol.HLS_PROTOCOL,
            filenamePrefix: `${ROOM_NAME}/stream`,
            playlistName: 'playlist.m3u8',
            livePlaylistName: 'live.m3u8',
            segmentDuration: 6,
            output: { case: 's3', value: s3Upload },
          });
          const hlsEgress = await egressClient.startRoomCompositeEgress(
            ROOM_NAME,
            { segments: segmentOutput },
            { audioOnly: true },
          );
          restreamEgressId = hlsEgress.egressId;
          console.log(`[start-restream] HLS egress started: ${restreamEgressId}`);
        }
      } catch (err) {
        console.error(`[start-restream] Failed to start/reuse egress for ${slotId}:`, err);
        // Non-fatal — the webhook path will try again on track_published.
      }
    }

    // Set slot to live. Store ingress+egress ids so cleanupSlotLiveKit can
    // tear them down when the slot ends.
    await slotDoc.ref.update({
      status: 'live',
      restreamWorkerId: slotId,
      restreamIngressId: workerData.ingressId || FieldValue.delete(),
      restreamEgressId: restreamEgressId || FieldValue.delete(),
    });

    return NextResponse.json({
      success: true,
      slotId,
      ingressId: workerData.ingressId,
      egressId: restreamEgressId,
      reusedEgress,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
