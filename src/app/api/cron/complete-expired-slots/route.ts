import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { EgressClient, IngressClient, RoomServiceClient } from 'livekit-server-sdk';
import { ROOM_NAME } from '@/types/broadcast';

// LiveKit server configuration
const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// App URL for internal API calls
const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const cronSecret = process.env.CRON_SECRET || '';

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
    const restreamErrors: string[] = [];

    // Initialize LiveKit client if configured
    const roomService = (livekitHost && apiKey && apiSecret)
      ? new RoomServiceClient(livekitHost, apiKey, apiSecret)
      : null;

    // ── Step 1: Complete expired slots FIRST ──
    // This ensures the previous live show is cleaned up before activating restreams.
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
          if (slot.restreamIngressId && livekitHost && apiKey && apiSecret) {
            try {
              const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
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

    // ── Step 2: Activate scheduled restreams AFTER completing expired slots ──
    // This ensures the previous show is cleaned up and the LiveKit room is free.
    const restreamSnapshot = await db
      .collection('broadcast-slots')
      .where('broadcastType', '==', 'restream')
      .get();

    for (const restreamDoc of restreamSnapshot.docs) {
      try {
        const slot = restreamDoc.data();
        const startTime = slot.startTime?.toMillis?.() || slot.startTime;
        const endTime = slot.endTime?.toMillis?.() || slot.endTime;
        // Only process scheduled or live (without ingress) restreams
        if (slot.status !== 'scheduled' && slot.status !== 'live') continue;
        // Skip if not yet started or already ended
        if (!startTime || now < startTime || now >= endTime) continue;
        // Skip if already live AND already has ingress set up
        if (slot.status === 'live' && slot.restreamIngressId) continue;

        // Call the start-restream endpoint to create ingress
        // (the HLS egress is started by the LiveKit webhook when the ingress publishes audio)
        try {
          const res = await fetch(`${appUrl}/api/broadcast/start-restream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cronSecret}`,
            },
            body: JSON.stringify({ slotId: restreamDoc.id }),
          });
          const data = await res.json();
          if (res.ok) {
            console.log(`Restream ${restreamDoc.id} started: ingress=${data.ingressId}`);
          } else {
            restreamErrors.push(`${restreamDoc.id}: ${data.error}`);
            // Still set to live so the player shows up (audio will be missing though)
            if (slot.status === 'scheduled') {
              await restreamDoc.ref.update({ status: 'live' });
            }
          }
        } catch (fetchErr) {
          const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          restreamErrors.push(`${restreamDoc.id}: fetch failed: ${errMsg}`);
          if (slot.status === 'scheduled') {
            await restreamDoc.ref.update({ status: 'live' });
          }
        }
        restreamActivatedCount++;
      } catch (err) {
        console.error(`Error activating restream ${restreamDoc.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      completed: completedCount,
      missed: missedCount,
      disconnected: disconnectedCount,
      restreamActivated: restreamActivatedCount,
      restreamErrors: restreamErrors.length > 0 ? restreamErrors : undefined,
      totalProcessed: completedCount + missedCount,
    });
  } catch (error) {
    console.error('Error in complete-expired-slots cron:', error);
    return NextResponse.json({ error: 'Failed to process slots' }, { status: 500 });
  }
}
