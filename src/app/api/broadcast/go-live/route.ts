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
    const updateData: Record<string, unknown> = { status: 'live' };

    // Find current DJ slot for venue broadcasts (use its pre-configured profile data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentDjSlot: any = null;
    if (slot.djSlots && slot.djSlots.length > 0) {
      currentDjSlot = slot.djSlots.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (djSlot: any) => {
          const slotStart = typeof djSlot.startTime === 'number' ? djSlot.startTime : djSlot.startTime?.toMillis?.() || 0;
          const slotEnd = typeof djSlot.endTime === 'number' ? djSlot.endTime : djSlot.endTime?.toMillis?.() || 0;
          return slotStart <= now && slotEnd > now;
        }
      );
      if (currentDjSlot) {
        console.log('[go-live] Found current DJ slot:', { djSlotId: currentDjSlot.id, djName: currentDjSlot.djName, djUsername: currentDjSlot.djUsername });
      }
    }

    // Determine liveDjUsername based on login status and existing chatUsername
    // Rule: Use the slot's linked DJ profile, falling back to the logged-in user
    if (djUserId) {
      // User is logged in - get their profile
      const userRef = db.collection('users').doc(djUserId);
      const userDoc = await userRef.get();
      const userData = userDoc.data();
      const existingChatUsername = userData?.chatUsername;

      // Look up the slot's linked DJ profile (may differ from the logged-in user)
      // The slot links to a DJ by djUserId or djEmail — use that profile for broadcast info
      let slotDjProfile: Record<string, unknown> | null = null;
      let slotDjChatUsername: string | null = null;
      let resolvedSlotDjUserId: string | null = null;
      const slotDjUserId = slot.djUserId;
      const slotDjEmail = slot.djEmail;

      if (slotDjUserId && slotDjUserId === djUserId) {
        // Slot's DJ is the logged-in user — use their already-fetched profile
        slotDjProfile = userData?.djProfile || null;
        slotDjChatUsername = userData?.chatUsername || null;
        resolvedSlotDjUserId = slotDjUserId;
      } else if (slotDjUserId) {
        // Slot's DJ is different from the logged-in user — look up their profile
        const slotDjDoc = await db.collection('users').doc(slotDjUserId).get();
        if (slotDjDoc.exists) {
          const slotDjData = slotDjDoc.data();
          slotDjProfile = slotDjData?.djProfile || null;
          slotDjChatUsername = slotDjData?.chatUsername || null;
          resolvedSlotDjUserId = slotDjUserId;
          console.log('[go-live] Found slot DJ profile by userId:', { slotDjUserId, chatUsername: slotDjChatUsername });
        }
      } else if (slotDjEmail && !slotDjProfile) {
        // Try looking up by email
        const slotDjByEmail = await db.collection('users')
          .where('email', '==', slotDjEmail)
          .limit(1)
          .get();
        if (!slotDjByEmail.empty) {
          const slotDjData = slotDjByEmail.docs[0].data();
          slotDjProfile = slotDjData?.djProfile || null;
          slotDjChatUsername = slotDjData?.chatUsername || null;
          resolvedSlotDjUserId = slotDjByEmail.docs[0].id;
          console.log('[go-live] Found slot DJ profile by email:', { slotDjEmail, resolvedSlotDjUserId, chatUsername: slotDjChatUsername });
        }
      }

      // Extract DJ profile data - PRIORITY: DJ slot config > slot's linked DJ profile
      // Do NOT fall back to logged-in user's profile — they may be a different person than the slot's DJ
      const djBio = currentDjSlot?.djBio || (slotDjProfile as Record<string, unknown> | null)?.bio || null;
      const djPhotoUrl = currentDjSlot?.djPhotoUrl || (slotDjProfile as Record<string, unknown> | null)?.photoUrl || null;
      const djPromoText = currentDjSlot?.djPromoText || currentDjSlot?.promoText || (slotDjProfile as Record<string, unknown> | null)?.promoText || null;
      const djPromoHyperlink = currentDjSlot?.djPromoHyperlink || currentDjSlot?.promoHyperlink || (slotDjProfile as Record<string, unknown> | null)?.promoHyperlink || null;
      const djThankYouMessage = currentDjSlot?.djThankYouMessage || (slotDjProfile as Record<string, unknown> | null)?.thankYouMessage || null;

      // For username: DJ slot > slot's linked DJ chatUsername > form input (from slot-dj-profile) > logged-in user chatUsername
      const slotUsername = currentDjSlot?.djUsername || currentDjSlot?.djName;

      if (slotUsername) {
        // Venue broadcast: use the pre-configured DJ slot username
        updateData.liveDjUsername = slotUsername;
        console.log('[go-live] Using DJ slot username:', { djUserId, slotUsername });
      } else if (slotDjChatUsername) {
        // Slot's linked DJ has a chatUsername — use it
        updateData.liveDjUsername = slotDjChatUsername;
        console.log('[go-live] Using slot DJ chatUsername:', { slotDjChatUsername });
      } else if (djUsername) {
        // Use the DJ name from the form (pre-populated from slot-dj-profile)
        updateData.liveDjUsername = djUsername.trim();
        console.log('[go-live] Using form djUsername:', { djUsername: djUsername.trim() });
      } else if (existingChatUsername) {
        // Last resort: fall back to logged-in user's chatUsername
        updateData.liveDjUsername = existingChatUsername;
        console.log('[go-live] Using logged-in user chatUsername:', { djUserId, chatUsername: existingChatUsername });
      } else {
        // Logged in but no username provided - use a default
        updateData.liveDjUsername = 'DJ';
        console.log('[go-live] No username provided, using default');
      }

      // If the logged-in user doesn't have a chatUsername yet, register the one from the form
      if (!existingChatUsername && djUsername) {
        const normalizedHandle = djUsername.trim().replace(/\s+/g, '').toLowerCase();
        const usernameDocRef = db.collection('usernames').doc(normalizedHandle);
        const usernameDoc = await usernameDocRef.get();

        if (!usernameDoc.exists || usernameDoc.data()?.uid === djUserId) {
          await usernameDocRef.set({
            displayName: djUsername.trim(),
            uid: djUserId,
            claimedAt: FieldValue.serverTimestamp(),
          }, { merge: true });

          await userRef.set({
            chatUsername: djUsername.trim(),
          }, { merge: true });
          console.log('[go-live] Registered chatUsername for logged-in user:', { djUserId, chatUsername: djUsername.trim() });
        }
      }

      // Use the slot's linked DJ userId if available, otherwise the logged-in user
      updateData.liveDjUserId = resolvedSlotDjUserId || djUserId;

      // Set chatUsername for profile URL — prioritize slot's linked DJ
      if (slotDjChatUsername) {
        updateData.liveDjChatUsername = slotDjChatUsername;
      } else if (djUsername) {
        updateData.liveDjChatUsername = djUsername.trim();
      } else if (existingChatUsername) {
        updateData.liveDjChatUsername = existingChatUsername;
      }

      // Add DJ profile data to the slot (from DJ slot config or user profile)
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
      if (djThankYouMessage) {
        updateData.liveDjThankYouMessage = djThankYouMessage;
      }
    } else {
      // Guest/venue DJ - not logged in, but may have a profile via email
      // Try to look up user by DJ slot email or root slot email
      const djEmail = currentDjSlot?.djEmail || slot.djEmail;
      let userProfileData: Record<string, unknown> | null = null;
      let foundUserId: string | null = null;

      if (djEmail) {
        const userByEmailSnapshot = await db.collection('users')
          .where('email', '==', djEmail)
          .limit(1)
          .get();

        if (!userByEmailSnapshot.empty) {
          foundUserId = userByEmailSnapshot.docs[0].id;
          userProfileData = userByEmailSnapshot.docs[0].data();
          console.log('[go-live] Found user profile by email:', { djEmail, foundUserId, hasProfile: !!userProfileData?.djProfile });
        }
      }

      // Use DJ slot username if available, otherwise use form input
      const slotUsername = currentDjSlot?.djUsername || currentDjSlot?.djName;
      if (slotUsername) {
        updateData.liveDjUsername = slotUsername;
      } else if (userProfileData?.chatUsername) {
        updateData.liveDjUsername = userProfileData.chatUsername;
      } else if (djUsername) {
        updateData.liveDjUsername = djUsername.trim();
      }

      // Set profile data - priority: DJ slot config > user profile by email
      const djProfile = userProfileData?.djProfile as Record<string, unknown> | undefined;
      const djBio = currentDjSlot?.djBio || djProfile?.bio || null;
      const djPhotoUrl = currentDjSlot?.djPhotoUrl || djProfile?.photoUrl || null;
      const djPromoText = currentDjSlot?.djPromoText || currentDjSlot?.promoText || djProfile?.promoText || null;
      const djPromoHyperlink = currentDjSlot?.djPromoHyperlink || currentDjSlot?.promoHyperlink || djProfile?.promoHyperlink || null;
      const djThankYouMessage = currentDjSlot?.djThankYouMessage || djProfile?.thankYouMessage || null;

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
      if (djThankYouMessage) {
        updateData.liveDjThankYouMessage = djThankYouMessage;
      }

      // Also set liveDjUserId and chatUsername if we found a user by email (for profile button linking)
      if (foundUserId) {
        updateData.liveDjUserId = foundUserId;
      }
      if (userProfileData?.chatUsername) {
        updateData.liveDjChatUsername = userProfileData.chatUsername;
      }

      console.log('[go-live] Guest/venue DJ:', { djUsername: updateData.liveDjUsername, djEmail, hasUserProfile: !!userProfileData, liveDjUserId: updateData.liveDjUserId, liveDjChatUsername: updateData.liveDjChatUsername });
    }

    if (egressId) {
      updateData.egressId = egressId;
    }
    if (recordingEgressId) {
      // Legacy fields for backward compatibility
      updateData.recordingEgressId = recordingEgressId;
      updateData.recordingStatus = 'recording';

      // Create new recording entry for the recordings array
      const newRecording = {
        egressId: recordingEgressId,
        status: 'recording',
        startedAt: Date.now(),
      };

      // Get current recordings array and append the new one
      // Handle case where existing recordings might have Firestore Timestamps
      // Also filter out undefined values (Firestore doesn't accept undefined)
      const currentRecordings = (slot.recordings || []).map((rec: { egressId: string; url?: string; status: string; duration?: number; startedAt: number | { toMillis: () => number }; endedAt?: number | { toMillis: () => number } }) => {
        const cleanRec: Record<string, unknown> = {
          egressId: rec.egressId,
          status: rec.status,
          startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : rec.startedAt?.toMillis?.() || Date.now(),
        };
        if (rec.url) cleanRec.url = rec.url;
        if (rec.duration !== undefined) cleanRec.duration = rec.duration;
        if (rec.endedAt) {
          cleanRec.endedAt = typeof rec.endedAt === 'number' ? rec.endedAt : rec.endedAt?.toMillis?.();
        }
        return cleanRec;
      });
      updateData.recordings = [...currentRecordings, newRecording];
      console.log('[go-live] Recordings array:', { existing: currentRecordings.length, new: newRecording.egressId, recordings: updateData.recordings });

      // Create egress-to-slot mapping for webhook lookup
      // This allows the webhook to find the slot even with multiple recordings
      try {
        await db.collection('recording-egress-map').doc(recordingEgressId).set({
          slotId: doc.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log('[go-live] Created egress-to-slot mapping:', { egressId: recordingEgressId, slotId: doc.id });
      } catch (mapError) {
        console.error('[go-live] Failed to create egress mapping (non-fatal):', mapError);
      }
    }

    try {
      console.log('[go-live] Attempting Firestore update with data:', JSON.stringify(updateData, null, 2));
      await doc.ref.update(updateData);
      console.log('[go-live] ✅ Slot updated to live:', { slotId: doc.id });
    } catch (updateError) {
      console.error('[go-live] ❌ Firestore update failed:', updateError);
      return NextResponse.json({ error: 'Failed to update slot status' }, { status: 500 });
    }

    // If DJ is logged in, update lastSeenAt and reconcile any pending tips
    // Note: chatUsername registration is handled earlier in this function
    if (djUserId) {
      try {
        const userRef = db.collection('users').doc(djUserId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const userEmail = userData?.email;

        // Update lastSeenAt for the logged-in user
        await userRef.set({ lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });

        // Save thankYouMessage to the slot's linked DJ profile (not the logged-in user)
        if (thankYouMessage && typeof thankYouMessage === 'string' && thankYouMessage.trim()) {
          const slotDjId = slot.djUserId;
          if (slotDjId) {
            try {
              await db.collection('users').doc(slotDjId).set({
                'djProfile.thankYouMessage': thankYouMessage.trim().slice(0, 200),
              }, { merge: true });
            } catch (err) {
              console.error('[go-live] Failed to save thankYouMessage to slot DJ profile:', err);
            }
          }
        }

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
