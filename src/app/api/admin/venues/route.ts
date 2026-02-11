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

// POST - Create a venue
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
    const { name, photo, location, description, genres, socialLinks, residentDJs } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Venue name is required' }, { status: 400 });
    }

    // Generate unique slug
    const baseSlug = generateSlug(name.trim());
    let slug = baseSlug;
    let suffix = 2;

    // Check for slug collisions
    const existingSnapshot = await db.collection('venues')
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();

    const existingSlugs = new Set(existingSnapshot.docs.map(doc => doc.data().slug));
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const venueData: Record<string, unknown> = {
      name: name.trim(),
      slug,
      photo: photo || null,
      location: location || null,
      description: description || null,
      genres: genres || [],
      socialLinks: socialLinks || {},
      residentDJs: residentDJs || [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUserId,
    };

    const docRef = await db.collection('venues').add(venueData);

    return NextResponse.json({
      success: true,
      venueId: docRef.id,
      slug,
    });
  } catch (error) {
    console.error('Error creating venue:', error);
    return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
  }
}

// PATCH - Update a venue
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
    const { venueId, name, photo, location, description, genres, socialLinks, residentDJs } = body;

    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const venueRef = db.collection('venues').doc(venueId);
    const venueDoc = await venueRef.get();
    if (!venueDoc.exists) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (photo !== undefined) updateData.photo = photo;
    if (location !== undefined) updateData.location = location;
    if (description !== undefined) updateData.description = description;
    if (genres !== undefined) updateData.genres = genres;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
    if (residentDJs !== undefined) updateData.residentDJs = residentDJs;

    await venueRef.update(updateData);

    return NextResponse.json({ success: true, venueId });
  } catch (error) {
    console.error('Error updating venue:', error);
    return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
  }
}

// DELETE - Delete a venue
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
    const venueId = searchParams.get('venueId');

    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    await db.collection('venues').doc(venueId).delete();

    return NextResponse.json({ success: true, venueId });
  } catch (error) {
    console.error('Error deleting venue:', error);
    return NextResponse.json({ error: 'Failed to delete venue' }, { status: 500 });
  }
}
