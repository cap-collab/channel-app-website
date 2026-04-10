import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function PATCH(request: NextRequest) {
  try {
    const { archiveId, djIndex, genres, location } = await request.json();

    if (!archiveId || djIndex === undefined) {
      return NextResponse.json({ error: 'Archive ID and DJ index required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();

    if (!archiveDoc.exists) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const data = archiveDoc.data();
    const djs = data?.djs || [];

    if (djIndex < 0 || djIndex >= djs.length) {
      return NextResponse.json({ error: 'Invalid DJ index' }, { status: 400 });
    }

    // Update the specific DJ's genres and/or location
    if (genres !== undefined) {
      djs[djIndex].genres = Array.isArray(genres) ? genres : [];
    }
    if (location !== undefined) {
      djs[djIndex].location = location || null;
    }

    await archiveRef.update({ djs });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update archive metadata error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update metadata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
