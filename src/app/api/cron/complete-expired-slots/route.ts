import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { EgressClient, IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk';
import { SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from '@livekit/protocol';
import { ROOM_NAME } from '@/types/broadcast';

// LiveKit server configuration
const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// R2 config (S3-compatible) for HLS egress
const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || '';
const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// This cron job runs every 5 minutes to mark expired slots as completed or missed
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const now = Date.now();
    let completedCount = 0;
    let missedCount = 0;
    let disconnectedCount = 0;
    let restreamActivatedCount = 0;

    // Initialize LiveKit client if configured
    const roomService = (livekitHost && apiKey && apiSecret)
      ? new RoomServiceClient(livekitHost, apiKey, apiSecret)
      : null;

    // Auto-activate scheduled restreams whose start time has arrived,
    // AND fix any live restreams that are missing their ingress/egress
    // (e.g. activated before the ingress code was deployed)
    const restreamSnapshot = await db
      .collection('broadcast-slots')
      .where('status', 'in', ['scheduled', 'live'])
      .where('broadcastType', '==', 'restream')
      .get();

    // Initialize IngressClient for restream URL ingress
    const ingressClient = (livekitHost && apiKey && apiSecret)
      ? new IngressClient(livekitHost, apiKey, apiSecret)
      : null;

    for (const restreamDoc of restreamSnapshot.docs) {
      try {
        const slot = restreamDoc.data();
        const startTime = slot.startTime?.toMillis?.() || slot.startTime;
        const endTime = slot.endTime?.toMillis?.() || slot.endTime;
        // Skip if not yet started or already ended
        if (!startTime || now < startTime || now >= endTime) continue;
        // Skip if already live AND already has ingress set up
        if (slot.status === 'live' && slot.restreamIngressId) continue;

          // Create a URL ingress to push the archive audio into the LiveKit room,
          // then start an HLS egress so mobile/Safari listeners can hear it too.
          if (ingressClient && slot.archiveRecordingUrl) {
            try {
              const ingress = await ingressClient.createIngress(
                IngressInput.URL_INPUT,
                {
                  name: `restream-${restreamDoc.id}`,
                  roomName: ROOM_NAME,
                  participantIdentity: `restream-${restreamDoc.id}`,
                  participantName: slot.showName || 'Restream',
                  url: slot.archiveRecordingUrl,
                }
              );
              console.log(`Restream ingress created: ${ingress.ingressId}`);

              // Start HLS egress to write stream segments to R2
              let hlsEgressId: string | null = null;
              if (r2AccessKey && r2SecretKey) {
                try {
                  const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
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
                  console.log(`Restream HLS egress started: ${hlsEgressId}`);
                } catch (egressErr) {
                  console.error(`Error starting HLS egress for restream ${restreamDoc.id}:`, egressErr);
                }
              }

              // Save ingress + egress IDs so we can clean them up when the slot ends
              await restreamDoc.ref.update({
                status: 'live',
                restreamIngressId: ingress.ingressId,
                ...(hlsEgressId ? { restreamEgressId: hlsEgressId } : {}),
              });
              console.log(`Restream slot ${restreamDoc.id} activated with ingress ${ingress.ingressId}`);
            } catch (ingressErr) {
              console.error(`Error creating ingress for restream ${restreamDoc.id}:`, ingressErr);
              await restreamDoc.ref.update({ status: 'live' });
              console.log(`Restream slot ${restreamDoc.id} activated (set to live, ingress failed)`);
            }
          } else {
            await restreamDoc.ref.update({ status: 'live' });
            console.log(`Restream slot ${restreamDoc.id} activated (set to live, no ingress client or no archive URL)`);
          }
          restreamActivatedCount++;
      } catch (err) {
        console.error(`Error activating restream ${restreamDoc.id}:`, err);
      }
    }

    // Query all slots that are still live, paused, or scheduled
    // We'll check their end times in memory
    const snapshot = await db
      .collection('broadcast-slots')
      .where('status', 'in', ['live', 'paused', 'scheduled'])
      .get();

    for (const doc of snapshot.docs) {
      try {
        const slot = doc.data();
        const endTime = slot.endTime?.toMillis?.() || slot.endTime;

        // Skip if slot hasn't ended yet or endTime is invalid
        if (!endTime || now <= endTime) continue;

        // Determine final status based on current status
        let newStatus: 'completed' | 'missed';

        if (slot.status === 'live' || slot.status === 'paused') {
          newStatus = 'completed';
          completedCount++;
        } else if (slot.status === 'scheduled') {
          newStatus = 'missed';
          missedCount++;
        } else {
          continue;
        }

        // Update Firebase status FIRST, before attempting LiveKit disconnect
        await doc.ref.update({ status: newStatus });
        console.log(`Slot ${doc.id} marked as ${newStatus}`);

        // Clean up LiveKit resources when slot ends
        if (slot.status === 'live') {
          // Clean up restream ingress + egress if this was a restream
          if (slot.restreamIngressId && ingressClient) {
            try {
              await ingressClient.deleteIngress(slot.restreamIngressId);
              console.log(`Deleted restream ingress ${slot.restreamIngressId} for slot ${doc.id}`);
            } catch (e) {
              console.log(`Could not delete restream ingress ${slot.restreamIngressId}: ${e}`);
            }
          }
          if (slot.restreamEgressId) {
            try {
              const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
              await egressClient.stopEgress(slot.restreamEgressId);
              console.log(`Stopped restream HLS egress ${slot.restreamEgressId} for slot ${doc.id}`);
            } catch (e) {
              console.log(`Could not stop restream egress ${slot.restreamEgressId}: ${e}`);
            }
          }

          // Disconnect DJ from LiveKit if they're still connected
          if (roomService) {
            const djIdentity = slot.restreamIngressId
              ? `restream-${doc.id}`
              : (slot.liveDjUsername || slot.liveDjUserId);
            if (djIdentity) {
              try {
                await roomService.removeParticipant(ROOM_NAME, djIdentity);
                disconnectedCount++;
                console.log(`Disconnected ${djIdentity} from LiveKit (show ended)`);
              } catch (e) {
                // Participant may have already disconnected - that's fine
                console.log(`Could not remove ${djIdentity} from LiveKit: ${e}`);
              }
            }
          }
        }
      } catch (slotError) {
        // Log but continue processing remaining slots
        console.error(`Error processing slot ${doc.id}:`, slotError);
      }
    }

    return NextResponse.json({
      success: true,
      completed: completedCount,
      missed: missedCount,
      disconnected: disconnectedCount,
      restreamActivated: restreamActivatedCount,
      totalProcessed: completedCount + missedCount,
    });
  } catch (error) {
    console.error('Error in complete-expired-slots cron:', error);
    return NextResponse.json({ error: 'Failed to process slots' }, { status: 500 });
  }
}
