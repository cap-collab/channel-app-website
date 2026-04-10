import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/users/lookup-by-name?name=Spillman
// Returns full DJ profile info by name (checks users then pending-dj-profiles)
// Used by admin SlotModal to auto-populate DJ info when creating broadcast slots
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ found: false });
  }

  const normalized = name.replace(/[\s-]+/g, '').toLowerCase();
  if (!normalized) {
    return NextResponse.json({ found: false });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[lookup-by-name] Database not configured');
      return NextResponse.json({ found: false });
    }

    // 1. Check users collection first
    const usersSnapshot = await db.collection('users')
      .where('chatUsernameNormalized', '==', normalized)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();
      const djProfile = userData.djProfile || {};

      return NextResponse.json({
        found: true,
        isPending: false,
        djUserId: userDoc.id,
        djUsername: userData.chatUsername || null,
        djUsernameNormalized: userData.chatUsernameNormalized || null,
        djName: userData.chatUsername || userData.displayName || null,
        name: djProfile.name || null,
        djEmail: userData.email || null,
        djBio: djProfile.bio || null,
        djPhotoUrl: djProfile.photoUrl || null,
        djThankYouMessage: djProfile.thankYouMessage || null,
        djSocialLinks: djProfile.socialLinks || null,
        djGenres: djProfile.genres || null,
        djDescription: djProfile.description || djProfile.bio || null,
        liveDjBio: djProfile.bio || null,
        liveDjPhotoUrl: djProfile.photoUrl || null,
      });
    }

    // 2. Check pending-dj-profiles as fallback
    const pendingSnapshot = await db.collection('pending-dj-profiles')
      .where('chatUsernameNormalized', '==', normalized)
      .limit(1)
      .get();

    if (!pendingSnapshot.empty) {
      const doc = pendingSnapshot.docs[0];
      const data = doc.data();
      const djProfile = data.djProfile || {};

      return NextResponse.json({
        found: true,
        isPending: true,
        djUserId: null,
        djUsername: data.chatUsername || null,
        djUsernameNormalized: data.chatUsernameNormalized || null,
        djName: data.chatUsername || data.djName || null,
        name: data.name || null,
        djEmail: data.email || null,
        djBio: djProfile.bio || null,
        djPhotoUrl: djProfile.photoUrl || null,
        djThankYouMessage: djProfile.thankYouMessage || null,
        djSocialLinks: djProfile.socialLinks || null,
        djGenres: djProfile.genres || null,
        djDescription: djProfile.description || djProfile.bio || null,
        liveDjBio: djProfile.bio || null,
        liveDjPhotoUrl: djProfile.photoUrl || null,
      });
    }

    return NextResponse.json({ found: false });
  } catch (error) {
    console.error('[lookup-by-name] Error:', error);
    return NextResponse.json({ found: false });
  }
}
