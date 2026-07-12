import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { normalizeTrackIds } from '@/lib/track-ids';
import { sendTrackIdsEmailForArchive } from '@/lib/archive-track-ids-email';

// Small queue drain (only archives flagged 'pending' since the last run), so
// this never approaches the budget — but give headroom.
export const maxDuration = 120;

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Indexed pending-only query — never a full-collection scan.
  const pendingSnap = await db
    .collection('archives')
    .where('trackIdsReadyEmailStatus', '==', 'pending')
    .get();

  // Preload collectives → slug→owners[] for collective-archive owner resolution.
  // Built once per run and passed to the shared send helper for every archive.
  const collectivesSnap = await db.collection('collectives').get();
  const slugToOwners = new Map<string, string[]>();
  for (const doc of collectivesSnap.docs) {
    const d = doc.data();
    if (d.slug && Array.isArray(d.owners)) slugToOwners.set(String(d.slug), d.owners.map(String));
  }

  const result = { pending: pendingSnap.size, sent: 0, skipped: 0, errors: [] as string[], dryRun,
    wouldSend: [] as { id: string; tracks: number }[] };

  for (const doc of pendingSnap.docs) {
    const a = doc.data();

    if (dryRun) {
      // Preview only — don't send, don't stamp. Report what has sendable tracks.
      const tracks = normalizeTrackIds(a.trackIds);
      if (tracks.length > 0 && a.priority !== 'hidden') {
        result.wouldSend.push({ id: doc.id, tracks: tracks.length });
      } else {
        result.skipped++;
      }
      continue;
    }

    // Real send via the SAME helper the metadata route uses on click, so the
    // two paths can never drift. 'sent'/'skipped' → stamp 'sent' (skipped means
    // ineligible, and we don't want it re-queued forever). 'failed' → leave
    // 'pending' to retry next run.
    const outcome = await sendTrackIdsEmailForArchive(
      db,
      { id: doc.id, data: a },
      { slugToOwners },
    );
    if (outcome.status === 'sent') {
      result.sent += outcome.sentCount;
      await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
    } else if (outcome.status === 'skipped') {
      result.skipped++;
      if (outcome.reason) result.errors.push(`${doc.id}: ${outcome.reason}`);
      await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
    } else {
      result.errors.push(`${doc.id}: ${outcome.reason || 'send failed'}`);
    }
  }

  if (!dryRun) {
    await db.collection('system').doc('archive-track-ids-emails-status').set({
      lastRunAt: Date.now(), ...result,
    });
  }

  return NextResponse.json(result);
}
