import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Update an archive's recordingUrl (e.g. after normalizing).
// Stores the previous URL in `previousRecordingUrl` for rollback.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { archiveId, newRecordingUrl } = body;

  if (!archiveId || !newRecordingUrl) {
    return NextResponse.json({ error: 'archiveId and newRecordingUrl required' }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const ref = db.collection('archives').doc(archiveId);
  const doc = await ref.get();
  if (!doc.exists) return NextResponse.json({ error: 'Archive not found' }, { status: 404 });

  const currentUrl = doc.data()?.recordingUrl;

  await ref.update({
    recordingUrl: newRecordingUrl,
    previousRecordingUrl: currentUrl,
    normalizedAt: FieldValue.serverTimestamp(),
  });

  // Propagate to any restream slots that cache this archive's URL. Without this,
  // scheduled restreams keep the stale URL and the worker fails at start time.
  const slotsSnap = await db
    .collection('broadcast-slots')
    .where('archiveId', '==', archiveId)
    .get();
  const slotUpdates = slotsSnap.docs.map((slotDoc) =>
    slotDoc.ref.update({ archiveRecordingUrl: newRecordingUrl }),
  );
  await Promise.all(slotUpdates);

  return NextResponse.json({
    success: true,
    archiveId,
    previousUrl: currentUrl,
    newUrl: newRecordingUrl,
    slotsUpdated: slotsSnap.size,
  });
}
