import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { archiveId } = body;

    if (!archiveId) {
      return NextResponse.json({ error: 'Archive ID required' }, { status: 400 });
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

    const updates: Record<string, unknown> = {};

    // Top-level archive fields
    if (body.showName !== undefined) updates.showName = body.showName;
    if (body.showImageUrl !== undefined) updates.showImageUrl = body.showImageUrl || null;
    if (body.slug !== undefined) updates.slug = body.slug;

    // DJ-level updates (genres, location, name, username, photoUrl)
    if (body.djIndex !== undefined) {
      const data = archiveDoc.data();
      const djs = [...(data?.djs || [])];

      if (body.djIndex >= 0 && body.djIndex < djs.length) {
        if (body.genres !== undefined) {
          djs[body.djIndex].genres = Array.isArray(body.genres) ? body.genres : [];
        }
        if (body.location !== undefined) {
          djs[body.djIndex].location = body.location || null;
        }
        if (body.djName !== undefined) {
          djs[body.djIndex].name = body.djName;
        }
        if (body.djUsername !== undefined) {
          djs[body.djIndex].username = body.djUsername || null;
        }
        if (body.djPhotoUrl !== undefined) {
          djs[body.djIndex].photoUrl = body.djPhotoUrl || null;
        }
        updates.djs = djs;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    await archiveRef.update(updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update archive metadata error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update metadata';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
