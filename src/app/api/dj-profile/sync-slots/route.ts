import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Sync DJ profile data to their assigned broadcast slots
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[sync-slots] Database not configured');
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { userId, bio, photoUrl, promoText, promoHyperlink, thankYouMessage, chatUsername } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Build update data - only include fields that were provided
    const updateData: Record<string, string | null> = {};
    if (bio !== undefined) {
      updateData.liveDjBio = bio || null;
    }
    if (photoUrl !== undefined) {
      updateData.liveDjPhotoUrl = photoUrl || null;
    }
    if (promoText !== undefined) {
      updateData.liveDjPromoText = promoText || null;
    }
    if (promoHyperlink !== undefined) {
      updateData.liveDjPromoHyperlink = promoHyperlink || null;
    }
    if (thankYouMessage !== undefined) {
      updateData.liveDjThankYouMessage = thankYouMessage || null;
    }
    if (chatUsername !== undefined) {
      updateData.liveDjChatUsername = chatUsername || null;
    }

    // If nothing to update, return early
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, updated: 0 });
    }

    // Find all slots where this user is the DJ
    // Look for djUserId, liveDjUserId, and djEmail
    const now = new Date();

    // Get user's email for djEmail query
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userEmail = userData?.email;
    const userChatUsername = userData?.chatUsername;

    // Query 1: Slots where djUserId matches (upcoming scheduled slots)
    const byDjUserIdQuery = db.collection('broadcast-slots')
      .where('djUserId', '==', userId)
      .where('endTime', '>', now);

    // Query 2: Slots where liveDjUserId matches (upcoming slots they've gone live on)
    const byLiveDjUserIdQuery = db.collection('broadcast-slots')
      .where('liveDjUserId', '==', userId)
      .where('endTime', '>', now);

    // Query 3: Currently LIVE slots where liveDjUserId matches (regardless of end time)
    const byLiveDjUserIdLiveQuery = db.collection('broadcast-slots')
      .where('liveDjUserId', '==', userId)
      .where('status', '==', 'live');

    // Query 4: Slots where djEmail matches (slots assigned by email before DJ logged in)
    const byDjEmailQuery = userEmail
      ? db.collection('broadcast-slots')
          .where('djEmail', '==', userEmail)
          .where('endTime', '>', now)
      : null;

    // Query 5: Currently LIVE slots where djEmail matches (regardless of end time)
    const byDjEmailLiveQuery = userEmail
      ? db.collection('broadcast-slots')
          .where('djEmail', '==', userEmail)
          .where('status', '==', 'live')
      : null;

    const queries = [byDjUserIdQuery.get(), byLiveDjUserIdQuery.get(), byLiveDjUserIdLiveQuery.get()];
    if (byDjEmailQuery) {
      queries.push(byDjEmailQuery.get());
    }
    if (byDjEmailLiveQuery) {
      queries.push(byDjEmailLiveQuery.get());
    }

    const results = await Promise.all(queries);
    const [byDjUserId, byLiveDjUserId, byLiveDjUserIdLive, byDjEmail, byDjEmailLive] = results;

    // Collect unique slot IDs to update
    const slotIds = new Set<string>();
    const slotsToUpdate: FirebaseFirestore.QueryDocumentSnapshot[] = [];

    byDjUserId.forEach((doc) => {
      if (!slotIds.has(doc.id)) {
        slotIds.add(doc.id);
        slotsToUpdate.push(doc);
      }
    });

    byLiveDjUserId.forEach((doc) => {
      if (!slotIds.has(doc.id)) {
        slotIds.add(doc.id);
        slotsToUpdate.push(doc);
      }
    });

    byLiveDjUserIdLive.forEach((doc) => {
      if (!slotIds.has(doc.id)) {
        slotIds.add(doc.id);
        slotsToUpdate.push(doc);
      }
    });

    if (byDjEmail) {
      byDjEmail.forEach((doc) => {
        if (!slotIds.has(doc.id)) {
          slotIds.add(doc.id);
          slotsToUpdate.push(doc);
        }
      });
    }

    if (byDjEmailLive) {
      byDjEmailLive.forEach((doc) => {
        if (!slotIds.has(doc.id)) {
          slotIds.add(doc.id);
          slotsToUpdate.push(doc);
        }
      });
    }

    // Update all matching slots (root-level fields)
    const updatePromises = slotsToUpdate.map((doc) =>
      doc.ref.update(updateData)
    );

    await Promise.all(updatePromises);

    console.log(`[sync-slots] Updated ${slotsToUpdate.length} slots for user ${userId} (email: ${userEmail || 'none'}):`, updateData);
    console.log(`[sync-slots] Query results: byDjUserId=${byDjUserId.size}, byLiveDjUserId=${byLiveDjUserId.size}, byDjEmail=${byDjEmail?.size || 0}`);

    // Also update djSlots array entries where djEmail matches (for venue broadcasts)
    // Query upcoming slots AND currently live slots
    if (userEmail) {
      const [upcomingSnapshot, liveSnapshot] = await Promise.all([
        db.collection('broadcast-slots').where('endTime', '>', now).get(),
        db.collection('broadcast-slots').where('status', '==', 'live').get(),
      ]);

      // Combine and deduplicate
      const allSlotIds = new Set<string>();
      const allSlotsToCheck: FirebaseFirestore.QueryDocumentSnapshot[] = [];

      upcomingSnapshot.forEach((doc) => {
        if (!allSlotIds.has(doc.id)) {
          allSlotIds.add(doc.id);
          allSlotsToCheck.push(doc);
        }
      });

      liveSnapshot.forEach((doc) => {
        if (!allSlotIds.has(doc.id)) {
          allSlotIds.add(doc.id);
          allSlotsToCheck.push(doc);
        }
      });

      let djSlotsUpdated = 0;

      for (const doc of allSlotsToCheck) {
        const data = doc.data();
        const djSlots = data.djSlots;

        if (!djSlots || !Array.isArray(djSlots)) continue;

        // Check if any djSlot has this user's email
        let hasMatch = false;
        const updatedDjSlots = djSlots.map((slot: Record<string, unknown>) => {
          if (slot.djEmail?.toString().toLowerCase() === userEmail.toLowerCase()) {
            hasMatch = true;
            return {
              ...slot,
              ...(bio !== undefined && { djBio: bio || null }),
              ...(photoUrl !== undefined && { djPhotoUrl: photoUrl || null }),
              ...(promoText !== undefined && { djPromoText: promoText || null }),
              ...(promoHyperlink !== undefined && { djPromoHyperlink: promoHyperlink || null }),
              ...(thankYouMessage !== undefined && { djThankYouMessage: thankYouMessage || null }),
              // Always sync chatUsername from user profile for profile button URL
              ...(userChatUsername && { djChatUsername: userChatUsername }),
            };
          }
          return slot;
        });

        if (hasMatch) {
          // Check if the current live DJ slot matches this user's email
          // If so, also update the root-level live fields
          const currentDjSlotId = data.currentDjSlotId;
          const currentDjSlot = djSlots.find((s: Record<string, unknown>) => s.id === currentDjSlotId);
          const isCurrentDj = currentDjSlot?.djEmail?.toString().toLowerCase() === userEmail.toLowerCase();

          const slotUpdate: Record<string, unknown> = { djSlots: updatedDjSlots };

          // If this is the currently live DJ, update root-level fields too
          if (isCurrentDj && data.status === 'live') {
            if (bio !== undefined) slotUpdate.liveDjBio = bio || null;
            if (photoUrl !== undefined) slotUpdate.liveDjPhotoUrl = photoUrl || null;
            if (promoText !== undefined) slotUpdate.liveDjPromoText = promoText || null;
            if (promoHyperlink !== undefined) slotUpdate.liveDjPromoHyperlink = promoHyperlink || null;
            if (thankYouMessage !== undefined) slotUpdate.liveDjThankYouMessage = thankYouMessage || null;
            // Always sync chatUsername for profile button URL
            if (userChatUsername) slotUpdate.liveDjChatUsername = userChatUsername;
            console.log(`[sync-slots] Also updating live fields for current DJ in slot ${doc.id}`);
          }

          await doc.ref.update(slotUpdate);
          djSlotsUpdated++;
          console.log(`[sync-slots] Updated djSlots array in slot ${doc.id} for email ${userEmail}`);
        }
      }

      if (djSlotsUpdated > 0) {
        console.log(`[sync-slots] Updated djSlots arrays in ${djSlotsUpdated} venue broadcasts`);
      }
    }

    return NextResponse.json({
      success: true,
      updated: slotsToUpdate.length,
    });
  } catch (error) {
    console.error('[sync-slots] Error:', error);
    return NextResponse.json({ error: 'Failed to sync slots' }, { status: 500 });
  }
}
