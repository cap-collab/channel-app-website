import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// POST - Callback from the restream worker's /normalize endpoint.
// Called after the worker finishes measuring/boosting an uploaded archive,
// so we can swap archives/<id>.recordingUrl to the normalized URL without
// depending on Vercel keeping a fetch handle alive through the worker job.
//
// Auth: shared CRON_SECRET bearer token (same mechanism the app uses when
// calling the worker, reversed). Worker identifies the archive via
// callbackContext.archiveId, set by /api/recording/upload/complete.
//
// Shape of incoming payload (from restream-worker/index.js /normalize):
//   success case:  { success, skipped: false, newUrl, gainDb, measurements, callbackContext }
//   skipped case:  { skipped: true, reason, measurements, callbackContext }
//   error case:    { error, callbackContext }
export async function POST(request: NextRequest) {
  // Auth
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
    gainDb?: number;
    callbackContext?: { archiveId?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const archiveId = body.callbackContext?.archiveId;
  if (!archiveId) {
    return NextResponse.json({ error: 'callbackContext.archiveId required' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const archiveRef = db.collection('archives').doc(archiveId);
  const archiveDoc = await archiveRef.get();
  if (!archiveDoc.exists) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
  }

  // Error or skipped — log only, leave recordingUrl pointing at the original upload.
  if (body.error) {
    console.error(`[normalize-callback] Worker error for archive ${archiveId}:`, body.error);
    return NextResponse.json({ ok: true, action: 'none' });
  }
  if (body.skipped) {
    console.log(`[normalize-callback] Skipped for archive ${archiveId}: ${body.reason}`);
    return NextResponse.json({ ok: true, action: 'none' });
  }

  if (!body.newUrl) {
    console.warn(`[normalize-callback] Missing newUrl in success payload for ${archiveId}`);
    return NextResponse.json({ error: 'newUrl missing' }, { status: 400 });
  }

  // Swap: preserve the original URL for one-click rollback, swap the active URL.
  // The original R2 object is NEVER deleted by the worker (a new "...-normalized-v1.<ext>"
  // sibling is written), so setting recordingUrl back to previousRecordingUrl is
  // the only step needed to revert.
  //
  // If the Firestore update throws, we log and still return ok: the original
  // upload's recordingUrl is untouched so the archive remains fully playable
  // with the un-normalized audio. The normalized R2 object exists as an
  // orphan in this case — a future admin job can reconcile, but listeners
  // are never broken by a failed swap.
  const originalUrl = archiveDoc.data()?.recordingUrl;
  try {
    await archiveRef.update({
      previousRecordingUrl: originalUrl,
      recordingUrl: body.newUrl,
      normalizedAt: Date.now(),
      normalizedGainDb: body.gainDb ?? null,
    });
  } catch (err) {
    console.error(`[normalize-callback] Firestore swap failed for ${archiveId}; archive keeps original URL. Orphan normalized file: ${body.newUrl}`, err);
    return NextResponse.json({ ok: true, action: 'none', warning: 'swap failed, original URL preserved' });
  }
  console.log(`[normalize-callback] Archive ${archiveId}: +${body.gainDb}dB → ${body.newUrl}`);

  return NextResponse.json({ ok: true, action: 'swapped' });
}
