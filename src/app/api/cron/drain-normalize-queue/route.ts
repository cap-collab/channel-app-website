import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 800; // up to ~13 min — single normalize takes 5-8

// Quiet-window rule (per Cap 2026-06-02): only normalize when NO live show is
// currently running AND no show is starting in the next 45 minutes. The
// restream-worker + LiveKit (ingress/egress/livekit-server) share a 4-CPU VPS,
// so normalize at 100% of 1 CPU still leaves 3 CPUs for broadcast traffic —
// but the 45-min buffer means a normalize that starts now finishes well
// before the next DJ goes live.
const PRE_LIVE_BUFFER_MIN = 45;

// Process at most one queue entry per tick. Worker is single-threaded for the
// ffmpeg ops; running two normalizes concurrently doubles CPU load.
const MAX_PER_TICK = 1;

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

interface QueueEntry {
  id: string;
  r2Key: string;
  slotId?: string;
  queuedAt: number;
  status: string;
  attempts: number;
}

// True when no live broadcast is currently running AND none start in the
// next PRE_LIVE_BUFFER_MIN window. Returns a reason when busy.
async function isWorkerQuiet(
  db: FirebaseFirestore.Firestore,
  nowMs: number,
): Promise<{ quiet: boolean; reason?: string }> {
  const horizonMs = nowMs + PRE_LIVE_BUFFER_MIN * 60 * 1000;

  // Any slot whose endTime is in the future AND startTime is in the past =
  // currently live. Any slot whose startTime is in [now, horizonMs] = starting
  // soon. One query covers both: slots with startTime <= horizon AND endTime >= now.
  const snap = await db.collection('broadcast-slots')
    .where('endTime', '>=', Timestamp.fromMillis(nowMs))
    .where('endTime', '<=', Timestamp.fromMillis(horizonMs + 4 * 60 * 60 * 1000))
    .get();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.status !== 'scheduled' && d.status !== 'live') continue;
    const startMs = (d.startTime as Timestamp).toMillis();
    if (startMs <= horizonMs) {
      const minsUntilStart = Math.round((startMs - nowMs) / 60000);
      return {
        quiet: false,
        reason: minsUntilStart <= 0
          ? `slot ${doc.id} is currently live`
          : `slot ${doc.id} starts in ${minsUntilStart} min`,
      };
    }
  }

  return { quiet: true };
}

