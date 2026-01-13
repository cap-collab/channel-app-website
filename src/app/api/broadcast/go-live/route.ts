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
    const { broadcastToken, djUsername, djUserId, egressId, recordingEgressId, thankYouMessage } = body;

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

    // Check if slot is still valid - only reject if end time has passed
    // Allow going live if we're still within the time slot, regardless of current status
    // (scheduled, missed, paused, completed - all can go live if time remains)
    const slotEndTime = slot.endTime.toMillis();
    if (now > slotEndTime) {
      console.error('[go-live] Slot time has passed:', { endTime: slotEndTime, now });
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Update slot to live status with DJ info and egress IDs
    const updateData: Record<string, string | null> = { status: 'live' };

    // Determine liveDjUsername based on login status and existing chatUsername
    // Rule: Logged-in users MUST use their chatUsername (or register a new one)
    if (djUserId) {
      // User is logged in - check if they have an existing chatUsername
      const userRef = db.collection('users').doc(djUserId);
      const userDoc = await userRef.get();
      const userData = userDoc.data();
      const existingChatUsername = userData?.chatUsername;

      // Extract DJ profile data for the slot
      const djBio = userData?.djProfile?.bio || null;
      const djPhotoUrl = userData?.djProfile?.photoUrl || null;
      const djPromoText = userData?.djProfile?.promoText || null;
      const djPromoHyperlink = userData?.djProfile?.promoHyperlink || null;

      if (existingChatUsername) {
        // User already has a chatUsername - use it (ignore form input)
        updateData.liveDjUsername = existingChatUsername;
        console.log('[go-live] Using existing chatUsername:', { djUserId, chatUsername: existingChatUsername });
      } else if (djUsername) {
        // User doesn't have chatUsername - must register the one they provided
        const normalizedHandle = djUsername.trim().replace(/\s+/g, '').toLowerCase();
        const usernameDocRef = db.collection('usernames').doc(normalizedHandle);
        const usernameDoc = await usernameDocRef.get();

        if (usernameDoc.exists && usernameDoc.data()?.uid !== djUserId) {
          // Username is taken by someone else - reject go-live
          console.error('[go-live] Username already taken:', { normalizedHandle, requestedBy: djUserId, ownedBy: usernameDoc.data()?.uid });
          return NextResponse.json({
            error: 'Username is already taken. Please choose a different username.',
            code: 'USERNAME_TAKEN'
          }, { status: 400 });
        }

        // Register the username for this user
        await usernameDocRef.set({
          displayName: djUsername.trim(),
          uid: djUserId,
          claimedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Save chatUsername to user profile
        await userRef.set({
          chatUsername: djUsername.trim(),
        }, { merge: true });

        updateData.liveDjUsername = djUsername.trim();
        console.log('[go-live] Registered new chatUsername:', { djUserId, chatUsername: djUsername.trim() });
      } else {
        // Logged in but no username provided - use a default
        updateData.liveDjUsername = 'DJ';
        console.log('[go-live] No username provided for logged-in user, using default');
      }

      updateData.liveDjUserId = djUserId;

      // Add DJ profile data to the slot
      if (djBio) {
        updateData.liveDjBio = djBio;
      }
      if (djPhotoUrl) {
        updateData.liveDjPhotoUrl = djPhotoUrl;
      }
      if (djPromoText) {
        updateData.liveDjPromoText = djPromoText;
      }
      if (djPromoHyperlink) {
        updateData.liveDjPromoHyperlink = djPromoHyperlink;
      }
    } else {
      // Guest/venue DJ - ephemeral username, no registration needed
      if (djUsername) {
        updateData.liveDjUsername = djUsername.trim();
      }
      console.log('[go-live] Guest/venue DJ with ephemeral username:', { djUsername });
    }

    if (egressId) {
      updateData.egressId = egressId;
    }
    if (recordingEgressId) {
      updateData.recordingEgressId = recordingEgressId;
      updateData.recordingStatus = 'recording';
    }

    await doc.ref.update(updateData);
    console.log('[go-live] ✅ Slot updated to live:', { slotId: doc.id, updateData });

    // If DJ is logged in, update lastSeenAt and reconcile any pending tips
    // Note: chatUsername registration is handled earlier in this function
    if (djUserId) {
      try {
        const userRef = db.collection('users').doc(djUserId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userEmail = userData?.email;

        // Update lastSeenAt and optionally save thankYouMessage to djProfile
        const userUpdate: Record<string, unknown> = {
          lastSeenAt: FieldValue.serverTimestamp(),
        };

        // Save thankYouMessage to djProfile if provided
        if (thankYouMessage && typeof thankYouMessage === 'string' && thankYouMessage.trim()) {
          userUpdate['djProfile.thankYouMessage'] = thankYouMessage.trim().slice(0, 200);
        }

        await userRef.set(userUpdate, { merge: true });

        // Reconcile any pending tips by email
        // This handles cases where tips were received before DJ logged in
        if (userEmail) {
          const pendingTipsByEmail = await db.collection('tips')
            .where('djEmail', '==', userEmail)
            .where('djUserId', '==', 'pending')
            .where('status', '==', 'succeeded')
            .get();

          if (!pendingTipsByEmail.empty) {
            console.log(`[go-live] Found ${pendingTipsByEmail.docs.length} pending tips to reconcile for ${userEmail}`);

            for (const tipDoc of pendingTipsByEmail.docs) {
              try {
                // Update djUserId and change status so it's ready for transfer when Stripe is linked
                await tipDoc.ref.update({
                  djUserId: djUserId,
                  payoutStatus: 'pending', // Ready for transfer when DJ links Stripe
                });
                console.log(`[go-live] ✅ Reconciled tip ${tipDoc.id} to DJ ${djUserId}`);
              } catch (tipError) {
                console.error(`[go-live] Failed to reconcile tip ${tipDoc.id}:`, tipError);
              }
            }
          }
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
