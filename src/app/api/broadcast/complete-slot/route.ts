import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot, Recording, ROOM_NAME } from '@/types/broadcast';
import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';

// POST - Mark a slot as completed (called when slot end time passes)
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { slotId } = body;

    if (!slotId) {
      return NextResponse.json({ error: 'Missing slotId' }, { status: 400 });
    }

    // Get the slot
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slot = slotDoc.data() as Omit<BroadcastSlot, 'id'>;
    const { force } = body;  // Allow force completion when DJ ends broadcast early
    const now = Date.now();
    const endTime = slot.endTime.toMillis();

    // If not forced, only complete if end time has passed
    if (!force && now <= endTime) {
      return NextResponse.json({ error: 'Slot has not ended yet' }, { status: 400 });
    }

    // Determine final status based on current status and timing
    let newStatus: 'completed' | 'missed' | 'paused';

    if (slot.status === 'live' || slot.status === 'paused') {
      if (force && now <= endTime) {
        // DJ ended early but time slot is still active - mark as paused so they can resume
        newStatus = 'paused';
      } else {
        // Time slot has passed - mark as completed
        newStatus = 'completed';
      }
    } else if (slot.status === 'scheduled') {
      // Never went live
      if (now > endTime) {
        // Time has passed, mark as missed
        newStatus = 'missed';
      } else {
        // Still within time slot, nothing to do
        return NextResponse.json({ success: true, status: slot.status });
      }
    } else {
      // Already completed or missed, nothing to do
      return NextResponse.json({ success: true, status: slot.status });
    }

    // Update status and mark any active recordings as 'processing'
    const updateData: Record<string, unknown> = { status: newStatus };

    // Mark all active recordings as 'processing' (they'll be updated to 'ready' by webhook)
    if (slot.recordings && slot.recordings.length > 0) {
      const updatedRecordings = slot.recordings.map((rec: Recording) => {
        if (rec.status === 'recording') {
          return { ...rec, status: 'processing' as const, endedAt: Date.now() };
        }
        return rec;
      });
      updateData.recordings = updatedRecordings;
    }

    // Also update legacy field if present
    if (slot.recordingStatus === 'recording') {
      updateData.recordingStatus = 'processing';
    }

    // When completing a slot, try to atomically activate the next scheduled show in the same
    // batch write. This prevents a Firestore gap where no slot has status='live' during DJ
    // transitions (same pattern as go-live/route.ts).
    let nextShowDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let nextShowIsRestream = false;

    if (newStatus === 'completed') {
      try {
        const nextShowSnapshot = await db
          .collection('broadcast-slots')
          .where('status', '==', 'scheduled')
          .get();

        for (const nextDoc of nextShowSnapshot.docs) {
          const nextSlot = nextDoc.data();
          const startTime = nextSlot.startTime?.toMillis?.() || nextSlot.startTime;
          const nextEndTime = nextSlot.endTime?.toMillis?.() || nextSlot.endTime;
          if (!startTime || now < startTime || now >= nextEndTime) continue;

          nextShowDoc = nextDoc;
          nextShowIsRestream = nextSlot.broadcastType === 'restream';
          break;
        }
      } catch (err) {
        console.error('[complete-slot] Error finding next show:', err);
      }
    }

    // Use a batch write to atomically complete this slot + activate the next one (if found).
    // This prevents listeners from seeing an empty "no live slot" state during transitions.
    const batch = db.batch();
    batch.update(slotRef, updateData);

    if (nextShowDoc) {
      batch.update(nextShowDoc.ref, { status: 'live' });
      console.log(`[complete-slot] Batch write: ${slotId} → ${newStatus}, ${nextShowDoc.id} → live`);
    } else {
      console.log(`[complete-slot] Batch write: ${slotId} → ${newStatus} (no next show to activate)`);
    }

    await batch.commit();
    console.log(`Slot ${slotId} marked as ${newStatus}`);

    // Clean up LiveKit resources if slot was live
    if (slot.status === 'live' && newStatus === 'completed' && livekitHost && apiKey && apiSecret) {
      // Clean up restream worker + egress if this was a restream
      if (slot.restreamWorkerId || slot.restreamIngressId) {
        // Stop the restream worker on Hetzner
        const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL;
        if (restreamWorkerUrl) {
          try {
            await fetch(`${restreamWorkerUrl}/stop`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.CRON_SECRET}`,
              },
              body: JSON.stringify({ slotId }),
            });
            console.log(`[complete-slot] Stopped restream worker for slot ${slotId}`);
          } catch (e) {
            console.log(`[complete-slot] Could not stop restream worker: ${e}`);
          }
        }
      }
      if (slot.restreamEgressId) {
        try {
          const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);
          await egressClient.stopEgress(slot.restreamEgressId);
          console.log(`[complete-slot] Stopped restream egress ${slot.restreamEgressId}`);
        } catch (e) {
          console.log(`[complete-slot] Could not stop restream egress: ${e}`);
        }
      }

      // Remove participant from LiveKit (DJ or restream bot)
      const identity = (slot.restreamWorkerId || slot.restreamIngressId)
        ? `restream-${slotId}`
        : (slot.liveDjUsername || slot.liveDjUserId);
      if (identity) {
        try {
          const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
          await roomService.removeParticipant(ROOM_NAME, identity);
          console.log(`[complete-slot] Removed ${identity} from LiveKit room`);
        } catch (e) {
          // Participant may have already disconnected — that's fine
          console.log(`[complete-slot] Could not remove ${identity}: ${e}`);
        }
      }
    }

    // For restreams, fire off the start-restream call after the batch committed.
    // The slot is already marked 'live' in Firestore, so listeners see continuity.
    if (nextShowDoc && nextShowIsRestream) {
      console.log(`[complete-slot] Starting restream for ${nextShowDoc.id}`);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const cronSecret = process.env.CRON_SECRET || '';
      fetch(`${appUrl}/api/broadcast/start-restream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ slotId: nextShowDoc.id }),
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          console.log(`[complete-slot] Restream ${nextShowDoc!.id} started: ingress=${data.ingressId}`);
        } else {
          console.error(`[complete-slot] Restream ${nextShowDoc!.id} failed:`, data.error);
        }
      }).catch((err) => {
        console.error(`[complete-slot] Restream fetch failed:`, err);
      });
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Error completing slot:', error);
    return NextResponse.json({ error: 'Failed to complete slot' }, { status: 500 });
  }
}
