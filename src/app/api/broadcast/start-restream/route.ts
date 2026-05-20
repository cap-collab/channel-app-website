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

    const { slotId, reuseHlsEgress, scheduleMode } = await request.json() as {
      slotId?: string;
      reuseHlsEgress?: boolean;
      scheduleMode?: boolean;
    };
    if (!slotId) {
      return NextResponse.json({ error: 'slotId required' }, { status: 400 });
    }
    // Mirrors the `/api/livekit/egress` pattern: caller says whether this is
    // a seamless handoff from a previous slot (reuse the kept-alive egress)
    // or a fresh start (stop any stale egresses, start a new one). Default
    // false so cron/admin cold-start paths don't accidentally reuse a
    // dying orphaned egress and inherit its ENDLIST.
    const reuseEgressFromHandoff = reuseHlsEgress === true;
    // scheduleMode: caller knows the slot's startTime is in the future but
    // wants the worker to hold a timer and start at exactly that time. Used
    // when a live broadcast ends early and the next restream is minutes
    // away. We skip the egress-start step here (no point starting an egress
    // with no publisher in the room) and hit the worker's /schedule endpoint
    // instead of /start.
    const deferStart = scheduleMode === true;

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
    const startTimeMs = slot.startTime?.toMillis?.() ?? slot.startTime ?? null;

    const workerPayload = {
      slotId,
      archiveUrl,
      roomName: ROOM_NAME,
      apiKey,
      apiSecret,
      livekitHost,
      appUrl,
      endTime: endTimeMs,
    };

    // deferStart: caller says the slot's startTime is in the future and
    // wants the worker to hold a timer and start at exactly that time.
    // Short-circuit here — no ingress, no egress yet. The worker's
    // /schedule endpoint will call back to its own startSlot() logic when
    // the timer fires, which will hit the rest of this flow indirectly
    // via the worker's internal state (egress still needs to be started
    // by a subsequent /start-restream call — we re-POST ourselves on
    // fire). For now, keep it simple: worker just runs startSlot itself,
    // and egress is started by the webhook's track_published handler as
    // the fallback path (we accept the ~1s egress-start latency for the
    // early-end edge case, which is rare).
    if (deferStart) {
      if (typeof startTimeMs !== 'number' || startTimeMs <= Date.now()) {
        return NextResponse.json({ error: 'scheduleMode requires a future startTime' }, { status: 400 });
      }
      console.log(`[start-restream] Scheduling worker start for slot ${slotId} at ${new Date(startTimeMs).toISOString()}`);
      const schedResp = await fetch(`${restreamWorkerUrl}/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ ...workerPayload, startTime: startTimeMs }),
      });
      if (!schedResp.ok) {
        const err = await schedResp.text();
        throw new Error(`Worker /schedule returned ${schedResp.status}: ${err}`);
      }
      const schedData = await schedResp.json() as { wasScheduled?: boolean; delayMs?: number };
      console.log(`[start-restream] Worker scheduled for ${slotId} (wasScheduled=${schedData.wasScheduled}, delayMs=${schedData.delayMs})`);
      // Intentionally do NOT update the slot's status or fields here. The slot
      // stays `scheduled` in Firestore until startTime, when the worker
      // re-triggers the real start path. Listeners/hero treat it as upcoming.
      return NextResponse.json({
        success: true,
        slotId,
        scheduled: true,
        startTime: startTimeMs,
      });
    }

    console.log(`[start-restream] Starting worker for slot ${slotId}, archiveUrl: ${archiveUrl}, endTime: ${endTimeMs}`);
    const workerResp = await fetch(`${restreamWorkerUrl}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(workerPayload),
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

        // Handle existing active egresses based on caller's reuse intent.
        // Mirrors /api/livekit/egress logic for live broadcasts.
        try {
          const existing = await egressClient.listEgress({ roomName: ROOM_NAME, active: true });
          for (const e of existing) {
            if (reuseEgressFromHandoff && !restreamEgressId) {
              // Caller indicated this is a transition from a slot that was
              // just cleaned up with keepHlsEgress:true — safely reuse.
              restreamEgressId = e.egressId;
              reusedEgress = true;
              console.log(`[start-restream] Reusing existing HLS egress for handoff: ${e.egressId}`);
            } else {
              // Either this is a cold start (no handoff) or we've already
              // chosen one to reuse and the rest are stale — stop them.
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