async function callWorkerNormalize(r2Key: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}> {
  const workerUrl = process.env.RESTREAM_WORKER_URL;
  const secret = process.env.CRON_SECRET;
  if (!workerUrl || !secret) {
    return { ok: false, status: 0, body: { error: 'Worker URL or secret missing' } };
  }
  const res = await fetch(`${workerUrl}/normalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ r2Key }),
  });
  let body: Record<string, unknown>;
  try { body = await res.json(); } catch { body = { error: 'invalid json' }; }
  return { ok: res.ok, status: res.status, body };
}

// Update slot + archive docs to point at the normalized URL. Preserves original
// in previousRecordingUrl (only set if not already present), and the untrimmed
// v2 in untrimmedRecordingUrl when a trim happened.
async function applyNormalizeResult(
  db: FirebaseFirestore.Firestore,
  slotId: string | undefined,
  result: Record<string, unknown>,
): Promise<void> {
  const v2Url = result.newUrl as string | undefined;
  const trimmedUrl = result.trimmedUrl as string | undefined | null;
  const durationSec = result.durationSec as number | undefined;
  const trimmedDurationSec = result.trimmedDurationSec as number | undefined | null;
  if (!v2Url) return;

  const activeUrl = trimmedUrl || v2Url;
  const activeDuration = trimmedUrl ? trimmedDurationSec : durationSec;

  if (slotId) {
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();
    if (slotDoc.exists) {
      const d = slotDoc.data()!;
      const update: Record<string, unknown> = {
        recordingUrl: activeUrl,
        normalizedAt: new Date(),
      };
      if (!d.previousRecordingUrl) update.previousRecordingUrl = d.recordingUrl;
      if (trimmedUrl) update.untrimmedRecordingUrl = v2Url;
      if (typeof activeDuration === 'number' && activeDuration > 0) {
        update.duration = Math.round(activeDuration);
      }
      await slotRef.update(update);
    }

    // Archive doc (may or may not exist yet) — webhook creates it inline after
    // the queue write, so usually present by the time the drain fires.
    const archivesSnap = await db.collection('archives')
      .where('broadcastSlotId', '==', slotId)
      .limit(1)
      .get();
    if (!archivesSnap.empty) {
      const archRef = archivesSnap.docs[0].ref;
      const d = archivesSnap.docs[0].data();
      const update: Record<string, unknown> = {
        recordingUrl: activeUrl,
        normalizedAt: Date.now(),
      };
      if (!d.previousRecordingUrl) update.previousRecordingUrl = d.recordingUrl;
      if (trimmedUrl) update.untrimmedRecordingUrl = v2Url;
      if (typeof activeDuration === 'number' && activeDuration > 0) {
        update.duration = Math.round(activeDuration);
      }
      await archRef.update(update);
    }
  }
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return await runDrain();
  } catch (err) {
    console.error('[drain-normalize-queue] uncaught error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function runDrain() {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const nowMs = Date.now();
  const quiet = await isWorkerQuiet(db, nowMs);
  if (!quiet.quiet) {
    return NextResponse.json({ skipped: 'busy', reason: quiet.reason });
  }

  // Pull oldest pending entry. Process MAX_PER_TICK = 1 per call.
  const snap = await db.collection('normalize-queue')
    .where('status', '==', 'pending')
    .orderBy('queuedAt', 'asc')
    .limit(MAX_PER_TICK)
    .get();
  if (snap.empty) {
    return NextResponse.json({ skipped: 'empty' });
  }

  const entry: QueueEntry = {
    id: snap.docs[0].id,
    ...(snap.docs[0].data() as Omit<QueueEntry, 'id'>),
  };
  const entryRef = snap.docs[0].ref;

  // Claim before calling the worker, so a re-trigger of the cron during a long
  // normalize doesn't fire a second concurrent worker call on the same entry.
  await entryRef.update({ status: 'in-progress', startedAt: Date.now() });

  console.log(`[drain-normalize-queue] Processing ${entry.r2Key} (slot=${entry.slotId || 'n/a'}, attempt ${entry.attempts + 1})`);
  const result = await callWorkerNormalize(entry.r2Key);

  // Worker error — retry up to 5x, then mark failed (manual fix needed).
  if (!result.ok) {
    const newAttempts = (entry.attempts || 0) + 1;
    const isExhausted = newAttempts >= 5;
    await entryRef.update({
      status: isExhausted ? 'failed' : 'pending',
      attempts: newAttempts,
      lastError: `worker ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`,
      lastAttemptAt: Date.now(),
    });
    console.error(`[drain-normalize-queue] Worker error for ${entry.r2Key}:`, result.body);
    return NextResponse.json({
      processed: 1, ok: false, r2Key: entry.r2Key,
      status: isExhausted ? 'failed' : 'pending-retry',
      attempts: newAttempts,
    });
  }

  // Already-in-target-band skip — no swap needed.
  if (result.body.skipped) {
    await entryRef.update({ status: 'done', doneAt: Date.now(), reason: result.body.reason });
    console.log(`[drain-normalize-queue] Skipped (already in target): ${entry.r2Key}`);
    return NextResponse.json({ processed: 1, ok: true, r2Key: entry.r2Key, action: 'skipped' });
  }

  // Success: swap URL/duration on slot + archive docs.
  try {
    await applyNormalizeResult(db, entry.slotId, result.body);
  } catch (err) {
    console.error(`[drain-normalize-queue] Apply-result failed for ${entry.r2Key}:`, err);
    // Don't fail the tick — v2 is in R2; admin can re-apply later.
  }
  await entryRef.update({
    status: 'done',
    doneAt: Date.now(),
    newUrl: result.body.newUrl ?? null,
    trimmedUrl: result.body.trimmedUrl ?? null,
  });
  console.log(`[drain-normalize-queue] Done: ${entry.r2Key} → ${result.body.trimmedUrl || result.body.newUrl}`);
  return NextResponse.json({
    processed: 1, ok: true, r2Key: entry.r2Key,
    action: result.body.trimmedUrl ? 'normalized-trimmed' : 'normalized',
  });
}
