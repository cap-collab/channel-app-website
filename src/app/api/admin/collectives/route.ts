import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateSlug } from '@/lib/slug';
import {
  syncCollectiveToCollectives,
  syncCollectiveToVenues,
  syncCollectiveToEvents,
  cleanupDeletedCollective,
  cleanupDeletedCollectiveEvents,
} from '@/lib/bidirectional-sync';

// Keep users' denormalized `ownedCollectiveSlugs` in sync with a collective's
// owners[]. This field is the canonical "collectives a user owns" source read by
// the studio + the firestore tracklist-edit rule, so it MUST be updated on every
// ownership mutation (create / owner-set / delete). `slug` is the collective's
// stored slug (already lowercased; may be `-2` suffixed) — pass it verbatim.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function syncOwnedSlug(batch: any, db: any, uids: string[], slug: string, op: 'add' | 'remove') {
  const value = op === 'add' ? FieldValue.arrayUnion(slug) : FieldValue.arrayRemove(slug);
  for (const uid of uids) {
    if (typeof uid === 'string' && uid.length > 0) {
      batch.set(db.collection('users').doc(uid), { ownedCollectiveSlugs: value }, { merge: true });
    }
  }
}

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
    const { name, photo, location, description, genres, socialLinks, residentDJs, guestDJs, linkedVenues, linkedCollectives, linkedEvents, sceneIds, owners, tipButtonLink } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Collective name is required' }, { status: 400 });
    }

    // Generate unique slug \u2014 check both `collectives` (other collectives) and
    // `usernames` (DJ users + pending DJs) so the slug is globally unique
    // across the shared /dj/<slug> namespace.
    const baseSlug = generateSlug(name.trim());
    let slug = baseSlug;
    let suffix = 2;

    const existingSnapshot = await db.collection('collectives')
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();
    const existingSlugs = new Set(existingSnapshot.docs.map(doc => doc.data().slug));

    while (existingSlugs.has(slug) || (await db.collection('usernames').doc(slug).get()).exists) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const cleanedOwners = Array.isArray(owners)
      ? owners.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      : [];

    const collectiveData: Record<string, unknown> = {
      name: name.trim(),
      slug,
      photo: photo || null,
      location: location || null,
      description: description || null,
      genres: genres || [],
      socialLinks: socialLinks || {},
      residentDJs: residentDJs || [],
      guestDJs: guestDJs || [],
      linkedVenues: linkedVenues || [],
      linkedCollectives: linkedCollectives || [],
      linkedEvents: linkedEvents || [],
      sceneIds: Array.isArray(sceneIds) ? sceneIds.filter((v: unknown) => typeof v === 'string') : [],
      owners: cleanedOwners,
      tipButtonLink: tipButtonLink || null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUserId,
    };

    const docRef = await db.collection('collectives').add(collectiveData);

    // Reserve the slug in the global usernames collection so future user
    // signups / pending-DJ creations can't take it.
    await db.collection('usernames').doc(slug).set({
      usernameHandle: slug,
      uid: `collective:${docRef.id}`,
      isPending: false,
      claimedAt: FieldValue.serverTimestamp(),
    });

    // Bidirectional sync: add self to all linked collectives, venues, and events
    const batch = db.batch();
    await syncCollectiveToCollectives(batch, db, docRef.id, name.trim(), slug, [], linkedCollectives || [], photo || null);
    await syncCollectiveToVenues(batch, db, docRef.id, name.trim(), slug, [], linkedVenues || [], photo || null);
    await syncCollectiveToEvents(batch, db, docRef.id, name.trim(), slug, [], linkedEvents || [], photo || null);
    // Seed ownedCollectiveSlugs on each owner.
    syncOwnedSlug(batch, db, cleanedOwners, slug, 'add');
    await batch.commit();

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
    const { collectiveId, name, photo, location, description, genres, socialLinks, residentDJs, guestDJs, linkedVenues, linkedCollectives, linkedEvents, sceneIds, owners, tipButtonLink } = body;

    if (!collectiveId) {
      return NextResponse.json({ error: 'collectiveId is required' }, { status: 400 });
    }

    const collectiveRef = db.collection('collectives').doc(collectiveId);
    const collectiveDoc = await collectiveRef.get();
    if (!collectiveDoc.exists) {
      return NextResponse.json({ error: 'Collective not found' }, { status: 404 });
    }

    const currentData = collectiveDoc.data()!;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (photo !== undefined) updateData.photo = photo;
    if (location !== undefined) updateData.location = location;
    if (description !== undefined) updateData.description = description;
    if (genres !== undefined) updateData.genres = genres;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
    if (residentDJs !== undefined) updateData.residentDJs = residentDJs;
    if (guestDJs !== undefined) updateData.guestDJs = guestDJs;
    if (linkedVenues !== undefined) updateData.linkedVenues = linkedVenues;
    if (linkedCollectives !== undefined) updateData.linkedCollectives = linkedCollectives;
    if (linkedEvents !== undefined) updateData.linkedEvents = linkedEvents;
    if (sceneIds !== undefined) {
      updateData.sceneIds = Array.isArray(sceneIds)
        ? sceneIds.filter((v: unknown) => typeof v === 'string')
        : [];
    }
    if (owners !== undefined) {
      updateData.owners = Array.isArray(owners)
        ? owners.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
        : [];
    }
    if (tipButtonLink !== undefined) updateData.tipButtonLink = tipButtonLink || null;

    const batch = db.batch();
    batch.update(collectiveRef, updateData);

    // Bidirectional sync for linkedCollectives changes
    const selfName = (name !== undefined ? name : currentData.name) as string;
    const selfSlug = currentData.slug as string;
    const selfPhoto = (photo !== undefined ? photo : currentData.photo) as string | null;

    // Owner diff → keep ownedCollectiveSlugs in sync. Owners are set wholesale,
    // so compute added/removed and update each side. Slug is stable on PATCH.
    if (owners !== undefined) {
      const oldOwners: string[] = Array.isArray(currentData.owners) ? currentData.owners : [];
      const newOwners = updateData.owners as string[];
      const oldSet = new Set(oldOwners);
      const newSet = new Set(newOwners);
      const added = newOwners.filter((u) => !oldSet.has(u));
      const removed = oldOwners.filter((u) => !newSet.has(u));
      if (added.length) syncOwnedSlug(batch, db, added, selfSlug, 'add');
      if (removed.length) syncOwnedSlug(batch, db, removed, selfSlug, 'remove');
    }

    if (linkedCollectives !== undefined) {
      await syncCollectiveToCollectives(
        batch, db, collectiveId, selfName, selfSlug,
        currentData.linkedCollectives || [],
        linkedCollectives,
        selfPhoto
      );
    }

    // Bidirectional sync for linkedVenues changes
    if (linkedVenues !== undefined) {
      await syncCollectiveToVenues(
        batch, db, collectiveId, selfName, selfSlug,
        currentData.linkedVenues || [],
        linkedVenues,
        selfPhoto
      );
    }

    // Bidirectional sync for linkedEvents changes
    if (linkedEvents !== undefined) {
      await syncCollectiveToEvents(
        batch, db, collectiveId, selfName, selfSlug,
        currentData.linkedEvents || [],
        linkedEvents,
        selfPhoto
      );
    }

    await batch.commit();

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

    const collectiveRef = db.collection('collectives').doc(collectiveId);
    const collectiveDoc = await collectiveRef.get();

    const batch = db.batch();
    batch.delete(collectiveRef);

    // Clean up reverse links and the global usernames reservation before deleting
    if (collectiveDoc.exists) {
      const data = collectiveDoc.data()!;
      await cleanupDeletedCollective(
        batch, db, collectiveId,
        data.linkedVenues || [],
        data.linkedCollectives || []
      );
      if (data.linkedEvents?.length > 0) {
        await cleanupDeletedCollectiveEvents(
          batch, db, collectiveId,
          data.linkedEvents
        );
      }
      // Release the slug from the global usernames namespace.
      if (data.slug) {
        batch.delete(db.collection('usernames').doc(data.slug as string));
      }
      // Remove this collective's slug from every owner's ownedCollectiveSlugs.
      if (data.slug && Array.isArray(data.owners)) {
        syncOwnedSlug(batch, db, data.owners as string[], data.slug as string, 'remove');
      }
    }

    await batch.commit();

    return NextResponse.json({ success: true, collectiveId });
  } catch (error) {
    console.error('Error deleting collective:', error);
    return NextResponse.json({ error: 'Failed to delete collective' }, { status: 500 });
  }
}
