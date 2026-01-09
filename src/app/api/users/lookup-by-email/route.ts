import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/users/lookup-by-email?email=xxx
// Returns DJ info for a user by email, or null if not found
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json(null);
  }

  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[lookup-by-email] Database not configured');
      return NextResponse.json(null);
    }

    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      return NextResponse.json(null);
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();

    return NextResponse.json({
      djUserId: userDoc.id,
      djName: userData.chatUsername || userData.displayName || null,
      liveDjBio: userData.djProfile?.bio || null,
      liveDjPhotoUrl: userData.djProfile?.photoUrl || null,
    });
  } catch (error) {
    console.error('[lookup-by-email] Error:', error);
    return NextResponse.json(null);
  }
}
