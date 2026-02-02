import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

// POST - Mark an email as pending DJ role assignment
// Called when someone submits a DJ application without being logged in
// When they later create an account, the role will be assigned via reconciliation
// Also handles upgrading existing users to DJ and claiming any pending DJ profiles
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // First check if user already exists with this email
    const usersSnapshot = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      // User exists - assign DJ role and claim any pending DJ profile
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();
      const currentRole = userData.role;
      const userId = userDoc.id;
      let pendingProfileClaimed = false;

      // Build the update object
      const updateData: Record<string, unknown> = {};

      // Only upgrade role if they don't have a higher role
      if (!currentRole || currentRole === 'user') {
        updateData.role = 'dj';
        updateData.djTermsAcceptedAt = Timestamp.now();
      }

      // Check for pending DJ profiles and claim them
      const pendingProfilesSnapshot = await db.collection('pending-dj-profiles')
        .where('email', '==', normalizedEmail)
        .where('status', '==', 'pending')
        .get();

      for (const pendingDoc of pendingProfilesSnapshot.docs) {
        const pendingData = pendingDoc.data();

        // Transfer profile data to user document
        if (pendingData.chatUsername) {
          updateData.chatUsername = pendingData.chatUsername;
        }
        if (pendingData.chatUsernameNormalized) {
          updateData.chatUsernameNormalized = pendingData.chatUsernameNormalized;
        }
        if (pendingData.djProfile) {
          updateData.djProfile = pendingData.djProfile;
        }
        updateData.role = 'dj'; // Ensure DJ role is set

        // Update username reservation to point to real user
        const normalizedUsername = pendingData.chatUsernameNormalized;
        if (normalizedUsername) {
          const usernameRef = db.collection('usernames').doc(normalizedUsername);
          const usernameDoc = await usernameRef.get();

          if (usernameDoc.exists) {
            await usernameRef.update({
              uid: userId,
              reservedForEmail: FieldValue.delete(),
              isPending: FieldValue.delete(),
            });
            console.log(`[assign-dj-role] Updated username ${normalizedUsername} to point to user ${userId}`);
          }
        }

        // Mark pending profile as claimed
        await pendingDoc.ref.update({
          status: 'claimed',
          claimedAt: FieldValue.serverTimestamp(),
          claimedByUserId: userId,
        });

        pendingProfileClaimed = true;
        console.log(`[assign-dj-role] Claimed pending DJ profile ${pendingDoc.id} for user ${userId}`);

        // Update watchlist entries that match this DJ's username
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
            console.log(`[assign-dj-role] Updated ${watchlistUpdatedCount} watchlist entries for ${pendingData.chatUsername}`);
          }
        } catch (watchlistError) {
          // Log but don't fail - watchlist update is non-critical
          console.warn(`[assign-dj-role] Could not update watchlist entries:`, watchlistError);
        }
      }

      // Apply all updates to user document
      if (Object.keys(updateData).length > 0) {
        await userDoc.ref.update(updateData);
        console.log(`[assign-dj-role] Updated user ${userId} (${normalizedEmail}): role=${updateData.role}, pendingProfileClaimed=${pendingProfileClaimed}`);
      }

      return NextResponse.json({ success: true, existingUser: true, pendingProfileClaimed });
    }

    // User doesn't exist - store in pending-dj-roles for future reconciliation
    // Check if already pending
    const pendingSnapshot = await db.collection('pending-dj-roles')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (pendingSnapshot.empty) {
      await db.collection('pending-dj-roles').add({
        email: normalizedEmail,
        createdAt: Timestamp.now(),
        source: 'studio-join-application',
        djTermsAcceptedAt: Timestamp.now(),
      });
      console.log(`[assign-dj-role] Created pending DJ role for ${normalizedEmail}`);
    } else {
      console.log(`[assign-dj-role] Pending DJ role already exists for ${normalizedEmail}`);
    }

    return NextResponse.json({ success: true, pendingCreated: true });
  } catch (error) {
    console.error('[assign-dj-role] Error:', error);
    return NextResponse.json({ error: 'Failed to assign DJ role' }, { status: 500 });
  }
}
