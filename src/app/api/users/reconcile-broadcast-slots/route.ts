import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface DJSlot {
  id: string;
  djName?: string;
  djEmail?: string;
  djUserId?: string;
  djUsername?: string;
  djBio?: string;
  djPhotoUrl?: string;
  djPromoText?: string;
  djPromoHyperlink?: string;
  djThankYouMessage?: string;
  djSocialLinks?: {
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
  };
  startTime: number;
  endTime: number;
}

// POST - Reconcile broadcast slots and tips when a DJ user is created
// Called when a user is created - checks if they have approved DJ slots and assigns DJ role
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { userId, email } = body;

    if (!userId || !email) {
      return NextResponse.json({ error: 'userId and email are required' }, { status: 400 });
    }

    console.log(`[reconcile] Starting reconciliation for user ${userId} (${email})`);

    let slotsUpdated = 0;
    let djSlotsUpdated = 0;
    let tipsUpdated = 0;
    let djRoleAssigned = false;

    // Get user's profile to fill in DJ slot data
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const djProfile = userData?.djProfile || {};

    // Find broadcast slots where djEmail matches (remote broadcasts)
    const slotsSnapshot = await db.collection('broadcast-slots')
      .where('djEmail', '==', email)
      .get();

    for (const slotDoc of slotsSnapshot.docs) {
      const slotData = slotDoc.data();

      // Only update if djUserId is not already set
      if (!slotData.djUserId) {
        await slotDoc.ref.update({ djUserId: userId });
        slotsUpdated++;
        console.log(`[reconcile] Updated slot ${slotDoc.id} with djUserId ${userId}`);
      }
    }

    // Also find venue broadcasts that might have DJ slots with this email
    // We need to scan all venue broadcasts and check their djSlots array
    const venueSnapshot = await db.collection('broadcast-slots')
      .where('broadcastType', '==', 'venue')
      .get();

    for (const slotDoc of venueSnapshot.docs) {
      const slotData = slotDoc.data();
      const djSlots = slotData.djSlots as DJSlot[] | undefined;

      if (!djSlots || !Array.isArray(djSlots)) continue;

      // Check if any DJ slot has this email but no userId
      let updated = false;
      const updatedDjSlots = djSlots.map((dj: DJSlot) => {
        if (dj.djEmail === email && !dj.djUserId) {
          updated = true;
          djSlotsUpdated++;
          return {
            ...dj,
            djUserId: userId,
            djUsername: userData?.chatUsername || dj.djUsername,
            djBio: djProfile.bio || dj.djBio,
            djPhotoUrl: djProfile.photoUrl || dj.djPhotoUrl,
            djPromoText: djProfile.promoText || dj.djPromoText,
            djPromoHyperlink: djProfile.promoHyperlink || dj.djPromoHyperlink,
            djThankYouMessage: djProfile.thankYouMessage || dj.djThankYouMessage,
            djSocialLinks: djProfile.socialLinks || dj.djSocialLinks,
            // Also update djName if not already set
            djName: dj.djName || userData?.chatUsername || userData?.displayName,
          };
        }
        return dj;
      });

      if (updated) {
        await slotDoc.ref.update({ djSlots: updatedDjSlots });
        console.log(`[reconcile] Updated DJ slots in venue broadcast ${slotDoc.id}`);
      }
    }

    // If user has any broadcast slots or DJ slots, assign DJ role if they don't have a higher role
    if (slotsSnapshot.size > 0 || djSlotsUpdated > 0) {
      const currentRole = userData?.role;
      if (!currentRole || currentRole === 'user') {
        await db.collection('users').doc(userId).update({ role: 'dj' });
        djRoleAssigned = true;
        console.log(`[reconcile] Assigned DJ role to user ${userId}`);
      }
    }

    // Also reconcile pending tips (where djUserId is 'pending' but djEmail matches)
    const pendingTipsSnapshot = await db.collection('tips')
      .where('djEmail', '==', email)
      .where('djUserId', '==', 'pending')
      .where('status', '==', 'succeeded')
      .get();

    for (const tipDoc of pendingTipsSnapshot.docs) {
      await tipDoc.ref.update({
        djUserId: userId,
        payoutStatus: 'pending', // Ready for transfer when DJ links Stripe
      });
      tipsUpdated++;
      console.log(`[reconcile] Updated tip ${tipDoc.id} with djUserId ${userId}`);
    }

    // Check for pending DJ role assignments (from studio/join applications)
    const pendingDJRoleSnapshot = await db.collection('pending-dj-roles')
      .where('email', '==', email.toLowerCase())
      .get();

    if (!pendingDJRoleSnapshot.empty && !djRoleAssigned) {
      const currentRole = userData?.role;
      if (!currentRole || currentRole === 'user') {
        // Get the djTermsAcceptedAt from the pending record
        const pendingData = pendingDJRoleSnapshot.docs[0].data();
        const updateData: { role: string; djTermsAcceptedAt?: FirebaseFirestore.Timestamp } = { role: 'dj' };
        if (pendingData.djTermsAcceptedAt) {
          updateData.djTermsAcceptedAt = pendingData.djTermsAcceptedAt;
        }
        await db.collection('users').doc(userId).update(updateData);
        djRoleAssigned = true;
        console.log(`[reconcile] Assigned DJ role to user ${userId} from pending-dj-roles`);
      }

      // Delete the pending record(s)
      for (const doc of pendingDJRoleSnapshot.docs) {
        await doc.ref.delete();
        console.log(`[reconcile] Deleted pending-dj-role ${doc.id}`);
      }
    }

    // Check for pending DJ profiles (pre-registered DJs who haven't signed up yet)
    let pendingProfileClaimed = false;
    const pendingProfilesSnapshot = await db.collection('pending-dj-profiles')
      .where('email', '==', email.toLowerCase())
      .where('status', '==', 'pending')
      .get();

    for (const pendingDoc of pendingProfilesSnapshot.docs) {
      const pendingData = pendingDoc.data();

      // Transfer profile data to user document
      const profileUpdate: Record<string, unknown> = {
        chatUsername: pendingData.chatUsername,
        chatUsernameNormalized: pendingData.chatUsernameNormalized,
        role: 'dj',
      };

      if (pendingData.djProfile) {
        profileUpdate.djProfile = pendingData.djProfile;
      }

      await db.collection('users').doc(userId).update(profileUpdate);
      djRoleAssigned = true;
      pendingProfileClaimed = true;

      // Update username reservation to point to real user
      const normalizedUsername = pendingData.chatUsernameNormalized;
      const usernameRef = db.collection('usernames').doc(normalizedUsername);
      const usernameDoc = await usernameRef.get();

      if (usernameDoc.exists) {
        await usernameRef.update({
          uid: userId,
          reservedForEmail: FieldValue.delete(),
          isPending: FieldValue.delete(),
        });
        console.log(`[reconcile] Updated username ${normalizedUsername} to point to user ${userId}`);
      }

      // Mark pending profile as claimed
      await pendingDoc.ref.update({
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        claimedByUserId: userId,
      });

      console.log(`[reconcile] Claimed pending DJ profile ${pendingDoc.id} for user ${userId}`);

      // Update all watchlist entries that match this DJ's username
      // This ensures existing watchlist items get linked to the new DJ profile
      try {
        const watchlistSnapshot = await db.collectionGroup('favorites')
          .where('type', '==', 'search')
          .get();

        let watchlistUpdatedCount = 0;
        const batch = db.batch();

        for (const watchDoc of watchlistSnapshot.docs) {
          const watchData = watchDoc.data();
          const term = (watchData.term || '').toLowerCase();
          const termNormalized = term.replace(/[\s-]+/g, '');

          // Check if this watchlist term matches the new DJ's username
          if (termNormalized === normalizedUsername && !watchData.djUsername) {
            batch.update(watchDoc.ref, {
              djUsername: pendingData.chatUsername,
              djPhotoUrl: pendingData.djProfile?.photoUrl || null,
              djName: pendingData.chatUsername,
            });
            watchlistUpdatedCount++;
          }
        }

        if (watchlistUpdatedCount > 0) {
          await batch.commit();
          console.log(`[reconcile] Updated ${watchlistUpdatedCount} watchlist entries for ${pendingData.chatUsername}`);
        }
      } catch (watchlistError) {
        // Log but don't fail - watchlist update is non-critical
        console.warn(`[reconcile] Could not update watchlist entries:`, watchlistError);
      }
    }

    console.log(`[reconcile] Completed: ${slotsUpdated} slots, ${djSlotsUpdated} DJ slots, ${tipsUpdated} tips updated, djRole=${djRoleAssigned}, pendingProfileClaimed=${pendingProfileClaimed} for ${email}`);

    return NextResponse.json({
      success: true,
      slotsUpdated,
      djSlotsUpdated,
      tipsUpdated,
      djRoleAssigned,
    });
  } catch (error) {
    console.error('[reconcile] Error:', error);
    return NextResponse.json({ error: 'Failed to reconcile broadcast slots' }, { status: 500 });
  }
}
