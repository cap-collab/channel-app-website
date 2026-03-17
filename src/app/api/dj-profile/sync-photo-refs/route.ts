import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Sync DJ photo URL to collectives and venues where this DJ is a resident
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { userId, photoUrl } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Get the user's username for matching DJs added from pending profiles (no djUserId)
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const username = userData?.chatUsernameNormalized || null;

    // Query all collectives and venues — these collections are small
    const [collectivesSnapshot, venuesSnapshot] = await Promise.all([
      db.collection('collectives').get(),
      db.collection('venues').get(),
    ]);

    let updated = 0;
    const updatePromises: Promise<FirebaseFirestore.WriteResult>[] = [];

    const processCollection = (snapshot: FirebaseFirestore.QuerySnapshot) => {
      snapshot.forEach((doc) => {
        const data = doc.data();
        const residentDJs = data.residentDJs;
        if (!residentDJs || !Array.isArray(residentDJs)) return;

        let hasMatch = false;
        const updatedDJs = residentDJs.map((dj: Record<string, unknown>) => {
          if (dj.djUserId === userId || (username && dj.djUsername === username)) {
            hasMatch = true;
            return { ...dj, djPhotoUrl: photoUrl || null };
          }
          return dj;
        });

        if (hasMatch) {
          updatePromises.push(doc.ref.update({ residentDJs: updatedDJs }));
          updated++;
        }
      });
    };

    processCollection(collectivesSnapshot);
    processCollection(venuesSnapshot);

    await Promise.all(updatePromises);

    console.log(`[sync-photo-refs] Updated ${updated} collectives/venues for user ${userId}`);

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error('[sync-photo-refs] Error:', error);
    return NextResponse.json({ error: 'Failed to sync photo refs' }, { status: 500 });
  }
}
