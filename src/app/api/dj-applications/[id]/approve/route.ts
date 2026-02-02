import { NextRequest, NextResponse } from 'next/server';
import { getApplication, updateApplicationStatus } from '@/lib/dj-applications';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { STATION_ID, BroadcastSlotSerialized } from '@/types/broadcast';

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST: Approve application and create broadcast slot
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { selectedSlot, createdBy } = body as {
      selectedSlot: { start: number; end: number };
      createdBy: string; // Admin's user ID
    };

    if (!selectedSlot || !selectedSlot.start || !selectedSlot.end) {
      return NextResponse.json({ error: 'Selected time slot is required' }, { status: 400 });
    }

    if (!createdBy) {
      return NextResponse.json({ error: 'Creator ID is required' }, { status: 400 });
    }

    // Get the application
    const application = await getApplication(id);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    if (application.status === 'approved') {
      return NextResponse.json({ error: 'Application already approved' }, { status: 400 });
    }

    // Create the broadcast slot using Admin SDK
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not initialized' }, { status: 500 });
    }

    // Look up user by email to get djUserId and profile info (if user exists)
    const usersSnapshot = await db.collection('users')
      .where('email', '==', application.email)
      .limit(1)
      .get();

    let djUserId: string | null = null;
    let djNameFromProfile: string | null = null;
    let liveDjBio: string | null = null;
    let liveDjPhotoUrl: string | null = null;

    if (!usersSnapshot.empty) {
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();
      djUserId = userDoc.id;
      djNameFromProfile = userData.chatUsername || userData.displayName || null;
      liveDjBio = userData.djProfile?.bio || null;
      liveDjPhotoUrl = userData.djProfile?.photoUrl || null;
      // Also assign DJ role
      await userDoc.ref.update({ role: 'dj' });
      console.log(`[approve] Found user ${djUserId} for ${application.email}, assigned DJ role, bio: ${!!liveDjBio}, photo: ${!!liveDjPhotoUrl}`);

      // Update watchlist entries that match this DJ's username
      // This ensures existing watchlist items get linked to the new DJ profile
      if (userData.chatUsernameNormalized) {
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
            if (termNormalized === userData.chatUsernameNormalized && !watchData.djUsername) {
              batch.update(watchDoc.ref, {
                djUsername: userData.chatUsername,
                djPhotoUrl: liveDjPhotoUrl || null,
                djName: userData.chatUsername,
              });
              watchlistUpdatedCount++;
            }
          }

          if (watchlistUpdatedCount > 0) {
            await batch.commit();
            console.log(`[approve] Updated ${watchlistUpdatedCount} watchlist entries for ${userData.chatUsername}`);
          }
        } catch (watchlistError) {
          // Log but don't fail - watchlist update is non-critical
          console.warn(`[approve] Could not update watchlist entries:`, watchlistError);
        }
      }
    } else {
      console.log(`[approve] No user found for ${application.email} - djUserId will be reconciled when user signs up`);
    }

    const broadcastToken = generateToken();
    const tokenExpiresAt = Timestamp.fromMillis(selectedSlot.end + 60 * 60 * 1000);

    const slotData: Record<string, unknown> = {
      stationId: STATION_ID,
      showName: application.showName,
      djName: djNameFromProfile || application.djName, // Use profile name if available
      djEmail: application.email, // Store DJ's email for matching/reconciliation
      djSlots: null,
      startTime: Timestamp.fromMillis(selectedSlot.start),
      endTime: Timestamp.fromMillis(selectedSlot.end),
      broadcastToken,
      tokenExpiresAt,
      createdAt: Timestamp.now(),
      createdBy,
      status: 'scheduled',
      broadcastType: application.locationType === 'venue' ? 'venue' : 'remote',
    };

    // Set DJ profile info if user exists
    if (djUserId) {
      slotData.djUserId = djUserId;
    }
    if (liveDjBio) {
      slotData.liveDjBio = liveDjBio;
    }
    if (liveDjPhotoUrl) {
      slotData.liveDjPhotoUrl = liveDjPhotoUrl;
    }

    const docRef = await db.collection('broadcast-slots').add(slotData);

    const slot: BroadcastSlotSerialized = {
      id: docRef.id,
      stationId: STATION_ID,
      showName: application.showName,
      djName: djNameFromProfile || application.djName,
      djUserId: djUserId || undefined,
      djEmail: application.email,
      startTime: selectedSlot.start,
      endTime: selectedSlot.end,
      broadcastToken,
      tokenExpiresAt: tokenExpiresAt.toMillis(),
      createdAt: Date.now(),
      createdBy,
      status: 'scheduled',
      broadcastType: application.locationType === 'venue' ? 'venue' : 'remote',
      liveDjBio: liveDjBio || undefined,
      liveDjPhotoUrl: liveDjPhotoUrl || undefined,
    };

    const broadcastUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/live?token=${broadcastToken}`;

    // Update application status
    await updateApplicationStatus(id, 'approved', {
      scheduledSlotId: slot.id,
    });

    return NextResponse.json({
      success: true,
      slot,
      broadcastUrl,
      application: {
        ...application,
        status: 'approved',
        scheduledSlotId: slot.id,
      },
    });
  } catch (error) {
    console.error('Error approving DJ application:', error);
    return NextResponse.json({ error: 'Failed to approve application' }, { status: 500 });
  }
}
