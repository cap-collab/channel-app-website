import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/users/lookup-by-email?email=xxx
// Returns full DJ profile info for a user by email, or { found: false } if not found
// Used by admin SlotModal to auto-populate DJ info when creating venue/remote slots
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ found: false });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[lookup-by-email] Database not configured');
      return NextResponse.json({ found: false });
    }

    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      return NextResponse.json({ found: false });
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const djProfile = userData.djProfile || {};

    // Return all DJ profile fields for slot pre-population
    return NextResponse.json({
      found: true,
      // User identity
      djUserId: userDoc.id,
      djUsername: userData.chatUsername || null,
      djName: userData.chatUsername || userData.displayName || null,
      // DJ profile fields
      djBio: djProfile.bio || null,
      djPhotoUrl: djProfile.photoUrl || null,
      djPromoText: djProfile.promoText || null,
      djPromoHyperlink: djProfile.promoHyperlink || null,
      djThankYouMessage: djProfile.thankYouMessage || null,
      djSocialLinks: djProfile.socialLinks || null,
      // Legacy field names (for backwards compatibility)
      liveDjBio: djProfile.bio || null,
      liveDjPhotoUrl: djProfile.photoUrl || null,
    });
  } catch (error) {
    console.error('[lookup-by-email] Error:', error);
    return NextResponse.json({ found: false });
  }
}
