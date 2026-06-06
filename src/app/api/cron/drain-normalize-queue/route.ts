import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
// Async enqueue: the cron only enqueues; the worker calls back when done.
// Each tick is now sub-second, so no maxDuration override is needed.

// Quiet-window rule (per Cap 2026-06-02): only normalize when NO live show is
// currently running AND no show is starting in the next 45 minutes. The
// restream-worker + LiveKit (ingress/egress/livekit-server) share a 4-CPU VPS,
// so normalize at 100% of 1 CPU still leaves 3 CPUs for broadcast traffic —
// but the 45-min buffer means a normalize that starts now finishes well
// before the next DJ goes live.
const PRE_LIVE_BUFFER_MIN = 45;

// Enqueue at most this many entries per tick. Worker is single-threaded for
// ffmpeg — beyond 1 it'll just queue internally. We enqueue a few so we don't
// have to wait until the next cron tick to fill the worker's pipeline.
const MAX_PER_TICK = 3;

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

// Short timeout for the ENQUEUE call. The worker now runs in async mode:
// it returns 202 within milliseconds and POSTs the result to our callback
// endpoint when done. This call shouldn't take more than a few seconds.
const WORKER_ENQUEUE_TIMEOUT_MS = 15 * 1000;

// Async-callback enqueue. POSTs { r2Key, callbackUrl, callbackContext } to
// the worker; the worker returns 202 immediately and does the normalize in
// the background, then POSTs the result to /api/recording/normalize-queue-callback.
// Decouples the worker's wall-clock from Vercel's lambda lifetime — Vercel
// can't kill the connection mid-normalize because the connection is closed
// within seconds.
async function enqueueWorkerNormalize(
  r2Key: string,
  queueId: string,
  slotId: string | undefined,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const workerUrl = process.env.RESTREAM_WORKER_URL;
  const secret = process.env.CRON_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
  if (!workerUrl || !secret) {
    return { ok: false, status: 0, body: { error: 'Worker URL or secret missing' } };
  }
  if (!appUrl) {
    return { ok: false, status: 0, body: { error: 'APP_URL not configured (needed for callback)' } };
  }
  const callbackUrl = `${appUrl.replace(/\/$/, '')}/api/recording/normalize-queue-callback`;
  const callbackContext = { queueId, slotId };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WORKER_ENQUEUE_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl}/normalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ r2Key, callbackUrl, callbackContext }),
      signal: ctrl.signal,
    });
    let body: Record<string, unknown>;
    try { body = await res.json(); } catch { body = { error: 'invalid json' }; }
    // Worker returns 202 in async mode; treat that as success.
    return { ok: res.ok || res.status === 202, status: res.status, body };
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    return {
      ok: false,
      status: 0,
      body: {
        error: aborted ? `worker enqueue timeout after ${WORKER_ENQUEUE_TIMEOUT_MS / 1000}s` : `fetch failed: ${(e as Error).message}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// Update slot + archive docs to point at the normalized URL. Preserves original
// in previousRecordingUrl (only set if not already present), and the untrimmed
// v2 in untrimmedRecordingUrl when a trim happened.
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

interface DrainOutcome {
  r2Key: string;
  action: 'normalized' | 'normalized-trimmed' | 'skipped' | 'failed' | 'pending-retry';
  attempts?: number;
}

// If a previous tick's worker call hung past the WORKER_CALL_TIMEOUT_MS
// safety net OR before that safety net existed, the queue entry stays
// `in-progress` forever. Re-queue any in-progress entry that hasn't
// finished after STALE_IN_PROGRESS_MS so the next tick retries it.
const STALE_IN_PROGRESS_MS = 30 * 60 * 1000;

async function recoverStaleInProgress(db: FirebaseFirestore.Firestore): Promise<number> {
  const snap = await db.collection('normalize-queue')
    .where('status', '==', 'in-progress')
    .get();
  const cutoff = Date.now() - STALE_IN_PROGRESS_MS;
  let recovered = 0;
  for (const doc of snap.docs) {
    const startedAt = Number(doc.data().startedAt || 0);
    if (startedAt > 0 && startedAt < cutoff) {
      await doc.ref.update({
        status: 'pending',
        lastError: `recovered from stale in-progress (startedAt ${new Date(startedAt).toISOString()})`,
        lastAttemptAt: Date.now(),
      });
      recovered++;
      console.log(`[drain-normalize-queue] Recovered stale in-progress: ${doc.id}`);
    }
  }
  return recovered;
}

// Enqueue the oldest pending queue entry with the worker (async mode).
// Worker returns 202 within milliseconds; the actual normalize runs in the
// background and the result lands on /api/recording/normalize-queue-callback
// (which marks done/failed + applies the swap to slot + archive).
//
// Returns null if the queue is empty. The quiet-window check is done OUTSIDE
// so the caller can re-check between entries.
async function processOnePending(
  db: FirebaseFirestore.Firestore,
): Promise<DrainOutcome | null> {
  const snap = await db.collection('normalize-queue')
    .where('status', '==', 'pending')
    .get();
  if (snap.empty) return null;
  const sortedDocs = snap.docs.sort(
    (a, b) => Number(a.data().queuedAt || 0) - Number(b.data().queuedAt || 0),
  );
  const oldest = sortedDocs[0];
  const entry: QueueEntry = {
    id: oldest.id,
    ...(oldest.data() as Omit<QueueEntry, 'id'>),
  };
  const entryRef = oldest.ref;

  // Claim before calling the worker so a re-trigger of the cron during the
  // worker's normalize doesn't fire a second concurrent call on the same entry.
  await entryRef.update({ status: 'in-progress', startedAt: Date.now() });

  console.log(`[drain-normalize-queue] Enqueueing ${entry.r2Key} (queue=${entry.id}, slot=${entry.slotId || 'n/a'}, attempt ${entry.attempts + 1})`);
  const result = await enqueueWorkerNormalize(entry.r2Key, entry.id, entry.slotId);

  if (!result.ok) {
    const newAttempts = (entry.attempts || 0) + 1;
    const isExhausted = newAttempts >= 5;
    await entryRef.update({
      status: isExhausted ? 'failed' : 'pending',
      attempts: newAttempts,
      lastError: `enqueue ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`,
      lastAttemptAt: Date.now(),
    });
    console.error(`[drain-normalize-queue] Worker enqueue error for ${entry.r2Key}:`, result.body);
    return {
      r2Key: entry.r2Key,
      action: isExhausted ? 'failed' : 'pending-retry',
      attempts: newAttempts,
    };
  }

  // Worker accepted the job. It'll POST results to the callback when done.
  // Queue entry stays in-progress until the callback marks it done (or until
  // the stale-recovery sweep kicks in at the next drain tick if the callback
  // never arrives).
  console.log(`[drain-normalize-queue] Enqueued ${entry.r2Key} → worker is processing in background`);
  return { r2Key: entry.r2Key, action: 'normalized' };
}

async function runDrain() {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Recover any entries stuck in-progress from prior ticks (worker hangs,
  // lambda timeouts). Safe to run before the quiet-window check — it only
  // resets the status flag, doesn't call the worker.
  const recovered = await recoverStaleInProgress(db);

  // Initial quiet-window check. Even if a normalize is already running on the
  // worker (e.g. a manual call from admin), we still gate on broadcast slots —
  // the worker just queues internally if it's busy.
  const initialQuiet = await isWorkerQuiet(db, Date.now());
  if (!initialQuiet.quiet) {
    return NextResponse.json({ skipped: 'busy', reason: initialQuiet.reason, recovered });
  }

  const outcomes: DrainOutcome[] = [];
  for (let i = 0; i < MAX_PER_TICK; i++) {
    // Re-check the quiet window between entries — if a live show was just
    // scheduled or if a broadcast snuck into the 45-min horizon during our
    // last normalize, we stop here and let the next cron tick resume.
    if (i > 0) {
      const stillQuiet = await isWorkerQuiet(db, Date.now());
      if (!stillQuiet.quiet) {
        return NextResponse.json({
          processed: outcomes.length,
          outcomes,
          stopped: 'window-closed',
          reason: stillQuiet.reason,
          recovered,
        });
      }
    }
    const outcome = await processOnePending(db);
    if (!outcome) {
      // Queue empty — done.
      return NextResponse.json({
        processed: outcomes.length,
        outcomes,
        stopped: 'queue-empty',
        recovered,
      });
    }
    outcomes.push(outcome);
    // If the entry retry-failed, bail to avoid burning the tick on a stuck file.
    if (outcome.action === 'failed' || outcome.action === 'pending-retry') {
      return NextResponse.json({
        processed: outcomes.length,
        outcomes,
        stopped: 'worker-error',
        recovered,
      });
    }
  }
  // Hit MAX_PER_TICK. Next cron tick will pick up the rest.
  return NextResponse.json({
    processed: outcomes.length,
    outcomes,
    stopped: 'max-per-tick',
    recovered,
  });
}
