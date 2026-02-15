import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateSlug } from '@/lib/slug';

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { isAdmin: false };
    }

    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };

    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();
    const role = userData?.role;

    const isAdmin = role === 'admin' || role === 'broadcaster';
    return { isAdmin, userId: decodedToken.uid };
  } catch {
    return { isAdmin: false };
  }
}

// POST - Create a collective
export async function POST(request: NextRequest) {
  const { isAdmin, userId: adminUserId } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { name, photo, location, description, genres, socialLinks, residentDJs, linkedVenues, linkedCollectives } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Collective name is required' }, { status: 400 });
    }

    // Generate unique slug
    const baseSlug = generateSlug(name.trim());
    let slug = baseSlug;
    let suffix = 2;

    // Check for slug collisions
    const existingSnapshot = await db.collection('collectives')
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();

    const existingSlugs = new Set(existingSnapshot.docs.map(doc => doc.data().slug));
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const collectiveData: Record<string, unknown> = {
      name: name.trim(),
      slug,
      photo: photo || null,
      location: location || null,
      description: description || null,
      genres: genres || [],
      socialLinks: socialLinks || {},
      residentDJs: residentDJs || [],
      linkedVenues: linkedVenues || [],
      linkedCollectives: linkedCollectives || [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUserId,
    };

    const docRef = await db.collection('collectives').add(collectiveData);

    return NextResponse.json({
      success: true,
      collectiveId: docRef.id,
      slug,
    });
  } catch (error) {
    console.error('Error creating collective:', error);
    return NextResponse.json({ error: 'Failed to create collective' }, { status: 500 });
  }
}

// PATCH - Update a collective
export async function PATCH(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { collectiveId, name, photo, location, description, genres, socialLinks, residentDJs, linkedVenues, linkedCollectives } = body;

    if (!collectiveId) {
      return NextResponse.json({ error: 'collectiveId is required' }, { status: 400 });
    }

    const collectiveRef = db.collection('collectives').doc(collectiveId);
    const collectiveDoc = await collectiveRef.get();
    if (!collectiveDoc.exists) {
      return NextResponse.json({ error: 'Collective not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (photo !== undefined) updateData.photo = photo;
    if (location !== undefined) updateData.location = location;
    if (description !== undefined) updateData.description = description;
    if (genres !== undefined) updateData.genres = genres;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
    if (residentDJs !== undefined) updateData.residentDJs = residentDJs;
    if (linkedVenues !== undefined) updateData.linkedVenues = linkedVenues;
    if (linkedCollectives !== undefined) updateData.linkedCollectives = linkedCollectives;

    await collectiveRef.update(updateData);

    return NextResponse.json({ success: true, collectiveId });
  } catch (error) {
    console.error('Error updating collective:', error);
    return NextResponse.json({ error: 'Failed to update collective' }, { status: 500 });
  }
}

// DELETE - Delete a collective
export async function DELETE(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const collectiveId = searchParams.get('collectiveId');

    if (!collectiveId) {
      return NextResponse.json({ error: 'collectiveId is required' }, { status: 400 });
    }

    await db.collection('collectives').doc(collectiveId).delete();

    return NextResponse.json({ success: true, collectiveId });
  } catch (error) {
    console.error('Error deleting collective:', error);
    return NextResponse.json({ error: 'Failed to delete collective' }, { status: 500 });
  }
}
