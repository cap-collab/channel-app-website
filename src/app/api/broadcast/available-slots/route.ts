import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { STATION_ID } from '@/types/broadcast';

export async function GET() {
  try {
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get all scheduled/live slots from now onwards
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, 'broadcast-slots'),
      where('stationId', '==', STATION_ID),
      where('status', 'in', ['scheduled', 'live']),
      where('startTime', '>=', Timestamp.fromDate(now)),
      where('startTime', '<=', Timestamp.fromDate(twoWeeksFromNow)),
      orderBy('startTime', 'asc')
    );

    const snapshot = await getDocs(q);
    const blockedSlots: { start: number; end: number }[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const startTime = data.startTime?.toMillis?.() || 0;
      const endTime = data.endTime?.toMillis?.() || 0;
      if (startTime && endTime) {
        blockedSlots.push({ start: startTime, end: endTime });
      }
    });

    return NextResponse.json({ blockedSlots });
  } catch (error) {
    console.error('Error fetching available slots:', error);
    return NextResponse.json({ error: 'Failed to fetch available slots' }, { status: 500 });
  }
}
