import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { BroadcastSlot, BroadcastSlotSerialized, STATION_ID } from '@/types/broadcast';

// Hardcoded owner UID for now - replace with proper auth later
const OWNER_UID = process.env.BROADCAST_OWNER_UID || '';

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function serializeSlot(slot: BroadcastSlot): BroadcastSlotSerialized {
  return {
    ...slot,
    startTime: slot.startTime.toMillis(),
    endTime: slot.endTime.toMillis(),
    tokenExpiresAt: slot.tokenExpiresAt.toMillis(),
    createdAt: slot.createdAt.toMillis(),
    broadcastType: slot.broadcastType || 'venue', // Default to venue for existing slots
  };
}

// GET - List broadcast slots
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const stationId = request.nextUrl.searchParams.get('stationId') || STATION_ID;
    const status = request.nextUrl.searchParams.get('status'); // optional filter
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');

    // Simple query without composite index - sort client-side for now
    const snapshot = await db.collection('broadcast-slots')
      .where('stationId', '==', stationId)
      .limit(limit)
      .get();

    const slots: BroadcastSlotSerialized[] = [];

    snapshot.forEach(doc => {
      const data = doc.data() as Omit<BroadcastSlot, 'id'>;
      const slot = serializeSlot({ id: doc.id, ...data });
      // Filter by status if requested
      if (!status || data.status === status) {
        slots.push(slot);
      }
    });

    // Sort by startTime descending (client-side)
    slots.sort((a, b) => b.startTime - a.startTime);

    return NextResponse.json({ slots });
  } catch (error) {
    console.error('Error listing slots:', error);
    return NextResponse.json({ error: 'Failed to list slots' }, { status: 500 });
  }
}

// POST - Create a new broadcast slot
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get auth header (simplified - in production, verify Firebase ID token)
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { djName, showName, startTime, endTime, broadcastType = 'venue' } = await request.json();

    if (!djName || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'Missing required fields: djName, startTime, endTime' },
        { status: 400 }
      );
    }

    const startTimestamp = Timestamp.fromMillis(startTime);
    const endTimestamp = Timestamp.fromMillis(endTime);

    // Token expires 1 hour after slot ends
    const tokenExpiresAt = Timestamp.fromMillis(endTime + 60 * 60 * 1000);

    const slot: Omit<BroadcastSlot, 'id'> = {
      stationId: STATION_ID,
      djName,
      showName: showName || undefined,
      startTime: startTimestamp,
      endTime: endTimestamp,
      broadcastToken: generateToken(),
      tokenExpiresAt,
      createdAt: Timestamp.now(),
      createdBy: OWNER_UID, // TODO: Get from verified token
      status: 'scheduled',
      broadcastType,
    };

    const docRef = await db.collection('broadcast-slots').add(slot);

    const createdSlot: BroadcastSlot = { id: docRef.id, ...slot };
    // Venue slots use permanent URL, remote slots get unique token URL
    const broadcastUrl = broadcastType === 'venue'
      ? `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/bettertomorrow`
      : `${process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com'}/broadcast/live?token=${slot.broadcastToken}`;

    return NextResponse.json({
      slot: serializeSlot(createdSlot),
      broadcastUrl,
    });
  } catch (error) {
    console.error('Error creating slot:', error);
    return NextResponse.json({ error: 'Failed to create slot' }, { status: 500 });
  }
}

// PATCH - Update a slot (status, etc.)
export async function PATCH(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { slotId, status } = await request.json();

    if (!slotId) {
      return NextResponse.json({ error: 'Missing slotId' }, { status: 400 });
    }

    const updates: Partial<BroadcastSlot> = {};
    if (status) updates.status = status;

    await db.collection('broadcast-slots').doc(slotId).update(updates);

    return NextResponse.json({ success: true, slotId });
  } catch (error) {
    console.error('Error updating slot:', error);
    return NextResponse.json({ error: 'Failed to update slot' }, { status: 500 });
  }
}

// DELETE - Delete a slot
export async function DELETE(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { slotId } = await request.json();

    if (!slotId) {
      return NextResponse.json({ error: 'Missing slotId' }, { status: 400 });
    }

    await db.collection('broadcast-slots').doc(slotId).delete();

    return NextResponse.json({ success: true, slotId });
  } catch (error) {
    console.error('Error deleting slot:', error);
    return NextResponse.json({ error: 'Failed to delete slot' }, { status: 500 });
  }
}
