import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminRtdb } from '@/lib/firebase-admin';
import { cleanupSlotLiveKit } from '@/lib/livekit-cleanup';

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
          const cleanup = await cleanupSlotLiveKit({
            slotId: doc.id,
            egressId: slot.egressId,
            recordingEgressId: slot.recordingEgressId,
            restreamEgressId: slot.restreamEgressId,
            restreamWorkerId: slot.restreamWorkerId,
            restreamIngressId: slot.restreamIngressId,
            liveDjUsername: slot.liveDjUsername,
            liveDjUserId: slot.liveDjUserId,
          });
          if (cleanup.removedParticipant) disconnectedCount++;
          console.log(`[cron] LiveKit cleanup for slot ${doc.id}:`, cleanup);
        }
      } catch (slotError) {
        // Log but continue processing remaining slots
        console.error(`Error processing slot ${doc.id}:`, slotError);
      }
    }

    // ── Safety net: clear RTDB isStreaming if no live slots remain ──
    // This prevents stuck isStreaming=true if a webhook was missed or failed.
    if (completedCount > 0) {
      try {
        const liveCheck = await db
          .collection('broadcast-slots')
          .where('status', '==', 'live')
          .limit(1)
          .get();
        if (liveCheck.empty) {
          const rtdb = getAdminRtdb();
          if (rtdb) {
            await rtdb.ref('status/broadcast').set({
              isStreaming: false,
              dj: null,
              updatedAt: Date.now(),
            });
            console.log('Cleared RTDB isStreaming (no live slots remain)');
          }
        }
      } catch (e) {
        console.error('Failed to clear RTDB streaming status:', e);
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
        // Skip if already live AND already has worker/ingress set up
        if (slot.status === 'live' && (slot.restreamWorkerId || slot.restreamIngressId)) continue;

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
