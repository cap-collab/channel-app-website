import { NextRequest, NextResponse } from 'next/server';
import { EgressClient } from 'livekit-server-sdk';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Fully-backend processing of the parallel track-composite recording
// (the dual-recording experiment). This runs OFF the LiveKit webhook on purpose:
// the webhook is serialized and jamming it caused the 2026-06-18 handoff silence,
// so nothing about the track recording touches it. This cron discovers finished
// track egresses, then hands the file to the existing faststart-queue drain,
// which faststarts it and attaches `trackRecordingUrl` to the slot + archive.
//
// It NEVER touches the primary room recording, recordingUrl, the live stream, or
// the existing webhook. Everything here is additive and best-effort.

const livekitHost = process.env.LIVEKIT_URL?.replace('wss://', 'https://') || '';
const apiKey = process.env.LIVEKIT_API_KEY || '';
const apiSecret = process.env.LIVEKIT_API_SECRET || '';
const r2PublicUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// LiveKit egress status: 3 = EGRESS_COMPLETE (see livekit protocol). Anything
// below (0 starting, 1 active, 2 ending) means the file isn't final yet.
const EGRESS_COMPLETE = 3;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    if (!livekitHost || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'LiveKit not configured' }, { status: 500 });
    }
    const egressClient = new EgressClient(livekitHost, apiKey, apiSecret);

    // Candidates: slots not yet handed off (trackRecordingQueued unset) that
    // recently ran. We filter in-memory for a track egress + no attach yet —
    // avoids a Firestore inequality index on secondRecordingEgressId and keeps
    // the query cheap (recent slots only). A slot is handled once, then
    // trackRecordingQueued short-circuits it forever.
    const lookbackMs = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await db.collection('broadcast-slots')
      .where('status', 'in', ['live', 'completed'])
      .get();

    const results: Array<{ slotId: string; egressId: string; action: string }> = [];

    for (const doc of snap.docs) {
      const slot = doc.data();
      const egressId = slot.secondRecordingEgressId as string | undefined;
      if (!egressId) continue;               // no track recording on this slot
      if (slot.trackRecordingUrl) continue;  // already attached
      if (slot.trackRecordingQueued) continue; // already handed to faststart
      // Skip ancient slots (their egress is long gone from LiveKit anyway).
      const startMs = slot.startTime?.toMillis?.() ?? Number(slot.startTime?._seconds || 0) * 1000;
      if (startMs && startMs < lookbackMs) continue;

      // Ask LiveKit for this egress's status + file result.
      let info;
      try {
        const list = await egressClient.listEgress({ egressId });
        info = list[0];
      } catch (e) {
        results.push({ slotId: doc.id, egressId, action: `lookup-failed: ${(e as Error).message}` });
        continue;
      }
      if (!info) {
        // Egress unknown to LiveKit (e.g. rotated out) — mark so we stop retrying.
        await doc.ref.update({ trackRecordingQueued: true, trackRecordingNote: 'egress not found' });
        results.push({ slotId: doc.id, egressId, action: 'egress-not-found' });
        continue;
      }
      if (info.status !== EGRESS_COMPLETE) {
        // Still recording / finalizing — try again next tick.
        results.push({ slotId: doc.id, egressId, action: `not-complete (status ${info.status})` });
        continue;
      }

      const fileResults = info.fileResults || [];
      const mp4 = fileResults.find((f) => f.filename?.endsWith('.mp4'));
      if (!mp4?.filename) {
        // Complete but no file (aborted/empty egress) — stop retrying.
        await doc.ref.update({ trackRecordingQueued: true, trackRecordingNote: 'no file (empty/aborted egress)' });
        results.push({ slotId: doc.id, egressId, action: 'no-file' });
        continue;
      }

      const trackRecordingUrl = `${r2PublicUrl}/${mp4.filename}`;
      // Hand off to the existing faststart drain (skipNormalize) — it faststarts
      // the file and attaches trackRecordingUrl to slot + archive (Option B: the
      // drain owns the attach). Dedup by r2Key so a re-run can't double-enqueue.
      const existing = await db.collection('faststart-queue').where('r2Key', '==', mp4.filename).limit(1).get();
      if (existing.empty) {
        await db.collection('faststart-queue').add({
          r2Key: mp4.filename,
          slotId: doc.id,
          kind: 'track-composite',
          skipNormalize: true,
          trackRecordingUrl,
          durationSec: mp4.duration ? Math.round(Number(mp4.duration) / 1_000_000_000) : null,
          queuedAt: Date.now(),
          status: 'pending',
          attempts: 0,
        });
      }
      await doc.ref.update({ trackRecordingQueued: true });
      results.push({ slotId: doc.id, egressId, action: 'queued-for-faststart' });
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    console.error('[process-track-recordings] uncaught error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
