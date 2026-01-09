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
    const { userId, bio, photoUrl } = body;

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

    // If nothing to update, return early
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, updated: 0 });
    }

    // Find all slots where this user is the DJ
    // Look for djUserId, liveDjUserId, and djEmail
    const now = new Date();

    // Get user's email for djEmail query
    const userDoc = await db.collection('users').doc(userId).get();
    const userEmail = userDoc.data()?.email;

    // Query 1: Slots where djUserId matches (upcoming scheduled slots)
    const byDjUserIdQuery = db.collection('broadcast-slots')
      .where('djUserId', '==', userId)
      .where('endTime', '>', now);

    // Query 2: Slots where liveDjUserId matches (slots they've gone live on)
    const byLiveDjUserIdQuery = db.collection('broadcast-slots')
      .where('liveDjUserId', '==', userId)
      .where('endTime', '>', now);

    // Query 3: Slots where djEmail matches (slots assigned by email before DJ logged in)
    const byDjEmailQuery = userEmail
      ? db.collection('broadcast-slots')
          .where('djEmail', '==', userEmail)
          .where('endTime', '>', now)
      : null;

    const queries = [byDjUserIdQuery.get(), byLiveDjUserIdQuery.get()];
    if (byDjEmailQuery) {
      queries.push(byDjEmailQuery.get());
    }

    const results = await Promise.all(queries);
    const [byDjUserId, byLiveDjUserId, byDjEmail] = results;

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

    if (byDjEmail) {
      byDjEmail.forEach((doc) => {
        if (!slotIds.has(doc.id)) {
          slotIds.add(doc.id);
          slotsToUpdate.push(doc);
        }
      });
    }

    // Update all matching slots
    const updatePromises = slotsToUpdate.map((doc) =>
      doc.ref.update(updateData)
    );

    await Promise.all(updatePromises);

    console.log(`[sync-slots] Updated ${slotsToUpdate.length} slots for user ${userId}:`, updateData);

    return NextResponse.json({
      success: true,
      updated: slotsToUpdate.length,
    });
  } catch (error) {
    console.error('[sync-slots] Error:', error);
    return NextResponse.json({ error: 'Failed to sync slots' }, { status: 500 });
  }
}
