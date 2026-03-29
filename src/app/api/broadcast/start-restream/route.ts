import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { IngressClient, IngressInput, EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from '@livekit/protocol';
import { ROOM_NAME } from '@/types/broadcast';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || '';
const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

// POST - Start a restream by creating a URL ingress + HLS egress
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

    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit not configured' }, { status: 500 });
    }

    // Create URL ingress
    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
    const ingress = await ingressClient.createIngress(
      IngressInput.URL_INPUT,
      {
        name: `restream-${slotId}`,
        roomName: ROOM_NAME,
        participantIdentity: `restream-${slotId}`,
        participantName: slot.showName || 'Restream',
        url: slot.archiveRecordingUrl,
      }
    );
    console.log(`[start-restream] Ingress created: ${ingress.ingressId}`);

    // Wait for the ingress participant to join the room and start publishing
    // before starting the HLS egress, otherwise the egress composites silence.
    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
    const ingressIdentity = `restream-${slotId}`;
    let ingressReady = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const participants = await roomService.listParticipants(ROOM_NAME);
        const ingressParticipant = participants.find(
          p => p.identity === ingressIdentity && p.tracks.some(t => !t.muted)
        );
        if (ingressParticipant) {
          console.log(`[start-restream] Ingress participant publishing after ${(attempt + 1) * 2}s`);
          ingressReady = true;
          break;
        }
        console.log(`[start-restream] Waiting for ingress participant... (attempt ${attempt + 1}/15, ${participants.length} participants)`);
      } catch { /* room may not exist yet */ }
    }
    if (!ingressReady) {
      console.warn('[start-restream] Ingress participant not found after 30s, starting egress anyway');
    }

    // Start HLS egress
    let hlsEgressId: string | null = null;
    if (r2AccessKey && r2SecretKey) {
      const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

      // Stop any stale egresses first
      try {
        const existing = await egressClient.listEgress({ roomName: ROOM_NAME });
        for (const e of existing) {
          if (e.status === 0 || e.status === 1) {
            try {
              await egressClient.stopEgress(e.egressId);
              console.log(`[start-restream] Stopped stale egress: ${e.egressId}`);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }

      const s3Upload = new S3Upload({
        accessKey: r2AccessKey,
        secret: r2SecretKey,
        bucket: r2Bucket,
        region: 'auto',
        endpoint: r2Endpoint,
        forcePathStyle: true,
      });
      const segmentOutput = new SegmentedFileOutput({
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
        filenamePrefix: `${ROOM_NAME}/stream`,
        playlistName: 'playlist.m3u8',
        livePlaylistName: 'live.m3u8',
        segmentDuration: 2,
        output: { case: 's3', value: s3Upload },
      });
      const hlsEgress = await egressClient.startRoomCompositeEgress(
        ROOM_NAME,
        { segments: segmentOutput },
        { audioOnly: true }
      );
      hlsEgressId = hlsEgress.egressId;
      console.log(`[start-restream] HLS egress started: ${hlsEgressId}`);
    }

    // Update slot with ingress/egress IDs
    await slotDoc.ref.update({
      status: 'live',
      restreamIngressId: ingress.ingressId,
      ...(hlsEgressId ? { restreamEgressId: hlsEgressId } : {}),
    });

    return NextResponse.json({
      success: true,
      slotId,
      ingressId: ingress.ingressId,
      egressId: hlsEgressId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[start-restream] Error:', error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
