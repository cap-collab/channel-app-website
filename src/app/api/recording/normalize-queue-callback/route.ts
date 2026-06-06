import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// POST — callback from the restream worker's /normalize endpoint, fired by
// the drain-normalize-queue cron in async mode. Worker returns 202 to the
// cron immediately, does the normalize, then POSTs the result here.
//
// This decouples the worker's wall-clock time from any single Vercel
// lambda's lifetime — the cron lambda can finish and Vercel can do
// whatever it wants with that lambda's TCP connection, because the
// result lands on a fresh request to this endpoint.
//
// Auth: same CRON_SECRET bearer the cron uses to call the worker.
//
// callbackContext shape: { queueId, slotId }
//   queueId — normalize-queue doc id
//   slotId  — broadcast-slots doc id (may be undefined for manual upload jobs)
//
// Side effects:
//   - On success/skipped: mark queue entry done, apply swap to slot + archive
//   - On error: bump attempts, mark failed after 5 (matches inline retry)
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    success?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
    newUrl?: string;
    trimmedUrl?: string | null;
    durationSec?: number | null;
    trimmedDurationSec?: number | null;
    measurements?: Record<string, number | null | undefined>;
    callbackContext?: { queueId?: string; slotId?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const queueId = body.callbackContext?.queueId;
  const slotId = body.callbackContext?.slotId;
  if (!queueId) {
    return NextResponse.json({ error: 'callbackContext.queueId required' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const queueRef = db.collection('normalize-queue').doc(queueId);
  const queueDoc = await queueRef.get();
  if (!queueDoc.exists) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 });
  }

  // Error path — bump attempts; mark failed after 5 retries (same as inline)
  if (body.error) {
    const attempts = (queueDoc.data()?.attempts || 0) + 1;
    const isExhausted = attempts >= 5;
    await queueRef.update({
      status: isExhausted ? 'failed' : 'pending',
      attempts,
      lastError: `worker error: ${String(body.error).slice(0, 300)}`,
      lastAttemptAt: Date.now(),
    });
    console.error(`[normalize-queue-callback] Worker error for queue ${queueId}: ${body.error}`);
    return NextResponse.json({ ok: true, action: isExhausted ? 'failed' : 'retry' });
  }

  // Skipped — input already in target band; mark done with reason
  if (body.skipped) {
    await queueRef.update({ status: 'done', doneAt: Date.now(), reason: body.reason || 'skipped' });
    return NextResponse.json({ ok: true, action: 'skipped' });
  }

  if (!body.newUrl) {
    await queueRef.update({
      status: 'pending',
      attempts: (queueDoc.data()?.attempts || 0) + 1,
      lastError: 'success payload missing newUrl',
      lastAttemptAt: Date.now(),
    });
    return NextResponse.json({ error: 'newUrl missing' }, { status: 400 });
  }

  // Apply swap to slot + archive doc (same logic as drain-normalize-queue's
  // applyNormalizeResult — kept duplicated for now since the cron version
  // runs synchronously inside the drain loop).
  const v2Url = body.newUrl;
  const trimmedUrl = body.trimmedUrl || null;
  const activeUrl = trimmedUrl || v2Url;
  const activeDuration = trimmedUrl ? body.trimmedDurationSec : body.durationSec;

  if (slotId) {
    try {
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

      const archivesSnap = await db.collection('archives')
        .where('broadcastSlotId', '==', slotId).limit(1).get();
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
    } catch (err) {
      console.error(`[normalize-queue-callback] Apply-swap failed for queue ${queueId}:`, err);
      // Don't fail the response — v2 is in R2 and the queue moves on. Manual
      // admin reconcile if needed.
    }
  }

  await queueRef.update({
    status: 'done',
    doneAt: Date.now(),
    newUrl: v2Url,
    trimmedUrl,
  });
  console.log(`[normalize-queue-callback] Queue ${queueId} → done · ${activeUrl}`);
  return NextResponse.json({ ok: true, action: trimmedUrl ? 'normalized-trimmed' : 'normalized' });
}
