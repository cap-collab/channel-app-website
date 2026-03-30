import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot, BroadcastSlotSerialized } from '@/types/broadcast';

function serializeSlot(slot: BroadcastSlot): BroadcastSlotSerialized {
  return {
    ...slot,
    startTime: slot.startTime.toMillis(),
    endTime: slot.endTime.toMillis(),
    tokenExpiresAt: slot.tokenExpiresAt.toMillis(),
    createdAt: slot.createdAt.toMillis(),
  };
}

// GET - Validate a broadcast token
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as Omit<BroadcastSlot, 'id'>;
    const slot: BroadcastSlot = { id: doc.id, ...data };

    // Check if token has expired
    const now = Date.now();
    if (slot.tokenExpiresAt.toMillis() < now) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 410 });
    }

    // Determine if outside scheduled time
    const startTime = slot.startTime.toMillis();
    const endTime = slot.endTime.toMillis();

    // Check if slot is still valid (not completed/missed)
    // But allow if we're still within the scheduled time window (status may be stale)
    if ((slot.status === 'completed' || slot.status === 'missed') && now > endTime) {
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Determine schedule status
    const fifteenMinutes = 15 * 60 * 1000;
    let scheduleStatus: 'early' | 'on-time' | 'late' = 'on-time';
    let message = 'You are on schedule';

    if (now < startTime - fifteenMinutes) {
      // More than 15 minutes before start
      scheduleStatus = 'early';
      const startDate = new Date(startTime);
      const today = new Date();
      const isToday = startDate.getDate() === today.getDate() &&
        startDate.getMonth() === today.getMonth() &&
        startDate.getFullYear() === today.getFullYear();
      const timeStr = startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (isToday) {
        message = `Your show starts at ${timeStr}`;
      } else {
        const dateStr = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        message = `Your show starts ${dateStr} at ${timeStr}`;
      }
    } else if (now > startTime && now < endTime) {
      // Show has started but not ended - DJ is late joining
      scheduleStatus = 'late';
      message = `Your show started at ${new Date(startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }

    return NextResponse.json({
      valid: true,
      slot: serializeSlot(slot),
      scheduleStatus,
      message,
    });
  } catch (error) {
    console.error('Error validating token:', error);
    return NextResponse.json({ error: 'Failed to validate token' }, { status: 500 });
  }
}
