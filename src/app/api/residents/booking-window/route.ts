import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { getResidentBookingWindow } from '@/lib/resident-booking';

export const dynamic = 'force-dynamic';
// Sweeps broadcast-slots + archives in memory (same as the resident cron).
export const maxDuration = 60;

/**
 * GET /api/residents/booking-window
 *
 * The signed-in DJ's self-booking window: their cadence, their last show, and
 * the earliest date they may pick for the next one. Drives both the /studio
 * button and the calendar floor on /studio/livestream.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = getAdminAuth();
  const db = getAdminDb();
  if (!auth || !db) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(authHeader.slice(7));
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const window = await getResidentBookingWindow(db, uid);
    return NextResponse.json(window);
  } catch (err) {
    console.error('[residents/booking-window] failed:', err);
    return NextResponse.json({ error: 'Failed to compute booking window' }, { status: 500 });
  }
}
