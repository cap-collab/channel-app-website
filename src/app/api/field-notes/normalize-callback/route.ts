import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// POST — callback from the Social Render worker's /normalize endpoint (fired
// alongside /transcribe by the admin "Transcribe" action). Swaps the tape's
// `audioUrl` to the normalized -14 LUFS `.m4a` and preserves the original in
// `previousAudioUrl`. Auth: shared CRON_SECRET bearer (same mechanism the app
// uses calling the worker, reversed). The worker identifies the note via
// callbackContext.noteId.
//
// Incoming payload (from youtube-render-worker /normalize):
//   success:  { success: true, newUrl, durationSec, measurements, callbackContext }
//   skipped:  { skipped: true, reason, measurements, callbackContext }   (already in band)
//   error:    { error, callbackContext }
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

  let body: {
    success?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
    newUrl?: string | null;
    durationSec?: number;
    measurements?: {
      inputI?: number; inputTP?: number; inputLRA?: number;
      outputI?: number; outputTP?: number; outputLRA?: number;
    };
    callbackContext?: { noteId?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const noteId = body.callbackContext?.noteId;
  if (!noteId) {
    return NextResponse.json({ error: 'callbackContext.noteId missing' }, { status: 400 });
  }
  const ref = db.collection('field-notes').doc(noteId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  // Worker reported failure — record it so the admin UI can surface + retry.
  if (body.error) {
    await ref.update({
      normalizeStatus: 'failed',
      normalizeError: body.error.slice(0, 300),
    });
    console.error(`[fn-normalize-callback] worker failed for ${noteId}:`, body.error);
    return NextResponse.json({ ok: true, recorded: 'failed' });
  }

  const measurements = body.measurements || {};
  const normalization = {
    inputI: measurements.inputI ?? null,
    inputTP: measurements.inputTP ?? null,
    inputLRA: measurements.inputLRA ?? null,
    outputI: measurements.outputI ?? null,
    outputTP: measurements.outputTP ?? null,
    outputLRA: measurements.outputLRA ?? null,
  };

  // Already in the target band — the worker skipped re-encoding. Nothing to swap;
  // just mark done so the admin sees it was handled (and doesn't re-fire).
  if (body.skipped) {
    await ref.update({
      normalizeStatus: 'skipped',
      normalizeError: null,
      normalizedAt: Date.now(),
      normalization,
    });
    console.log(`[fn-normalize-callback] ${noteId}: skipped (${body.reason || 'in band'})`);
    return NextResponse.json({ ok: true, recorded: 'skipped' });
  }

  const newUrl = (body.newUrl || '').trim();
  if (!body.success || !newUrl) {
    await ref.update({
      normalizeStatus: 'failed',
      normalizeError: 'worker returned success without a newUrl',
    });
    return NextResponse.json({ ok: true, recorded: 'failed' });
  }

  // Swap audioUrl → normalized. Preserve the pre-normalization URL ONCE (don't
  // overwrite it if this tape is normalized again — first original wins).
  const current = snap.data() || {};
  const update: Record<string, unknown> = {
    audioUrl: newUrl,
    audioMimeType: 'audio/mp4',   // normalized output is always AAC-in-m4a
    normalizeStatus: 'done',
    normalizeError: null,
    normalizedAt: Date.now(),
    normalization,
  };
  if (!current.previousAudioUrl && current.audioUrl && current.audioUrl !== newUrl) {
    update.previousAudioUrl = current.audioUrl;
    // Stash the original mime too (e.g. video/mp4) — audioMimeType is about to be
    // clobbered to audio/mp4, and a revert needs the original to restore the
    // modal/player's video-vs-audio detection.
    if (current.audioMimeType) update.previousAudioMimeType = current.audioMimeType;
  }
  await ref.update(update);

  console.log(`[fn-normalize-callback] ${noteId}: audioUrl swapped → ${newUrl}`);
  return NextResponse.json({ ok: true, recorded: 'done' });
}
