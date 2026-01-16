import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot, Recording } from '@/types/broadcast';

// POST - Mark a slot as completed (called when slot end time passes)
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { slotId } = body;

    if (!slotId) {
      return NextResponse.json({ error: 'Missing slotId' }, { status: 400 });
    }

    // Get the slot
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    const slot = slotDoc.data() as Omit<BroadcastSlot, 'id'>;
    const { force } = body;  // Allow force completion when DJ ends broadcast early
    const now = Date.now();
    const endTime = slot.endTime.toMillis();

    // If not forced, only complete if end time has passed
    if (!force && now <= endTime) {
      return NextResponse.json({ error: 'Slot has not ended yet' }, { status: 400 });
    }

    // Determine final status based on current status and timing
    let newStatus: 'completed' | 'missed' | 'paused';

    if (slot.status === 'live' || slot.status === 'paused') {
      if (force && now <= endTime) {
        // DJ ended early but time slot is still active - mark as paused so they can resume
        newStatus = 'paused';
      } else {
        // Time slot has passed - mark as completed
        newStatus = 'completed';
      }
    } else if (slot.status === 'scheduled') {
      // Never went live
      if (now > endTime) {
        // Time has passed, mark as missed
        newStatus = 'missed';
      } else {
        // Still within time slot, nothing to do
        return NextResponse.json({ success: true, status: slot.status });
      }
    } else {
      // Already completed or missed, nothing to do
      return NextResponse.json({ success: true, status: slot.status });
    }

    // Update status and mark any active recordings as 'processing'
    const updateData: Record<string, unknown> = { status: newStatus };

    // Mark all active recordings as 'processing' (they'll be updated to 'ready' by webhook)
    if (slot.recordings && slot.recordings.length > 0) {
      const updatedRecordings = slot.recordings.map((rec: Recording) => {
        if (rec.status === 'recording') {
          return { ...rec, status: 'processing' as const, endedAt: Date.now() };
        }
        return rec;
      });
      updateData.recordings = updatedRecordings;
    }

    // Also update legacy field if present
    if (slot.recordingStatus === 'recording') {
      updateData.recordingStatus = 'processing';
    }

    await slotRef.update(updateData);
    console.log(`Slot ${slotId} marked as ${newStatus}`);

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error('Error completing slot:', error);
    return NextResponse.json({ error: 'Failed to complete slot' }, { status: 500 });
  }
}
