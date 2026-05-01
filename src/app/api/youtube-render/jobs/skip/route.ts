import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

// Skip markers live in the same `youtube-render-jobs` collection as real
// renders, with `status: 'skipped'`. The Social Render tab UI already
// drives off this collection, so a skip is just a stub doc that:
//   - blocks the archive from re-appearing in the picker (same shared
//     filter that hides queued/rendering/done jobs)
//   - shows up in the queue at the bottom (sort key) with an Unskip button
//
// Stored fields are minimal — no recordingUrl/durationSec/etc, since the
// worker never sees these docs. We carry just enough metadata for the
// queue card to render: archiveId/Slug + showName/djName for display.

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const role = userDoc.data()?.role;
    const isAdmin = role === 'admin' || role === 'broadcaster';
    return { isAdmin, userId: decodedToken.uid };
  } catch {
    return { isAdmin: false };
  }
}

// POST — create a skip marker for an archive.
// Body: { archiveId, archiveSlug, showName, djName }.
export async function POST(request: NextRequest) {
  const { isAdmin, userId } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = body as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.archiveId !== 'string' ||
    typeof b.archiveSlug !== 'string' ||
    typeof b.showName !== 'string' ||
    typeof b.djName !== 'string'
  ) {
    return NextResponse.json(
      { error: 'archiveId, archiveSlug, showName, djName (all strings) required' },
      { status: 400 }
    );
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const docRef = db.collection('youtube-render-jobs').doc();
  await docRef.set({
    archiveId: b.archiveId,
    archiveSlug: b.archiveSlug,
    // renderData is normally where the queue card pulls show + DJ name;
    // we mirror that shape so the existing card component reads them
    // without special-casing skipped jobs.
    renderData: {
      showName: b.showName,
      djName: b.djName,
      // Fields the card doesn't display for skipped jobs but that the
      // RenderJob type expects to be present-ish.
      djPhotoUrl: '',
      djGenres: [],
      djDescription: null,
      sceneSlug: null,
    },
    status: 'skipped',
    createdAt: Date.now(),
    createdBy: userId,
  });
  return NextResponse.json({ jobId: docRef.id });
}

// DELETE — unskip (remove a skip marker by jobId).
// Query param: ?jobId=xxx. Only deletes docs with status='skipped' so
// callers can't accidentally wipe a real render via this endpoint.
export async function DELETE(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const ref = db.collection('youtube-render-jobs').doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (snap.data()?.status !== 'skipped') {
    return NextResponse.json(
      { error: 'Refusing to delete non-skipped job via /skip endpoint' },
      { status: 400 }
    );
  }
  await ref.delete();
  return NextResponse.json({ ok: true });
}
