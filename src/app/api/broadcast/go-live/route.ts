import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot } from '@/types/broadcast';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Mark a broadcast slot as live and save DJ info
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[go-live] Database not configured');
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, djUsername, djUserId } = body;

    console.log('[go-live] Request received:', { broadcastToken: broadcastToken?.slice(0, 10) + '...', djUsername, djUserId });

    if (!broadcastToken) {
      console.error('[go-live] No broadcast token provided');
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.error('[go-live] Invalid broadcast token - no matching slot found');
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const slot = doc.data() as Omit<BroadcastSlot, 'id'>;
    console.log('[go-live] Found slot:', { id: doc.id, showName: slot.showName, status: slot.status });

    // Check if token has expired
    const now = Date.now();
    if (slot.tokenExpiresAt.toMillis() < now) {
      console.error('[go-live] Token has expired:', { tokenExpiresAt: slot.tokenExpiresAt.toMillis(), now });
      return NextResponse.json({ error: 'Token has expired' }, { status: 410 });
    }

    // Check if slot is still valid
    // Allow going live again if we're still within the time slot, even if previously completed
    const slotEndTime = slot.endTime.toMillis();
    if (now > slotEndTime) {
      console.error('[go-live] Slot time has passed:', { endTime: slotEndTime, now });
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Only reject if status is 'missed' (never went live at all)
    if (slot.status === 'missed') {
      console.error('[go-live] Slot was missed:', { status: slot.status });
      return NextResponse.json({ error: 'This broadcast slot was missed' }, { status: 410 });
    }

    // Update slot to live status with DJ info
    const updateData: Record<string, string> = { status: 'live' };

    if (djUsername) {
      updateData.liveDjUsername = djUsername;
    }
    if (djUserId) {
      updateData.liveDjUserId = djUserId;
    }

    await doc.ref.update(updateData);
    console.log('[go-live] ✅ Slot updated to live:', { slotId: doc.id, updateData });

    // If DJ is logged in, optionally save their DJ username to their user profile
    // Only save if user doesn't already have a chatUsername (prevents venue DJ overwrites)
    if (djUserId && djUsername) {
      try {
        const userRef = db.collection('users').doc(djUserId);
        const userDoc = await userRef.get();
        const existingUsername = userDoc.data()?.chatUsername;

        if (!existingUsername) {
          // User doesn't have a chatUsername yet - save it and register in usernames collection
          const normalizedUsername = djUsername.toLowerCase();
          const usernameDocRef = db.collection('usernames').doc(normalizedUsername);

          // Check if username is already claimed by someone else
          const usernameDoc = await usernameDocRef.get();
          if (!usernameDoc.exists || usernameDoc.data()?.uid === djUserId) {
            // Claim or update the username in usernames collection
            await usernameDocRef.set({
              displayName: djUsername,
              uid: djUserId,
              claimedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log('[go-live] ✅ Registered username in usernames collection:', { normalizedUsername, djUserId });
          } else {
            console.log('[go-live] ⚠️ Username already claimed by another user, skipping registration:', { normalizedUsername });
          }

          // Save chatUsername to user profile
          await userRef.set({
            chatUsername: djUsername,
            lastSeenAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log('[go-live] ✅ Saved chatUsername to user profile:', { djUserId, chatUsername: djUsername });
        } else {
          // User already has a chatUsername - don't overwrite (protects against venue DJ changes)
          await userRef.set({
            lastSeenAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log('[go-live] ℹ️ User already has chatUsername, not overwriting:', { djUserId, existingUsername, djUsername });
        }
      } catch (userError) {
        // Don't fail the go-live if user profile update fails
        console.error('[go-live] Failed to update user profile (non-fatal):', userError);
      }
    }

    return NextResponse.json({
      success: true,
      slotId: doc.id,
      status: 'live',
    });
  } catch (error) {
    console.error('[go-live] Error:', error);
    return NextResponse.json({ error: 'Failed to go live' }, { status: 500 });
  }
}
