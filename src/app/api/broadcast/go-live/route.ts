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

    // Look up the slot by token — check broadcast-slots first, then studio-sessions
    let snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      snapshot = await db.collection('studio-sessions')
        .where('broadcastToken', '==', broadcastToken)
        .limit(1)
        .get();
    }

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

      // If we still haven't resolved a DJ profile from the slot's djUserId /
      // djEmail, look up by the chat username explicitly attached to this
      // broadcast — either pre-configured on the slot (currentDjSlot) or
      // typed into the go-live form (djUsername arg). Checks both the
      // `users` collection and `pending-dj-profiles` (admin-created DJs
      // who haven't claimed an account yet). Do NOT fall back to the
      // logged-in user's own chatUsername: we should not publish a
      // different person's DJ profile just because they happened to be
      // authenticated in the browser.
      if (!slotDjProfile) {
        const candidateUsername = currentDjSlot?.djUsername || (djUsername && djUsername.trim()) || null;
        if (candidateUsername) {
          const normalized = candidateUsername.toString().replace(/\s+/g, '').toLowerCase();
          const byUsernameSnap = await db.collection('users')
            .where('chatUsernameNormalized', '==', normalized)
            .limit(1)
            .get();
          if (!byUsernameSnap.empty) {
            const byUsernameData = byUsernameSnap.docs[0].data();
            slotDjProfile = (byUsernameData?.djProfile as Record<string, unknown> | null) || null;
            slotDjChatUsername = byUsernameData?.chatUsername || slotDjChatUsername;
            resolvedSlotDjUserId = resolvedSlotDjUserId || byUsernameSnap.docs[0].id;
            console.log('[go-live] Resolved DJ by chatUsername (users):', { candidateUsername, resolvedSlotDjUserId, hasProfile: !!slotDjProfile });
          } else {
            const byPendingSnap = await db.collection('pending-dj-profiles')
              .where('chatUsernameNormalized', '==', normalized)
              .limit(1)
              .get();
            if (!byPendingSnap.empty) {
              const byPendingData = byPendingSnap.docs[0].data();
              slotDjProfile = (byPendingData?.djProfile as Record<string, unknown> | null) || null;
              slotDjChatUsername = slotDjChatUsername || byPendingData?.chatUsername || byPendingData?.username || null;
              // Don't set resolvedSlotDjUserId — pending profiles aren't real user UIDs.
              console.log('[go-live] Resolved DJ by chatUsername (pending):', { candidateUsername, hasProfile: !!slotDjProfile });
            }
          }
        }
      }

      // Extract DJ profile data - PRIORITY: DJ slot config > resolved DJ profile.
      // `slotDjProfile` now covers three lookup paths: slot's djUserId, slot's
      // djEmail, or the broadcaster's chatUsername. We intentionally do not
      // fall back to the logged-in user's profile — if none of those paths
      // resolve, leave these null rather than publish info for a different
      // person than the slot's DJ.
      const profileData = slotDjProfile as Record<string, unknown> | null;
      const djBio = currentDjSlot?.djBio || profileData?.bio || null;
      const djPhotoUrl = currentDjSlot?.djPhotoUrl || profileData?.photoUrl || null;
      const djTipButtonLink = currentDjSlot?.djTipButtonLink || profileData?.tipButtonLink || null;
      const djBandcamp = currentDjSlot?.djSocialLinks?.bandcamp || (profileData?.socialLinks as Record<string, unknown> | null)?.bandcamp || null;
      const djThankYouMessage = currentDjSlot?.djThankYouMessage || profileData?.thankYouMessage || null;
      const djGenres = (profileData?.genres as string[] | undefined) || null;
      const djShowImageUrl = profileData?.photoUrl || null;

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
      if (djTipButtonLink) {
        updateData.liveDjTipButtonLink = djTipButtonLink;
      }
      if (djBandcamp) {
        updateData.liveDjBandcamp = djBandcamp;
      }
      if (djThankYouMessage) {
        updateData.liveDjThankYouMessage = djThankYouMessage;
      }
      if (djGenres && djGenres.length > 0) {
        updateData.liveDjGenres = djGenres;
      }
      if (djShowImageUrl && !slot.showImageUrl) {
        updateData.showImageUrl = djShowImageUrl;
      }
    } else {
      // Guest/venue DJ - not logged in, but may have a profile via email or
      // via pending-dj-profiles (admin-created DJs who haven't claimed an
      // account yet).
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
        } else {
          const pendingByEmailSnapshot = await db.collection('pending-dj-profiles')
            .where('email', '==', djEmail)
            .limit(1)
            .get();
          if (!pendingByEmailSnapshot.empty) {
            userProfileData = pendingByEmailSnapshot.docs[0].data();
            console.log('[go-live] Found pending DJ profile by email:', { djEmail, hasProfile: !!userProfileData?.djProfile });
          }
        }
      }

      // Still nothing? Try looking up by chatUsername in users then pending-dj-profiles.
      if (!userProfileData) {
        const candidateUsername = currentDjSlot?.djUsername || (djUsername && djUsername.trim()) || null;
        if (candidateUsername) {
          const normalized = candidateUsername.toString().replace(/\s+/g, '').toLowerCase();
          const byUsernameSnap = await db.collection('users')
            .where('chatUsernameNormalized', '==', normalized)
            .limit(1)
            .get();
          if (!byUsernameSnap.empty) {
            foundUserId = byUsernameSnap.docs[0].id;
            userProfileData = byUsernameSnap.docs[0].data();
            console.log('[go-live] Guest: resolved DJ by chatUsername (users):', { candidateUsername, foundUserId });
          } else {
            const pendingByUsernameSnap = await db.collection('pending-dj-profiles')
              .where('chatUsernameNormalized', '==', normalized)
              .limit(1)
              .get();
            if (!pendingByUsernameSnap.empty) {
              userProfileData = pendingByUsernameSnap.docs[0].data();
              console.log('[go-live] Guest: resolved DJ by chatUsername (pending):', { candidateUsername });
            }
          }
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

      // Set profile data - priority: DJ slot config > resolved profile
      const djProfile = userProfileData?.djProfile as Record<string, unknown> | undefined;
      const djBio = currentDjSlot?.djBio || djProfile?.bio || null;
      const djPhotoUrl = currentDjSlot?.djPhotoUrl || djProfile?.photoUrl || null;
      const djTipButtonLink = currentDjSlot?.djTipButtonLink || djProfile?.tipButtonLink || null;
      const djBandcamp = currentDjSlot?.djSocialLinks?.bandcamp || (djProfile?.socialLinks as Record<string, unknown> | undefined)?.bandcamp || null;
      const djThankYouMessage = currentDjSlot?.djThankYouMessage || djProfile?.thankYouMessage || null;
      const djGenresGuest = (djProfile?.genres as string[] | undefined) || null;
      const djShowImageUrlGuest = djProfile?.photoUrl || null;

      if (djBio) {
        updateData.liveDjBio = djBio;
      }
      if (djPhotoUrl) {
        updateData.liveDjPhotoUrl = djPhotoUrl;
      }
      if (djTipButtonLink) {
        updateData.liveDjTipButtonLink = djTipButtonLink;
      }
      if (djBandcamp) {
        updateData.liveDjBandcamp = djBandcamp;
      }
      if (djThankYouMessage) {
        updateData.liveDjThankYouMessage = djThankYouMessage;
      }
      if (djGenresGuest && djGenresGuest.length > 0) {
        updateData.liveDjGenres = djGenresGuest;
      }
      if (djShowImageUrlGuest && !slot.showImageUrl) {
        updateData.showImageUrl = djShowImageUrlGuest;
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

      // Recording sessions live in studio-sessions and must never touch the /radio
      // live slot. Only DJ→DJ transitions on broadcast-slots should sweep the
      // previous live slot. On 2026-04-02 a recording going live flipped the
      // on-air DJ's broadcast-slots status to 'completed', vanishing /radio.
      const isRecordingSession = doc.ref.parent.id === 'studio-sessions';

      const batch = db.batch();

      if (!isRecordingSession) {
        // DJ→DJ transition: atomically complete any other live slots so
        // listeners never see an empty "no live slot" window.
        const otherLiveSlots = await db.collection('broadcast-slots')
          .where('status', '==', 'live')
          .get();
        for (const otherDoc of otherLiveSlots.docs) {
          if (otherDoc.id !== doc.id) {
            batch.update(otherDoc.ref, { status: 'completed' });
            console.log('[go-live] Completing previous live slot in batch:', otherDoc.id);
          }
        }
      } else {
        console.log('[go-live] Recording session — skipping broadcast-slots sweep');
      }

      batch.update(doc.ref, updateData);
      await batch.commit();

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
