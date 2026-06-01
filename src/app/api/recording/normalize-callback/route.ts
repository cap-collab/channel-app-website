import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// POST - Callback from the restream worker's /normalize endpoint.
// Called after the worker finishes normalizing an uploaded archive, so we
// can swap archives/<id>.recordingUrl to the normalized URL without
// depending on Vercel keeping a fetch handle alive through the worker job.
//
// Auth: shared CRON_SECRET bearer token (same mechanism the app uses when
// calling the worker, reversed). Worker identifies the archive via
// callbackContext.archiveId, set by /api/recording/upload/complete.
//
// Shape of incoming payload (from restream-worker/index.js /normalize):
//   success case:  {
//     success, skipped: false,
//     newUrl,                 // v2 normalized URL (always present on success)
//     trimmedUrl,             // v2-trimmed URL if trailing silence found (else null)
//     durationSec,            // v2 (untrimmed) duration
//     trimmedDurationSec,     // v2-trimmed duration (else null)
//     measurements: { inputI, inputTP, inputLRA, outputI, outputTP, outputLRA,
//                     trailingSilenceStartSec, trailingSilenceLengthSec },
//     callbackContext,
//   }
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
    trimmedUrl?: string | null;
    durationSec?: number | null;
    trimmedDurationSec?: number | null;
    measurements?: {
      inputI?: number;
      inputTP?: number;
      outputI?: number;
      outputTP?: number;
      trailingSilenceStartSec?: number | null;
      trailingSilenceLengthSec?: number | null;
    };
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

  // Swap to the trimmed URL when available; otherwise the v2 untrimmed URL.
  // Original R2 object is NEVER deleted by the worker (sibling keys
  // "...-normalized-v2.<ext>" and "...-normalized-v2-trimmed.<ext>" are
  // written), so setting recordingUrl back to previousRecordingUrl is the
  // only step needed to revert.
  //
  // Layered URL preservation:
  //   previousRecordingUrl     — points at the ORIGINAL raw upload (only set
  //                              once; never overwritten)
  //   untrimmedRecordingUrl    — when trim happened, points at the v2
  //                              untrimmed file so the trim itself is reversible
  //                              without re-rendering
  //   recordingUrl             — what listeners actually hear (trimmed if
  //                              available, otherwise v2)
  //
  // If the Firestore update throws, we log and still return ok: the original
  // upload's recordingUrl is untouched so the archive remains fully playable.
  // The normalized R2 files exist as orphans in that case — a future admin
  // job can reconcile, but listeners are never broken by a failed swap.
  const archiveData = archiveDoc.data() || {};
  const originalUrl = archiveData.recordingUrl as string | undefined;
  const useTrimmed = !!body.trimmedUrl;
  const activeUrl = useTrimmed ? (body.trimmedUrl as string) : body.newUrl;
  const activeDuration = useTrimmed ? body.trimmedDurationSec : body.durationSec;

  const update: Record<string, unknown> = {
    recordingUrl: activeUrl,
    normalizedAt: Date.now(),
  };
  // Only set previousRecordingUrl on first normalize — preserves the true
  // original through subsequent renormalizes (v2 → v3 etc).
  if (!archiveData.previousRecordingUrl && originalUrl) {
    update.previousRecordingUrl = originalUrl;
  }
  if (useTrimmed) {
    update.untrimmedRecordingUrl = body.newUrl;
    if (body.measurements?.trailingSilenceStartSec != null) {
      update.trailingSilenceStartSec = body.measurements.trailingSilenceStartSec;
    }
    if (body.measurements?.trailingSilenceLengthSec != null) {
      update.trailingSilenceLengthSec = body.measurements.trailingSilenceLengthSec;
    }
  }
  if (typeof activeDuration === 'number' && activeDuration > 0) {
    update.duration = Math.round(activeDuration);
  }
  if (body.measurements?.outputI != null) update.normalizedOutputI = body.measurements.outputI;
  if (body.measurements?.outputTP != null) update.normalizedOutputTP = body.measurements.outputTP;

  try {
    await archiveRef.update(update);
  } catch (err) {
    console.error(`[normalize-callback] Firestore swap failed for ${archiveId}; archive keeps original URL. Orphan normalized files: ${body.newUrl}${body.trimmedUrl ? ', ' + body.trimmedUrl : ''}`, err);
    return NextResponse.json({ ok: true, action: 'none', warning: 'swap failed, original URL preserved' });
  }
  console.log(`[normalize-callback] Archive ${archiveId} → ${activeUrl}${useTrimmed ? ' (trimmed)' : ''}`);

  return NextResponse.json({ ok: true, action: useTrimmed ? 'swapped-trimmed' : 'swapped' });
}
