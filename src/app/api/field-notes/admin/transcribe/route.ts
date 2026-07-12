import { NextRequest, NextResponse } from 'next/server';
import { requireBroadcaster } from '@/lib/field-notes';
import { getAdminDb } from '@/lib/firebase-admin';
import { keyFromUrl } from '@/lib/r2-backup';

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
  // /normalize takes the R2 KEY (it GetObject's it), not the public URL. The
  // tape's audioKey is stored at submit; fall back to deriving it from the URL
  // via the shared keyFromUrl helper (host-agnostic — handles a CDN base that
  // differs from R2_PUBLIC_URL, which the plain startsWith check would miss).
  const audioKey =
    (snap.data()?.audioKey as string | undefined) ||
    keyFromUrl(audioUrl, process.env.R2_PUBLIC_URL || '') ||
    undefined;

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

    // Also enqueue loudness normalization on the SAME worker (youtube-render —
    // never touches live). /normalize does a two-pass loudnorm to -14 LUFS and
    // posts back to /api/field-notes/normalize-callback, which swaps `audioUrl`
    // to the normalized `.m4a`. Fired here so "Transcribe" is the single admin
    // action that both captions AND loudness-matches a tape to the archive band.
    // Best-effort: a normalize enqueue failure must NOT fail the transcribe that
    // already succeeded — record the error on the doc and move on.
    if (audioKey) {
      const normalizeCallbackUrl = `${appUrl.replace(/\/$/, '')}/api/field-notes/normalize-callback`;
      await ref.update({ normalizeStatus: 'in-progress', normalizeError: null });
      // Bound the enqueue call — the worker returns 202 within ms in async mode,
      // so anything past a few seconds means it's stalled. Without this an admin
      // "Transcribe" click would hang until Vercel kills the lambda. (Mirrors the
      // drain cron's WORKER_ENQUEUE_TIMEOUT_MS.)
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const nres = await fetch(`${workerUrl}/normalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ r2Key: audioKey, callbackUrl: normalizeCallbackUrl, callbackContext: { noteId } }),
          signal: ctrl.signal,
        });
        if (!nres.ok && nres.status !== 202) {
          const ntext = await nres.text().catch(() => '');
          await ref.update({ normalizeStatus: 'failed', normalizeError: `worker ${nres.status}: ${ntext.slice(0, 200)}` });
        }
      } catch (ne) {
        const nmsg = ctrl.signal.aborted ? 'enqueue timeout after 15s' : (ne instanceof Error ? ne.message : String(ne));
        await ref.update({ normalizeStatus: 'failed', normalizeError: `unreachable: ${nmsg}`.slice(0, 300) });
      } finally {
        clearTimeout(timer);
      }
    } else {
      await ref.update({ normalizeStatus: 'failed', normalizeError: 'could not resolve audioKey for normalize' });
    }

    return NextResponse.json({ ok: true, status: 'in-progress' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref.update({ transcribeStatus: 'failed', transcribeError: msg.slice(0, 300) });
    return NextResponse.json({ error: `Worker unreachable: ${msg}` }, { status: 502 });
  }
}
