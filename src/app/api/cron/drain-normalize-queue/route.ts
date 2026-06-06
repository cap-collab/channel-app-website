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

// Process up to this many entries per cron tick (sequential, NOT concurrent —
// worker is single-threaded for ffmpeg). Each normalize takes ~5-8 min, so 3
// sits comfortably inside Vercel's 800s maxDuration with safety margin. The
// quiet-window check is re-run between each, so if a live show pops up mid-
// drain we stop early.
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

// Hard ceiling on a single worker call. Legitimate normalizes take
// ~30-60s for an hour-long show; anything past 8 min indicates a stuck
// worker (Redis down, ffmpeg hang, etc). Without this, a hung fetch
// kills the whole Vercel lambda mid-await — the cleanup code below
// never runs and the queue entry stays in-progress forever.
const WORKER_CALL_TIMEOUT_MS = 8 * 60 * 1000;

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WORKER_CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl}/normalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ r2Key }),
      signal: ctrl.signal,
    });
    let body: Record<string, unknown>;
    try { body = await res.json(); } catch { body = { error: 'invalid json' }; }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    return {
      ok: false,
      status: 0,
      body: {
        error: aborted ? `worker timeout after ${WORKER_CALL_TIMEOUT_MS / 1000}s` : `fetch failed: ${(e as Error).message}`,
      },
    };
  } finally {
    clearTimeout(timer);
  }
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

// Process the oldest pending queue entry. Returns the outcome, or null if the
// queue is empty. The quiet-window check is done OUTSIDE this function so the
// caller can re-check between entries in a multi-entry drain.
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

  // Claim before calling the worker so a re-trigger of the cron during a long
  // normalize doesn't fire a second concurrent worker call on the same entry.
  await entryRef.update({ status: 'in-progress', startedAt: Date.now() });

  console.log(`[drain-normalize-queue] Processing ${entry.r2Key} (slot=${entry.slotId || 'n/a'}, attempt ${entry.attempts + 1})`);
  const result = await callWorkerNormalize(entry.r2Key);

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
    return {
      r2Key: entry.r2Key,
      action: isExhausted ? 'failed' : 'pending-retry',
      attempts: newAttempts,
    };
  }

  if (result.body.skipped) {
    await entryRef.update({ status: 'done', doneAt: Date.now(), reason: result.body.reason });
    console.log(`[drain-normalize-queue] Skipped (already in target): ${entry.r2Key}`);
    return { r2Key: entry.r2Key, action: 'skipped' };
  }

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
  return {
    r2Key: entry.r2Key,
    action: result.body.trimmedUrl ? 'normalized-trimmed' : 'normalized',
  };
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
