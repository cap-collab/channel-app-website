import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// One-shot admin endpoint to re-trigger faststart + normalize against the
// restream worker for an existing archive. Used to recover archives whose
// egress_ended webhook timed out before kicking off post-processing.
//
// Auth: CRON_SECRET bearer (same as other admin routes here).
// POST { archiveId }
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { archiveId } = await request.json().catch(() => ({}));
  if (!archiveId || typeof archiveId !== 'string') {
    return NextResponse.json({ error: 'archiveId required' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });

  const archiveSnap = await db.collection('archives').doc(archiveId).get();
  if (!archiveSnap.exists) return NextResponse.json({ error: 'Archive not found' }, { status: 404 });

  const recordingUrl = archiveSnap.data()?.recordingUrl as string | undefined;
  if (!recordingUrl) return NextResponse.json({ error: 'Archive has no recordingUrl' }, { status: 400 });

  const r2PublicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '') || '';
  const r2Key = recordingUrl.startsWith(r2PublicUrl + '/') ? recordingUrl.slice(r2PublicUrl.length + 1) : null;
  if (!r2Key) {
    return NextResponse.json({ error: 'recordingUrl is not on R2_PUBLIC_URL', recordingUrl, r2PublicUrl }, { status: 400 });
  }

  const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!restreamWorkerUrl || !cronSecret) {
    return NextResponse.json({ error: 'Worker config missing' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  const callbackUrl = appUrl ? `${appUrl}/api/recording/normalize-callback` : null;

  const results: Record<string, unknown> = { r2Key, archiveId };

  // Fire-and-forget faststart (worker rewrites in place; no callback needed).
  fetch(`${restreamWorkerUrl}/faststart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
    body: JSON.stringify({ r2Key }),
  })
    .then(async (r) => console.log(`[replay-normalize] faststart status=${r.status} body=${await r.text().catch(() => '')}`))
    .catch((e) => console.error('[replay-normalize] faststart error:', e));
  results.faststart = 'kicked off';

  // Kick off normalize with callback — worker returns 202 immediately.
  if (!callbackUrl) {
    return NextResponse.json({ ...results, normalize: 'skipped: no callback URL' });
  }
  try {
    const normRes = await fetch(`${restreamWorkerUrl}/normalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({ r2Key, callbackUrl, callbackContext: { archiveId } }),
    });
    results.normalizeStatus = normRes.status;
    results.normalizeBody = await normRes.json().catch(() => null);
  } catch (e) {
    results.normalizeError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results);
}
