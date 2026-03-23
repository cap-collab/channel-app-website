import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateSlug } from '@/lib/slug';
import { cleanupFavoritesForShowName } from '@/lib/favorites-cleanup';
import {
  syncEventToVenues,
  syncEventToCollectives,
  cleanupDeletedEvent,
} from '@/lib/bidirectional-sync';

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

// POST - Create an event
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
    const { name, date, endDate, photo, description, venueId, venueName: manualVenueName, collectiveId, linkedVenues, linkedCollectives, djs, genres, location, ticketLink, socialLinks } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Event name is required' }, { status: 400 });
    }

    if (!date || typeof date !== 'number') {
      return NextResponse.json({ error: 'Event date is required' }, { status: 400 });
    }

    // Generate unique slug
    const baseSlug = generateSlug(name.trim());
    let slug = baseSlug;
    let suffix = 2;

    const existingSnapshot = await db.collection('events')
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();

    const existingSlugs = new Set(existingSnapshot.docs.map(doc => doc.data().slug));
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    // Denormalize venue name: use Firestore lookup if venueId provided, otherwise use manual name
    let venueName: string | null = null;
    if (venueId) {
      const venueDoc = await db.collection('venues').doc(venueId).get();
      if (venueDoc.exists) {
        venueName = venueDoc.data()?.name || null;
      }
    } else if (manualVenueName) {
      venueName = manualVenueName;
    }

    // Denormalize collective name if collectiveId is provided (legacy single-collective)
    let collectiveName: string | null = null;
    if (collectiveId) {
      const collectiveDoc = await db.collection('collectives').doc(collectiveId).get();
      if (collectiveDoc.exists) {
        collectiveName = collectiveDoc.data()?.name || null;
      }
    }

    const eventData: Record<string, unknown> = {
      name: name.trim(),
      slug,
      date,
      endDate: endDate || null,
      photo: photo || null,
      description: description || null,
      venueId: venueId || null,
      venueName,
      collectiveId: collectiveId || null,
      collectiveName,
      linkedVenues: linkedVenues || [],
      linkedCollectives: linkedCollectives || [],
      djs: djs || [],
      genres: genres || [],
      location: location || null,
      ticketLink: ticketLink || null,
      socialLinks: socialLinks || {},
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUserId,
    };

    const docRef = await db.collection('events').add(eventData);

    // Bidirectional sync: add self to all linked venues and collectives
    const batch = db.batch();
    await syncEventToVenues(batch, db, docRef.id, name.trim(), slug, date, [], linkedVenues || []);
    await syncEventToCollectives(batch, db, docRef.id, name.trim(), slug, date, [], linkedCollectives || []);
    await batch.commit();

    return NextResponse.json({
      success: true,
      eventId: docRef.id,
      slug,
    });
  } catch (error) {
    console.error('Error creating event:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}

// PATCH - Update an event
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
    const { eventId, name, date, endDate, photo, description, venueId, venueName: manualVenueName, collectiveId, linkedVenues, linkedCollectives, djs, genres, location, ticketLink, socialLinks } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const currentData = eventDoc.data()!;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (date !== undefined) updateData.date = date;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (photo !== undefined) updateData.photo = photo;
    if (description !== undefined) updateData.description = description;
    if (djs !== undefined) updateData.djs = djs;
    if (genres !== undefined) updateData.genres = genres;
    if (location !== undefined) updateData.location = location;
    if (ticketLink !== undefined) updateData.ticketLink = ticketLink;
    if (socialLinks !== undefined) updateData.socialLinks = socialLinks;
    if (linkedVenues !== undefined) updateData.linkedVenues = linkedVenues;
    if (linkedCollectives !== undefined) updateData.linkedCollectives = linkedCollectives;

    // Re-denormalize venue name if venueId changed
    if (venueId !== undefined) {
      updateData.venueId = venueId || null;
      if (venueId) {
        const venueDoc = await db.collection('venues').doc(venueId).get();
        updateData.venueName = venueDoc.exists ? venueDoc.data()?.name || null : null;
      } else {
        updateData.venueName = manualVenueName || null;
      }
    } else if (manualVenueName !== undefined) {
      updateData.venueName = manualVenueName || null;
    }

    // Re-denormalize collective name if collectiveId changed
    if (collectiveId !== undefined) {
      updateData.collectiveId = collectiveId || null;
      if (collectiveId) {
        const collectiveDoc = await db.collection('collectives').doc(collectiveId).get();
        updateData.collectiveName = collectiveDoc.exists ? collectiveDoc.data()?.name || null : null;
      } else {
        updateData.collectiveName = null;
      }
    }

    const batch = db.batch();
    batch.update(eventRef, updateData);

    // Bidirectional sync for linkedVenues changes
    const selfName = (name !== undefined ? name : currentData.name) as string;
    const selfSlug = currentData.slug as string;
    const selfDate = (date !== undefined ? date : currentData.date) as number;

    if (linkedVenues !== undefined) {
      await syncEventToVenues(
        batch, db, eventId, selfName, selfSlug, selfDate,
        currentData.linkedVenues || [],
        linkedVenues
      );
    }

    // Bidirectional sync for linkedCollectives changes
    if (linkedCollectives !== undefined) {
      await syncEventToCollectives(
        batch, db, eventId, selfName, selfSlug, selfDate,
        currentData.linkedCollectives || [],
        linkedCollectives
      );
    }

    await batch.commit();

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('Error updating event:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

// DELETE - Delete an event
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
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    // Read event data before deleting (for favorites cleanup + bidirectional sync)
    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    const eventData = eventDoc.data();

    const batch = db.batch();
    batch.delete(eventRef);

    // Clean up reverse links before deleting
    if (eventDoc.exists && eventData) {
      await cleanupDeletedEvent(
        batch, db, eventId,
        eventData.linkedVenues || [],
        eventData.linkedCollectives || []
      );
    }

    await batch.commit();

    // Clean up favorites pointing to this event (fire and forget)
    if (eventData?.name) {
      cleanupFavoritesForShowName(eventData.name as string)
        .then(count => {
          if (count > 0) console.log(`[events DELETE] Cleaned up ${count} favorites for "${eventData.name}"`);
        })
        .catch(err => {
          console.error('[events DELETE] Error cleaning up favorites:', err);
        });
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
