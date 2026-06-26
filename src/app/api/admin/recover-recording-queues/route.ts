import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// On-demand self-heal for the recording pipeline's two queues (faststart-queue →
// normalize-queue), triggered by the "Recover stuck queues" button in the admin
// Tech Health tab. The per-tick recoverStaleInProgress in each drain handles the
// common case, but it ONLY re-queues stale in-progress entries. It does NOT catch
// the failure that bit us on 2026-06-26: a faststart drain lambda that died AFTER
// the worker succeeded but BEFORE writing `done` + enqueuing normalize. This sweep
// audits BOTH queues and fixes both shapes:
//
//   1. STALE in-progress (either queue)  → reset to `pending` so the drain retries.
//   2. faststart `done` with NO normalize entry for its r2Key → enqueue normalize.
//
// GET  → dry-run report (no writes), so the UI can show what's stuck.
// POST → apply the fixes.
// After POST, hit the drains (or wait for the next cron tick) to actually process
// the reactivated entries.

const STALE_IN_PROGRESS_MS = 30 * 60 * 1000;

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return { isAdmin: role === 'admin' || role === 'broadcaster' };
  } catch {
    return { isAdmin: false };
  }
}

interface Action {
  queue: 'faststart' | 'normalize';
  id: string;
  r2Key: string;
  fix: 'reset-stale-in-progress' | 'enqueue-missing-normalize';
  detail: string;
}

// Reset any in-progress entry older than the stale cutoff back to pending.
async function resetStale(
  db: FirebaseFirestore.Firestore,
  collection: 'faststart-queue' | 'normalize-queue',
  queue: 'faststart' | 'normalize',
  cutoff: number,
  dryRun: boolean,
): Promise<Action[]> {
  const snap = await db.collection(collection).where('status', '==', 'in-progress').get();
  const actions: Action[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const startedAt = Number(data.startedAt || 0);
    if (startedAt === 0 || startedAt >= cutoff) continue;
    const ageMin = Math.round((Date.now() - startedAt) / 60000);
    actions.push({
      queue,
      id: doc.id,
      r2Key: String(data.r2Key || ''),
      fix: 'reset-stale-in-progress',
      detail: `in-progress for ${ageMin}m (startedAt ${new Date(startedAt).toISOString()})`,
    });
    if (!dryRun) {
      await doc.ref.update({
        status: 'pending',
        lastError: `recovered by recover-recording-queues (stale in-progress ${ageMin}m)`,
        lastAttemptAt: Date.now(),
      });
    }
  }
  return actions;
}

// A faststart entry marked `done` should have a matching normalize entry. If the
// drain crashed between marking done and enqueuing normalize, there'll be none —
// the recording is silently stuck un-normalized. Enqueue the missing entry.
async function recoverMissingNormalize(
  db: FirebaseFirestore.Firestore,
  dryRun: boolean,
): Promise<Action[]> {
  const done = await db.collection('faststart-queue').where('status', '==', 'done').get();
  const actions: Action[] = [];
  for (const doc of done.docs) {
    const data = doc.data();
    const r2Key = String(data.r2Key || '');
    if (!r2Key) continue;
    const existing = await db.collection('normalize-queue').where('r2Key', '==', r2Key).limit(1).get();
    if (!existing.empty) continue; // already has a normalize entry — fine
    actions.push({
      queue: 'faststart',
      id: doc.id,
      r2Key,
      fix: 'enqueue-missing-normalize',
      detail: 'faststart done but no normalize entry — enqueuing',
    });
    if (!dryRun) {
      await db.collection('normalize-queue').add({
        r2Key,
        slotId: data.slotId,
        archiveId: data.archiveId,
        queuedAt: Date.now(),
        status: 'pending',
        attempts: 0,
      });
    }
  }
  return actions;
}

export interface RecoverQueuesResult {
  dryRun: boolean;
  fixed: number;
  actions: Action[];
}

async function run(dryRun: boolean): Promise<NextResponse> {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const cutoff = Date.now() - STALE_IN_PROGRESS_MS;
  const actions: Action[] = [
    ...(await resetStale(db, 'faststart-queue', 'faststart', cutoff, dryRun)),
    ...(await resetStale(db, 'normalize-queue', 'normalize', cutoff, dryRun)),
    ...(await recoverMissingNormalize(db, dryRun)),
  ];

  if (actions.length) {
    console.log(`[recover-recording-queues] ${dryRun ? 'WOULD fix' : 'fixed'} ${actions.length} entr${actions.length === 1 ? 'y' : 'ies'}:`, JSON.stringify(actions));
  }
  const body: RecoverQueuesResult = { dryRun, fixed: actions.length, actions };
  return NextResponse.json(body);
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdminAccess(request)).isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return await run(true); // GET is always a dry-run report
  } catch (err) {
    console.error('[recover-recording-queues] uncaught error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminAccess(request)).isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return await run(false); // POST applies the fixes
  } catch (err) {
    console.error('[recover-recording-queues] uncaught error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
