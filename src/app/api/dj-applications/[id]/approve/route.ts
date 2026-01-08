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

    // Look up user by email to get djUserId (if user exists)
    const usersSnapshot = await db.collection('users')
      .where('email', '==', application.email)
      .limit(1)
      .get();

    let djUserId: string | null = null;
    if (!usersSnapshot.empty) {
      const userDoc = usersSnapshot.docs[0];
      djUserId = userDoc.id;
      // Also assign DJ role
      await userDoc.ref.update({ role: 'dj' });
      console.log(`[approve] Found user ${djUserId} for ${application.email}, assigned DJ role`);
    } else {
      console.log(`[approve] No user found for ${application.email} - djUserId will be reconciled when user signs up`);
    }

    const broadcastToken = generateToken();
    const tokenExpiresAt = Timestamp.fromMillis(selectedSlot.end + 60 * 60 * 1000);

    const slotData: Record<string, unknown> = {
      stationId: STATION_ID,
      showName: application.showName,
      djName: application.djName,
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

    // Set djUserId if user exists
    if (djUserId) {
      slotData.djUserId = djUserId;
    }

    const docRef = await db.collection('broadcast-slots').add(slotData);

    const slot: BroadcastSlotSerialized = {
      id: docRef.id,
      stationId: STATION_ID,
      showName: application.showName,
      djName: application.djName,
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
