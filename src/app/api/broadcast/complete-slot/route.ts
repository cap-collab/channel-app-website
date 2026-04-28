import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot, Recording, ROOM_NAME } from '@/types/broadcast';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { cleanupSlotLiveKit } from '@/lib/livekit-cleanup';

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

    // Get the slot — try broadcast-slots first, then studio-sessions
    let slotRef = db.collection('broadcast-slots').doc(slotId);
    let slotDoc = await slotRef.get();
    let isRecordingSession = false;

    if (!slotDoc.exists) {
      slotRef = db.collection('studio-sessions').doc(slotId);
      slotDoc = await slotRef.get();
      isRecordingSession = slotDoc.exists;
    }

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

    // Determine final status based on current status and timing.
    // NEAR_END_GRACE_MS: ending within this window of slot.endTime is treated
    // as "wrapping up" — newStatus = completed so the handoff to the next
    // show fires. Beyond it, force-ends are treated as "taking a break, may
    // resume" — newStatus = paused so the slot can be resumed without a
    // next-show takeover.
    const NEAR_END_GRACE_MS = 2 * 60_000;
    let newStatus: 'completed' | 'missed' | 'paused';

    if (slot.status === 'live' || slot.status === 'paused') {
      if (force && now < endTime - NEAR_END_GRACE_MS) {
        // Ended well before slot.endTime — preserve resume affordance.
        newStatus = 'paused';
      } else {
        // Either slot.endTime has passed, or we're within the near-end
        // grace window. Either way, hand off to the next show.
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
    // Near-future restream (startTime in the future, within a small window):
    // set when the outgoing slot ended early and there's no in-window next.
    // We hand this off to the worker's /schedule endpoint so it fires at
    // startTime without waiting for the 5-min cron.
    let nearFutureRestreamDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    if (newStatus === 'completed' && !isRecordingSession) {
      try {
        const nextShowSnapshot = await db
          .collection('broadcast-slots')
          .where('status', '==', 'scheduled')
          .get();

        let soonestFutureRestream: { doc: FirebaseFirestore.QueryDocumentSnapshot; startTime: number } | null = null;
        const NEAR_FUTURE_WINDOW_MS = 10 * 60 * 1000; // 10 min

        for (const nextDoc of nextShowSnapshot.docs) {
          const nextSlot = nextDoc.data();
          const startTime = nextSlot.startTime?.toMillis?.() || nextSlot.startTime;
          const nextEndTime = nextSlot.endTime?.toMillis?.() || nextSlot.endTime;
          if (!startTime) continue;

          // In-window: preferred, handle as before.
          if (now >= startTime && now < nextEndTime) {
            nextShowDoc = nextDoc;
            nextShowIsRestream = nextSlot.broadcastType === 'restream';
            break;
          }

          // Near-future restream: track the soonest one starting within 10 min.
          // Live shows with a future startTime are intentionally NOT handled
          // here — live broadcasts require a DJ's browser queue, which is a
          // separate mechanism.
          if (
            nextSlot.broadcastType === 'restream'
            && startTime > now
            && startTime - now <= NEAR_FUTURE_WINDOW_MS
          ) {
            if (!soonestFutureRestream || startTime < soonestFutureRestream.startTime) {
              soonestFutureRestream = { doc: nextDoc, startTime };
            }
          }
        }

        if (!nextShowDoc && soonestFutureRestream) {
          nearFutureRestreamDoc = soonestFutureRestream.doc;
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

    // Clean up LiveKit resources if slot was live. This matches what the
    // complete-expired-slots cron does, so the room is released immediately
    // instead of waiting up to 5 minutes for the next cron tick.
    // Recording sessions live in their own LiveKit room; cleanupSlotLiveKit
    // hardcodes the shared `channel-radio` room when removing participants,
    // so running it for a recording could kick the live DJ. Recordings have
    // their own stop path at /api/recording/stop for their egress.
    if (slot.status === 'live' && newStatus === 'completed' && !isRecordingSession) {
      // Keep the HLS egress alive whenever a next show is taking over —
      // live *or* restream. Live and restream share the same R2 prefix so
      // the listener's manifest stays continuous across the transition;
      // stopping + restarting resets the playlist and strands mobile
      // listeners on the old tail. start-restream will stop this egress
      // before its own if it needs to, so there's no risk of duplicates.
      const keepHlsEgress = !!nextShowDoc;
      const cleanup = await cleanupSlotLiveKit({
        slotId,
        egressId: slot.egressId,
        recordingEgressId: slot.recordingEgressId,
        restreamEgressId: slot.restreamEgressId,
        restreamWorkerId: slot.restreamWorkerId,
        restreamIngressId: slot.restreamIngressId,
        liveDjUsername: slot.liveDjUsername,
        liveDjUserId: slot.liveDjUserId,
        keepHlsEgress,
      });
      console.log(`[complete-slot] LiveKit cleanup for ${slotId} (keepHlsEgress=${keepHlsEgress}):`, cleanup);
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
        // Handoff: we just called cleanupSlotLiveKit with keepHlsEgress:true
        // above, so the previous slot's egress is still alive and waiting to
        // be reused. Mirrors the live DJ's `reuseHlsEgress:true` pattern.
        body: JSON.stringify({ slotId: nextShowDoc.id, reuseHlsEgress: true }),
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

    // Near-future restream handoff: the outgoing slot ended early and the
    // next slot is a restream whose startTime hasn't arrived yet. Ask the
    // worker to hold a setTimeout until startTime, at which point it
    // re-POSTs start-restream. Without this, the restream waits up to ~5
    // minutes for the complete-expired-slots cron to pick it up. Only
    // fires for restreams — live early-ends are handled by the DJ queue.
    if (!nextShowDoc && nearFutureRestreamDoc) {
      const nearSlot = nearFutureRestreamDoc.data();
      const nearStart = nearSlot.startTime?.toMillis?.() || nearSlot.startTime;
      console.log(`[complete-slot] Scheduling near-future restream ${nearFutureRestreamDoc.id} for ${new Date(nearStart).toISOString()}`);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
      const cronSecret = process.env.CRON_SECRET || '';
      fetch(`${appUrl}/api/broadcast/start-restream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({ slotId: nearFutureRestreamDoc.id, scheduleMode: true }),
      }).then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          console.log(`[complete-slot] Restream ${nearFutureRestreamDoc!.id} scheduled for ${new Date(data.startTime).toISOString()}`);
        } else {
          console.error(`[complete-slot] Restream ${nearFutureRestreamDoc!.id} schedule failed:`, data.error);
        }
      }).catch((err) => {
        console.error(`[complete-slot] Restream schedule fetch failed:`, err);
      });
    }

    // Clean up HLS segments from R2.
    //  - If no next show is taking over → delete everything (manifests + segments).
    //  - If next show IS coming → delete only .ts segments older than 30s.
    //    HLS live playlist window is ~5 × 6s segments = 30s. Anything older is
    //    already out of the manifest and safe to delete.
    //    Keeps recent segments and manifests themselves intact so the next DJ's
    //    egress can keep writing without disruption.
    //    Prevents multi-hour sessions from accumulating 1000s of dead segments
    //    which degrade egress performance and cause audio dropouts.
    // Recording sessions don't use the channel-radio HLS prefix, so skip the
    // R2 sweep — it targets ROOM_NAME (channel-radio) and would delete the
    // live show's segments out from under listeners.
    if (newStatus === 'completed' && !isRecordingSession) {
      try {
        const r2AccountId = process.env.R2_ACCOUNT_ID?.replace(/\\n/g, '').trim() || '';
        const r2AccessKey = process.env.R2_ACCESS_KEY_ID?.replace(/\\n/g, '').trim() || '';
        const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/\\n/g, '').trim() || '';
        const r2Bucket = process.env.R2_BUCKET_NAME?.replace(/\\n/g, '').trim() || '';

        if (r2AccountId && r2AccessKey && r2SecretKey && r2Bucket) {
          const s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey },
          });

          const hasNextShow = !!nextShowDoc;
          const cutoffMs = Date.now() - 30_000; // 30s — outside HLS playlist window
          const prefix = `${ROOM_NAME}/`;
          const allKeys: string[] = [];
          let continuationToken: string | undefined;
          do {
            const res = await s3.send(new ListObjectsV2Command({
              Bucket: r2Bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuationToken,
            }));
            for (const o of (res.Contents || [])) {
              const key = o.Key!;
              const isSegment = key.endsWith('.ts');
              const isManifest = key.endsWith('.m3u8') || key.endsWith('.json');
              if (!isSegment && !isManifest) continue;

              if (hasNextShow) {
                // Mid-session: only delete old .ts segments. Never touch manifests
                // (LiveKit is rewriting them) or recent segments (still in playlist).
                if (!isSegment) continue;
                const modified = o.LastModified?.getTime() ?? Date.now();
                if (modified > cutoffMs) continue;
              }
              allKeys.push(key);
            }
            continuationToken = res.NextContinuationToken;
          } while (continuationToken);

          if (allKeys.length > 0) {
            for (let i = 0; i < allKeys.length; i += 1000) {
              const batch = allKeys.slice(i, i + 1000);
              await s3.send(new DeleteObjectsCommand({
                Bucket: r2Bucket, Delete: { Objects: batch.map(Key => ({ Key })) },
              }));
            }
            console.log(`[complete-slot] Cleaned ${allKeys.length} HLS files from R2 (${prefix}) — hasNextShow=${hasNextShow}`);
          }
        }
      } catch (cleanupErr) {
        // Non-fatal — don't fail the slot completion
        console.error('[complete-slot] R2 cleanup error (non-fatal):', cleanupErr);
      }
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Error completing slot:', error);
    return NextResponse.json({ error: 'Failed to complete slot' }, { status: 500 });
  }
}
