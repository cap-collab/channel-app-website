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

// Verify user is authenticated and has DJ-level access
async function verifyDJAccess(request: NextRequest): Promise<{
  isAuthorized: boolean;
  userId?: string;
  role?: string;
  chatUsername?: string;
  chatUsernameNormalized?: string;
  djPhotoUrl?: string;
}> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { isAuthorized: false };
    }

    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAuthorized: false };

    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAuthorized: false };

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();
    const role = userData?.role;

    const isAuthorized = role === 'dj' || role === 'admin' || role === 'broadcaster';
    return {
      isAuthorized,
      userId: decodedToken.uid,
      role,
      chatUsername: userData?.chatUsername,
      chatUsernameNormalized: userData?.chatUsernameNormalized,
      djPhotoUrl: userData?.djProfile?.photoUrl || undefined,
    };
  } catch {
    return { isAuthorized: false };
  }
}

// POST - Create an event
export async function POST(request: NextRequest) {
  const { isAuthorized, userId, chatUsername, chatUsernameNormalized, djPhotoUrl } = await verifyDJAccess(request);
  if (!isAuthorized || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const {
      name, date, endDate, photo, description,
      linkedVenues, linkedCollectives, djs,
      genres, location, ticketLink,
    } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Event name is required' }, { status: 400 });
    }

    if (!date) {
      return NextResponse.json({ error: 'Event date is required' }, { status: 400 });
    }

    // Accept date as YYYY-MM-DD string or unix ms number
    let dateMs: number;
    if (typeof date === 'string') {
      dateMs = new Date(date + 'T00:00:00').getTime();
      if (isNaN(dateMs)) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
      }
    } else if (typeof date === 'number') {
      dateMs = date;
    } else {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
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

    // Build DJs array — auto-include the creating DJ
    const djSelf = {
      djName: chatUsername || 'Unknown',
      djUserId: userId,
      djUsername: chatUsernameNormalized || chatUsername?.replace(/\s+/g, '').toLowerCase(),
      djPhotoUrl: djPhotoUrl || undefined,
    };

    let eventDjs = djs || [];
    // Only add self if not already in the djs array
    const selfAlreadyIncluded = eventDjs.some(
      (d: { djUserId?: string; djUsername?: string }) =>
        (d.djUserId && d.djUserId === userId) ||
        (d.djUsername && d.djUsername === djSelf.djUsername)
    );
    if (!selfAlreadyIncluded) {
      eventDjs = [djSelf, ...eventDjs];
    }

    // Denormalize venue name from first linked venue
    let venueId: string | null = null;
    let venueName: string | null = null;
    if (linkedVenues && linkedVenues.length > 0) {
      venueId = linkedVenues[0].venueId;
      venueName = linkedVenues[0].venueName;
    }

    const eventData: Record<string, unknown> = {
      name: name.trim(),
      slug,
      date: dateMs,
      endDate: endDate || null,
      photo: photo || null,
      description: description || null,
      venueId,
      venueName,
      collectiveId: null,
      collectiveName: null,
      linkedVenues: linkedVenues || [],
      linkedCollectives: linkedCollectives || [],
      djs: eventDjs,
      genres: genres || [],
      location: location || null,
      ticketLink: ticketLink || null,
      socialLinks: {},
      source: 'dj',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: userId,
    };

    const docRef = await db.collection('events').add(eventData);

    // Bidirectional sync
    const batch = db.batch();
    await syncEventToVenues(batch, db, docRef.id, name.trim(), slug, dateMs, [], linkedVenues || []);
    await syncEventToCollectives(batch, db, docRef.id, name.trim(), slug, dateMs, [], linkedCollectives || []);
    await batch.commit();

    // Sync to followers (fire and forget)
    try {
      const protocol = request.headers.get('x-forwarded-proto') || 'https';
      const host = request.headers.get('host') || 'localhost:3000';
      const baseUrl = `${protocol}://${host}`;
      await fetch(`${baseUrl}/api/dj/sync-shows-to-followers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          djUserId: userId,
          djUsername: chatUsernameNormalized || '',
          djName: chatUsername || '',
          djPhotoUrl: djPhotoUrl || undefined,
          irlShows: [{
            name: name.trim(),
            location: location || '',
            url: ticketLink || '',
            date: new Date(dateMs).toISOString().split('T')[0],
          }],
          radioShows: [],
          previousIrlShows: [],
          previousRadioShows: [],
        }),
      });
    } catch (syncError) {
      console.error('[events POST] Failed to sync to followers:', syncError);
    }

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

// PATCH - Update an event (only own events, or admin/broadcaster can edit any)
export async function PATCH(request: NextRequest) {
  const { isAuthorized, userId, role } = await verifyDJAccess(request);
  if (!isAuthorized || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const {
      eventId, name, date, endDate, photo, description,
      linkedVenues, linkedCollectives, djs,
      genres, location, ticketLink,
    } = body;

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const currentData = eventDoc.data()!;

    // Ownership check: DJs can only edit their own events
    const isAdminRole = role === 'admin' || role === 'broadcaster';
    if (!isAdminRole && currentData.createdBy !== userId) {
      return NextResponse.json({ error: 'You can only edit your own events' }, { status: 403 });
    }

    // Accept date as YYYY-MM-DD string or unix ms
    let dateMs: number | undefined;
    if (date !== undefined) {
      if (typeof date === 'string') {
        dateMs = new Date(date + 'T00:00:00').getTime();
        if (isNaN(dateMs)) {
          return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }
      } else if (typeof date === 'number') {
        dateMs = date;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (dateMs !== undefined) updateData.date = dateMs;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (photo !== undefined) updateData.photo = photo;
    if (description !== undefined) updateData.description = description;
    if (djs !== undefined) updateData.djs = djs;
    if (genres !== undefined) updateData.genres = genres;
    if (location !== undefined) updateData.location = location;
    if (ticketLink !== undefined) updateData.ticketLink = ticketLink;
    if (linkedVenues !== undefined) {
      updateData.linkedVenues = linkedVenues;
      // Update denormalized venue fields
      if (linkedVenues.length > 0) {
        updateData.venueId = linkedVenues[0].venueId;
        updateData.venueName = linkedVenues[0].venueName;
      } else {
        updateData.venueId = null;
        updateData.venueName = null;
      }
    }
    if (linkedCollectives !== undefined) updateData.linkedCollectives = linkedCollectives;

    const batch = db.batch();
    batch.update(eventRef, updateData);

    // Bidirectional sync
    const selfName = (name !== undefined ? name : currentData.name) as string;
    const selfSlug = currentData.slug as string;
    const selfDate = (dateMs !== undefined ? dateMs : currentData.date) as number;

    if (linkedVenues !== undefined) {
      await syncEventToVenues(
        batch, db, eventId, selfName, selfSlug, selfDate,
        currentData.linkedVenues || [],
        linkedVenues
      );
    }

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

// DELETE - Delete an event (only own events, or admin/broadcaster can delete any)
export async function DELETE(request: NextRequest) {
  const { isAuthorized, userId, role } = await verifyDJAccess(request);
  if (!isAuthorized || !userId) {
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

    const eventRef = db.collection('events').doc(eventId);
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const eventData = eventDoc.data()!;

    // Ownership check
    const isAdminRole = role === 'admin' || role === 'broadcaster';
    if (!isAdminRole && eventData.createdBy !== userId) {
      return NextResponse.json({ error: 'You can only delete your own events' }, { status: 403 });
    }

    const batch = db.batch();
    batch.delete(eventRef);

    await cleanupDeletedEvent(
      batch, db, eventId,
      eventData.linkedVenues || [],
      eventData.linkedCollectives || []
    );

    await batch.commit();

    // Clean up favorites (fire and forget)
    if (eventData.name) {
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
