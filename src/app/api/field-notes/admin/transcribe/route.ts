import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcaster } from '@/lib/field-notes';
import { getAdminDb } from '@/lib/firebase-admin';

// POST — admin-triggered, on-demand transcription of a tape (field note).
// Broadcaster-gated. Loads the note, then enqueues the Social Render worker
// (youtube-render-worker, a SEPARATE VPS with nothing live on it) /transcribe
// job in async-callback mode: the worker returns 202 immediately and POSTs the
// transcript + captions to /api/field-notes/transcribe-callback when done.
export async function POST(request: NextRequest) {
  const access = await requireBroadcaster(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let noteId: string | undefined;
  try {
    const body = await request.json();
    noteId = body?.noteId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!noteId) {
    return NextResponse.json({ error: 'noteId required' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

  const ref = db.collection('field-notes').doc(noteId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }
  // The Social Render worker downloads audio by public URL (ffmpeg-from-URL with
  // reconnect flags), so we hand it the note's public audioUrl.
  const audioUrl = snap.data()?.audioUrl as string | undefined;
  if (!audioUrl) {
    return NextResponse.json({ error: 'Note has no audioUrl' }, { status: 400 });
  }

  // Transcription runs on the Social Render worker (youtube-render-worker) — a
  // SEPARATE VPS with nothing live on it. NEVER the restream-worker box, which
  // carries live broadcasts/restreams/normalize.
  const workerUrl = process.env.YOUTUBE_RENDER_WORKER_URL;
  const secret = process.env.CRON_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
  if (!workerUrl || !secret) {
    return NextResponse.json(
      { error: 'Transcription worker not configured (YOUTUBE_RENDER_WORKER_URL / CRON_SECRET)' },
      { status: 500 },
    );
  }
  if (!appUrl) {
    return NextResponse.json(
      { error: 'APP_URL not configured (needed for transcribe callback)' },
      { status: 500 },
    );
  }

  const callbackUrl = `${appUrl.replace(/\/$/, '')}/api/field-notes/transcribe-callback`;

  // Mark in-progress so the UI can show status and a re-click doesn't double-fire.
  await ref.update({ transcribeStatus: 'in-progress', transcribeStartedAt: Date.now() });

  try {
    const res = await fetch(`${workerUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ audioUrl, callbackUrl, callbackContext: { noteId } }),
    });
    // Worker returns 202 in async mode.
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => '');
      await ref.update({ transcribeStatus: 'failed', transcribeError: `worker ${res.status}` });
      return NextResponse.json(
        { error: `Worker enqueue failed (${res.status})`, detail: text.slice(0, 300) },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, status: 'in-progress' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref.update({ transcribeStatus: 'failed', transcribeError: msg.slice(0, 300) });
    return NextResponse.json({ error: `Worker unreachable: ${msg}` }, { status: 502 });
  }
}
