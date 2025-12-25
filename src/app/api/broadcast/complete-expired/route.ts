import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Complete all expired slots (called when admin loads dashboard)
export async function POST() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const now = Date.now();
    let completedCount = 0;
    let missedCount = 0;

    // Query all slots that are still live, paused, or scheduled
    const snapshot = await db
      .collection('broadcast-slots')
      .where('status', 'in', ['live', 'paused', 'scheduled'])
      .get();

    for (const doc of snapshot.docs) {
      const slot = doc.data();
      const endTime = slot.endTime?.toMillis?.() || slot.endTime;

      // Skip if slot hasn't ended yet
      if (now <= endTime) continue;

      // Determine final status based on current status
      let newStatus: 'completed' | 'missed';

      if (slot.status === 'live' || slot.status === 'paused') {
        newStatus = 'completed';
        completedCount++;
      } else if (slot.status === 'scheduled') {
        newStatus = 'missed';
        missedCount++;
      } else {
        continue;
      }

      await doc.ref.update({ status: newStatus });
    }

    return NextResponse.json({
      success: true,
      completed: completedCount,
      missed: missedCount,
    });
  } catch (error) {
    console.error('Error completing expired slots:', error);
    return NextResponse.json({ error: 'Failed to complete slots' }, { status: 500 });
  }
}
