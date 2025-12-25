import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// This cron job runs every 5 minutes to mark expired slots as completed or missed
export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const now = Date.now();
    let completedCount = 0;
    let missedCount = 0;

    // Query all slots that are still live, paused, or scheduled
    // We'll check their end times in memory
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
        // Was live at some point, mark as completed
        newStatus = 'completed';
        completedCount++;
      } else if (slot.status === 'scheduled') {
        // Never went live, mark as missed
        newStatus = 'missed';
        missedCount++;
      } else {
        continue;
      }

      await doc.ref.update({ status: newStatus });
      console.log(`Slot ${doc.id} marked as ${newStatus}`);
    }

    return NextResponse.json({
      success: true,
      completed: completedCount,
      missed: missedCount,
      totalProcessed: completedCount + missedCount,
    });
  } catch (error) {
    console.error('Error in complete-expired-slots cron:', error);
    return NextResponse.json({ error: 'Failed to process slots' }, { status: 500 });
  }
}
