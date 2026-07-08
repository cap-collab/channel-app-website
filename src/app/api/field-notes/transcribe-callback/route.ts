import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldNoteCaption } from '@/types/field-notes';

export const dynamic = 'force-dynamic';

// POST — callback from the Social Render worker's /transcribe endpoint. Writes
// the transcript + timed captions onto the field-notes doc. Auth: shared
// CRON_SECRET bearer (same mechanism the app uses calling the worker, reversed).
// The worker identifies the note via callbackContext.noteId (set by the trigger).
//
// Incoming payload (from youtube-render-worker /transcribe):
//   success: { success: true, transcript, captions: [{from,to,text}], model, durationSec, callbackContext }
//   error:   { error, callbackContext }
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
    error?: string;
    transcript?: string;
    captions?: FieldNoteCaption[];
    model?: string;
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

  // Worker reported failure — record it so the admin UI can surface + retry.
  if (!body.success || body.error) {
    await ref.update({
      transcribeStatus: 'failed',
      transcribeError: (body.error || 'unknown worker error').slice(0, 300),
    });
    console.error(`[transcribe-callback] worker failed for ${noteId}:`, body.error);
    return NextResponse.json({ ok: true, recorded: 'failed' });
  }

  const transcript = (body.transcript || '').trim();
  const captions = Array.isArray(body.captions) ? body.captions : [];

  await ref.update({
    transcript: transcript || null,
    captions: captions.length ? captions : null,
    transcribedAt: Date.now(),
    transcriptModel: body.model || null,
    transcribeStatus: 'done',
    transcribeError: null,
  });

  console.log(`[transcribe-callback] ${noteId}: ${captions.length} caption lines saved`);
  return NextResponse.json({ ok: true, recorded: 'done', lines: captions.length });
}
