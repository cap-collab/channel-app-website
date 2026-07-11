import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateSlug } from '@/lib/slug';
import { cleanupFavoritesForShowName, cleanupFavoritesForIRLEvent } from '@/lib/favorites-cleanup';
import {
  syncEventToVenues,
  syncEventToCollectives,
  cleanupDeletedEvent,
} from '@/lib/bidirectional-sync';
import { syncIRLEventToFollowers } from '@/lib/sync-irl-event';

// Verify user is authenticated and has DJ-level access.
// Collective owners (who may be role:'user') are ALSO authorized — they manage
// their collective's events. ownedCollectiveSlugs is returned so PATCH/DELETE
// can grant edit access to any event linked to a collective the user owns.
async function verifyDJAccess(request: NextRequest): Promise<{
  isAuthorized: boolean;
  userId?: string;
  role?: string;
  chatUsername?: string;
  chatUsernameNormalized?: string;
  djPhotoUrl?: string;
  ownedCollectiveSlugs?: string[];
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
    const ownedCollectiveSlugs = Array.isArray(userData?.ownedCollectiveSlugs)
      ? (userData!.ownedCollectiveSlugs as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    // DJ-role OR a collective owner (even role:'user') may use the events API.
    const isAuthorized =
      role === 'dj' || role === 'admin' || role === 'broadcaster' || ownedCollectiveSlugs.length > 0;
    return {
      isAuthorized,
      userId: decodedToken.uid,
      role,
      chatUsername: userData?.chatUsername,
      chatUsernameNormalized: userData?.chatUsernameNormalized,
      djPhotoUrl: userData?.djProfile?.photoUrl || undefined,
      ownedCollectiveSlugs,
    };
  } catch {
    return { isAuthorized: false };
  }
}

// True if the user may edit/delete this event: admin, the creator, OR an owner
// of a collective the event is linked to. Ownership is keyed on collectiveSlug
// (that's what ownedCollectiveSlugs holds), but we resolve the linked ref's slug
// from EITHER its collectiveSlug or by mapping its collectiveId — some refs carry
// only one. This must stay consistent with the collective studio's event LIST
// (CollectiveEventsCard.loadEvents), which matches on collectiveId/slug too.
function canEditEvent(
  currentData: FirebaseFirestore.DocumentData,
  userId: string,
  role: string | undefined,
  ownedCollectiveSlugs: string[]
): boolean {
  if (role === 'admin' || role === 'broadcaster') return true;
  if (currentData.createdBy === userId) return true;
  if (ownedCollectiveSlugs.length === 0) return false;
  const owned = new Set(ownedCollectiveSlugs);
  // Match on the linked ref's collectiveSlug OR its denormalized collectiveSlug.
  // Studio-created events carry the full ref (id+slug), so slug matching covers
  // them; stays consistent with the studio's event LIST.
  if (currentData.collectiveSlug && owned.has(currentData.collectiveSlug)) return true;
  if (Array.isArray(currentData.linkedCollectives)) {
    return currentData.linkedCollectives.some(
      (c: { collectiveSlug?: string }) => c.collectiveSlug && owned.has(c.collectiveSlug)
    );
  }
  return false;
}

