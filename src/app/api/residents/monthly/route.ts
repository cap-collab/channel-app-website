import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

interface MonthlyResident {
  username: string;
  displayName: string;
  photoUrl: string;
}

// Monthly residents = DJ-role users with djProfile.residency.cadence === 'monthly'.
// residency.cadence is a nested field, so we query the (small) DJ roster and filter
// in memory — mirrors the cron + scene-page approach rather than indexing a nested field.
export async function GET() {
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not available' }, { status: 500 });
  }

  try {
    const djsSnap = await db.collection('users').where('role', '==', 'dj').get();

    const residents: MonthlyResident[] = [];
    djsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.djProfile?.residency?.cadence !== 'monthly') return;

      // Need a chatUsername to build the /dj/{username} link (same resolution the
      // scenes page uses). Skip residents without one.
      const username = data.chatUsername;
      if (!username || typeof username !== 'string') return;

      // Skip residents without a profile picture — the referral grid is photo-only.
      const photoUrl = data.djProfile?.photoUrl;
      if (!photoUrl || typeof photoUrl !== 'string') return;

      residents.push({
        username,
        displayName: data.chatUsername || data.displayName || username,
        photoUrl,
      });
    });

    residents.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ residents });
  } catch (err) {
    console.error('[residents/monthly] failed to fetch residents:', err);
    return NextResponse.json({ error: 'Failed to fetch residents' }, { status: 500 });
  }
}
