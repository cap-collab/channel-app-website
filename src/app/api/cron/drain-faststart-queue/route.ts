import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
// Allow a slow faststart (download + ffmpeg rewrite of a long recording) to run
// here, OFF the LiveKit webhook critical path. The webhook used to do this inline
// and `await` it before returning 200, which stalled LiveKit's serialized webhook
// sender and starved the next slot boundary's track_published (→ silent restream
// transitions). Now egress_ended just enqueues; this cron drains.
export const maxDuration = 300;

// Same quiet-window rule as drain-normalize-queue: the worker shares a 4-CPU VPS
// with LiveKit (ingress/egress/server), so only run faststart when no show is live
// and none starts within the buffer. Faststart is lighter than normalize but we
// keep the same gate for consistency and to never compete with a live boundary.
const PRE_LIVE_BUFFER_MIN = 45;

// Faststart is fast + idempotent (worker skips if moov already at front), so a few
// per tick is fine. The worker is single-threaded for ffmpeg anyway.
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
  archiveId?: string;
  queuedAt: number;
  status: string;
  attempts: number;
}

// True when no live broadcast is currently running AND none start in the next
// PRE_LIVE_BUFFER_MIN window. Mirrors drain-normalize-queue's isWorkerQuiet.
async function isWorkerQuiet(
  db: FirebaseFirestore.Firestore,
  nowMs: number,
): Promise<{ quiet: boolean; reason?: string }> {
  const horizonMs = nowMs + PRE_LIVE_BUFFER_MIN * 60 * 1000;
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

const WORKER_FASTSTART_TIMEOUT_MS = 4 * 60 * 1000;

// Call the worker's synchronous /faststart endpoint. It downloads the MP4,
// rewrites moov to front (idempotent — skips if already faststarted), and
// re-uploads to the SAME r2Key. Returns {success, skipped?}.
async function callWorkerFaststart(
  r2Key: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const workerUrl = process.env.RESTREAM_WORKER_URL;
  const secret = process.env.CRON_SECRET;
  if (!workerUrl || !secret) {
    return { ok: false, status: 0, body: { error: 'Worker URL or secret missing' } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WORKER_FASTSTART_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl}/faststart`, {
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
      body: { error: aborted ? `worker faststart timeout after ${WORKER_FASTSTART_TIMEOUT_MS / 1000}s` : `fetch failed: ${(e as Error).message}` },
    };
  } finally {
    clearTimeout(timer);
  }
}

// An R2 404 (source MP4 never written, e.g. an aborted egress segment) can never
// succeed — fail it immediately so it doesn't head-of-line-block the queue.
function isMissingSourceError(body: Record<string, unknown>): boolean {
  const msg = JSON.stringify(body).toLowerCase();
  return msg.includes('specified key does not exist') || msg.includes('nosuchkey');
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return await runDrain();
  } catch (err) {
    console.error('[drain-faststart-queue] uncaught error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface DrainOutcome {
  r2Key: string;
  action: 'faststarted' | 'failed' | 'pending-retry' | 'dead-skip';
  attempts?: number;
}

// Process the oldest pending faststart entry. On success, enqueue normalize
// (which must run AFTER faststart, since normalize re-reads the recording).
async function processOnePending(
  db: FirebaseFirestore.Firestore,
): Promise<DrainOutcome | null> {
  const snap = await db.collection('faststart-queue')
    .where('status', '==', 'pending')
    .get();
  if (snap.empty) return null;
  const sortedDocs = snap.docs.sort(
    (a, b) => Number(a.data().queuedAt || 0) - Number(b.data().queuedAt || 0),
  );
  const oldest = sortedDocs[0];
  const entry: QueueEntry = { id: oldest.id, ...(oldest.data() as Omit<QueueEntry, 'id'>) };
  const entryRef = oldest.ref;

  // Claim before calling the worker so a re-trigger doesn't double-process.
  await entryRef.update({ status: 'in-progress', startedAt: Date.now() });

  console.log(`[drain-faststart-queue] Faststarting ${entry.r2Key} (queue=${entry.id}, slot=${entry.slotId || 'n/a'}, attempt ${entry.attempts + 1})`);
  const result = await callWorkerFaststart(entry.r2Key);

  if (!result.ok) {
    const newAttempts = (entry.attempts || 0) + 1;
    const deadSource = isMissingSourceError(result.body);
    const isExhausted = deadSource || newAttempts >= 5;
    await entryRef.update({
      status: isExhausted ? 'failed' : 'pending',
      attempts: newAttempts,
      lastError: `faststart ${result.status}: ${JSON.stringify(result.body).slice(0, 500)}`,
      lastAttemptAt: Date.now(),
    });
    console.error(`[drain-faststart-queue] Faststart error for ${entry.r2Key}${deadSource ? ' (missing source — failing immediately)' : ''}:`, result.body);
    return {
      r2Key: entry.r2Key,
      action: deadSource ? 'dead-skip' : (isExhausted ? 'failed' : 'pending-retry'),
      attempts: newAttempts,
    };
  }

  // Faststart succeeded. Enqueue normalize BEFORE marking this entry done, so a
  // crash between the two writes leaves the faststart entry 'in-progress' and
  // recoverStaleInProgress re-runs it (faststart is idempotent → re-runs safely
  // and reaches the enqueue again). Marking 'done' first would orphan the
  // recording: faststart drain never revisits a done entry, and no normalize
  // entry exists for the normalize drain to pick up. (Observed 2026-06-23: the
  // old order silently dropped normalize for the "David L invites" set.)
  // Idempotency guard: if a retry already enqueued normalize for this r2Key,
  // don't add a duplicate.
  const existingNorm = await db.collection('normalize-queue')
    .where('r2Key', '==', entry.r2Key)
    .limit(1)
    .get();
  if (existingNorm.empty) {
    await db.collection('normalize-queue').add({
      r2Key: entry.r2Key,
      slotId: entry.slotId,
      archiveId: entry.archiveId,
      queuedAt: Date.now(),
      status: 'pending',
      attempts: 0,
    });
    console.log(`[drain-faststart-queue] Faststarted ${entry.r2Key} (skipped=${!!result.body.skipped}) → normalize queued`);
  } else {
    console.log(`[drain-faststart-queue] Faststarted ${entry.r2Key} — normalize already queued (${existingNorm.docs[0].id}), skipping duplicate`);
  }
  await entryRef.update({ status: 'done', finishedAt: Date.now() });
  return { r2Key: entry.r2Key, action: 'faststarted' };
}

// Re-queue entries stuck in-progress from a prior tick (worker hang / lambda kill).
const STALE_IN_PROGRESS_MS = 30 * 60 * 1000;
async function recoverStaleInProgress(db: FirebaseFirestore.Firestore): Promise<number> {
  const snap = await db.collection('faststart-queue')
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
      console.log(`[drain-faststart-queue] Recovered stale in-progress: ${doc.id}`);
    }
  }
  return recovered;
}

async function runDrain() {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const recovered = await recoverStaleInProgress(db);

  const initialQuiet = await isWorkerQuiet(db, Date.now());
  if (!initialQuiet.quiet) {
    return NextResponse.json({ skipped: 'busy', reason: initialQuiet.reason, recovered });
  }

  const outcomes: DrainOutcome[] = [];
  let processed = 0;
  const MAX_ITERATIONS = MAX_PER_TICK + 20;
  for (let i = 0; processed < MAX_PER_TICK && i < MAX_ITERATIONS; i++) {
    if (i > 0) {
      const stillQuiet = await isWorkerQuiet(db, Date.now());
      if (!stillQuiet.quiet) {
        return NextResponse.json({ processed: outcomes.length, outcomes, stopped: 'window-closed', reason: stillQuiet.reason, recovered });
      }
    }
    const outcome = await processOnePending(db);
    if (!outcome) {
      return NextResponse.json({ processed: outcomes.length, outcomes, stopped: 'queue-empty', recovered });
    }
    outcomes.push(outcome);
    if (outcome.action === 'dead-skip') continue; // doesn't burn a tick slot
    processed++;
    if (outcome.action === 'failed' || outcome.action === 'pending-retry') {
      return NextResponse.json({ processed: outcomes.length, outcomes, stopped: 'worker-error', recovered });
    }
  }
  return NextResponse.json({ processed: outcomes.length, outcomes, stopped: 'max-per-tick', recovered });
}