// POST - Create an event
export async function POST(request: NextRequest) {
  const { isAuthorized, userId, role, chatUsername, chatUsernameNormalized, djPhotoUrl } = await verifyDJAccess(request);
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
      genres, location, ticketLink, discountCode,
    } = body;

    // A collective-only owner (role:'user') is NOT a DJ and must never be
    // auto-credited on the lineup. Only DJ-role users get self-added.
    const creatorIsDj = role === 'dj' || role === 'admin' || role === 'broadcaster';

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Event name is required' }, { status: 400 });
    }

    // Accept date as YYYY-MM-DD string or unix ms number, default to now
    let dateMs: number = Date.now();
    if (date) {
      if (typeof date === 'string') {
        dateMs = new Date(date + 'T12:00:00Z').getTime();
        if (isNaN(dateMs)) {
          return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
        }
      } else if (typeof date === 'number') {
        dateMs = date;
      }
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
    const djSelf: Record<string, string> = {
      djName: chatUsername || 'Unknown',
      djUserId: userId,
      djUsername: chatUsernameNormalized || (chatUsername ? generateSlug(chatUsername) : ''),
    };
    if (djPhotoUrl) djSelf.djPhotoUrl = djPhotoUrl;

    // Clean undefined values from djs entries (Firestore rejects undefined)
    const cleanDj = (d: Record<string, unknown>) => {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) {
        if (v !== undefined) cleaned[k] = v;
      }
      return cleaned;
    };

    let eventDjs = (djs || []).map((d: Record<string, unknown>) => cleanDj(d));
    // Only add self if a DJ AND not already in the djs array. Collective-only
    // owners are excluded — they organize but aren't part of the lineup.
    const selfAlreadyIncluded = eventDjs.some(
      (d: { djUserId?: string; djUsername?: string }) =>
        (d.djUserId && d.djUserId === userId) ||
        (d.djUsername && d.djUsername === djSelf.djUsername)
    );
    if (creatorIsDj && !selfAlreadyIncluded) {
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
      discountCode: discountCode || null,
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

    // Sync to followers of ALL DJs in the lineup (fire and forget)
    if (location && eventDjs.length > 0) {
      syncIRLEventToFollowers(request, {
        name: name.trim(),
        date: dateMs,
        location: location || '',
        ticketLink: ticketLink || undefined,
        djs: eventDjs,
      }).catch(err => {
        console.error('[events POST] Failed to sync to followers:', err);
      });
    }

    return NextResponse.json({
      success: true,
      eventId: docRef.id,
      slug,
    });
  } catch (error) {
    console.error('Error creating event:', error);
    const message = error instanceof Error ? error.message : 'Failed to create event';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH - Update an event (only own events, or admin/broadcaster can edit any)
export async function PATCH(request: NextRequest) {
  const { isAuthorized, userId, role, ownedCollectiveSlugs } = await verifyDJAccess(request);
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
      genres, location, ticketLink, discountCode,
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

    // Ownership: admin, the creator, OR an owner of a linked collective.
    if (!canEditEvent(currentData, userId, role, ownedCollectiveSlugs || [])) {
      return NextResponse.json({ error: 'You can only edit your own events' }, { status: 403 });
    }

    // Accept date as YYYY-MM-DD string or unix ms
    let dateMs: number | undefined;
    if (date !== undefined) {
      if (typeof date === 'string') {
        dateMs = new Date(date + 'T12:00:00Z').getTime();
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
    if (discountCode !== undefined) updateData.discountCode = discountCode || null;
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

    // Sync watchlist changes for IRL events (fire and forget)
    const mergedLocation = (location !== undefined ? location : currentData.location) as string | null;
    const mergedDateMs = (dateMs !== undefined ? dateMs : currentData.date) as number;
    const mergedDjs = (djs !== undefined ? djs : currentData.djs) as Array<{ djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }> | undefined;
    const previousLocation = currentData.location as string | null;
    const previousDjs = currentData.djs as Array<{ djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }> | undefined;

    if ((mergedLocation || previousLocation) && ((mergedDjs || []).length > 0 || (previousDjs || []).length > 0)) {
      const currentEvent = mergedLocation ? {
        name: (name !== undefined ? name : currentData.name) as string,
        date: mergedDateMs,
        location: mergedLocation,
        ticketLink: ((ticketLink !== undefined ? ticketLink : currentData.ticketLink) as string) || undefined,
        djs: mergedDjs || [],
      } : undefined;

      const previousEvent = previousLocation ? {
        name: currentData.name as string,
        date: currentData.date as number,
        location: previousLocation,
        ticketLink: (currentData.ticketLink as string) || undefined,
        djs: previousDjs || [],
      } : undefined;

      syncIRLEventToFollowers(request, currentEvent, previousEvent).catch(err => {
        console.error('[events PATCH] Failed to sync to followers:', err);
      });
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('Error updating event:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

// DELETE - Delete an event (only own events, or admin/broadcaster can delete any)
export async function DELETE(request: NextRequest) {
  const { isAuthorized, userId, role, ownedCollectiveSlugs } = await verifyDJAccess(request);
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

    // Ownership: admin, the creator, OR an owner of a linked collective.
    if (!canEditEvent(eventData, userId, role, ownedCollectiveSlugs || [])) {
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
          if (count > 0) console.log(`[events DELETE] Cleaned up ${count} show favorites for "${eventData.name}"`);
        })
        .catch(err => {
          console.error('[events DELETE] Error cleaning up show favorites:', err);
        });
    }

    // Clean up IRL favorites for ALL DJs in this event (fire and forget)
    if (eventData.location && eventData.date) {
      const dateObj = new Date(eventData.date);
      const dateStr = dateObj.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const eventDjs = (eventData.djs || []) as Array<{ djUsername?: string }>;
      for (const dj of eventDjs) {
        const djUsername = dj.djUsername || '';
        if (!djUsername) continue;
        cleanupFavoritesForIRLEvent(djUsername, dateStr, eventData.location as string)
          .then(count => {
            if (count > 0) console.log(`[events DELETE] Cleaned up ${count} IRL favorites for DJ "${djUsername}" on "${eventData.name}"`);
          })
          .catch(err => {
            console.error(`[events DELETE] Error cleaning up IRL favorites for DJ "${djUsername}":`, err);
          });
      }
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
