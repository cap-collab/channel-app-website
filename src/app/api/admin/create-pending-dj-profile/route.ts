import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Check if user is admin/broadcaster
async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { isAdmin: false };
    }

    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };

    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();
    const role = userData?.role;

    const isAdmin = role === 'admin' || role === 'broadcaster';
    return { isAdmin, userId: decodedToken.uid };
  } catch {
    return { isAdmin: false };
  }
}

// Validate username format (same rules as register-username)
function isValidUsername(username: string): boolean {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 20) {
    return false;
  }
  const handle = trimmed.replace(/\s+/g, '');
  if (handle.length < 2) {
    return false;
  }
  const RESERVED_USERNAMES = ['channel', 'admin', 'system', 'moderator', 'mod'];
  if (RESERVED_USERNAMES.includes(handle.toLowerCase())) {
    return false;
  }
  return /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed);
}

interface CustomLink {
  label: string;
  url: string;
}

interface IrlShow {
  url: string;
  date: string;
}

interface DJProfileData {
  bio?: string | null;
  photoUrl?: string | null;
  location?: string | null;
  genres?: string[];
  promoText?: string | null;
  promoHyperlink?: string | null;
  socialLinks?: {
    instagram?: string;
    soundcloud?: string;
    bandcamp?: string;
    youtube?: string;
    bookingEmail?: string;
    mixcloud?: string;
    residentAdvisor?: string;
    website?: string;
    customLinks?: CustomLink[];
  };
  irlShows?: IrlShow[];
  myRecs?: {
    bandcampLinks?: string[];
    eventLinks?: string[];
  };
}

// POST - Create a pending DJ profile for a pre-registered DJ
export async function POST(request: NextRequest) {
  const { isAdmin, userId: adminUserId } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { email, username, djProfile } = body as {
      email: string;
      username: string;
      djProfile?: DJProfileData;
    };

    // Validate required fields
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedUsername = username.trim();

    // Validate username format
    if (!isValidUsername(trimmedUsername)) {
      return NextResponse.json({
        error: 'Invalid username. Use 2-20 characters, letters, numbers, and spaces.'
      }, { status: 400 });
    }

    const normalizedUsername = trimmedUsername.replace(/\s+/g, '').toLowerCase();

    // Check if email already has a user account
    const existingUserSnapshot = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!existingUserSnapshot.empty) {
      return NextResponse.json({
        error: 'A user with this email already exists. They can set up their own DJ profile.'
      }, { status: 409 });
    }

    // Check if username is already taken
    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
    if (usernameDoc.exists) {
      const existingData = usernameDoc.data();
      // Only allow if it's already a pending reservation for the same email
      if (!existingData?.isPending || existingData?.reservedForEmail?.toLowerCase() !== normalizedEmail) {
        return NextResponse.json({
          error: 'Username is already taken. Try another one.'
        }, { status: 409 });
      }
    }

    // Check if there's already a pending profile for this email
    const existingPendingSnapshot = await db.collection('pending-dj-profiles')
      .where('email', '==', normalizedEmail)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingPendingSnapshot.empty) {
      return NextResponse.json({
        error: 'A pending DJ profile already exists for this email.'
      }, { status: 409 });
    }

    // Create the pending DJ profile and reserve the username in a transaction
    const pendingProfileRef = db.collection('pending-dj-profiles').doc();
    const usernameRef = db.collection('usernames').doc(normalizedUsername);
    const pendingDJRoleRef = db.collection('pending-dj-roles').doc();

    await db.runTransaction(async (transaction) => {
      // Create pending DJ profile
      transaction.set(pendingProfileRef, {
        email: normalizedEmail,
        chatUsername: trimmedUsername,
        chatUsernameNormalized: normalizedUsername,
        djProfile: {
          bio: djProfile?.bio || null,
          photoUrl: djProfile?.photoUrl || null,
          location: djProfile?.location || null,
          genres: djProfile?.genres || [],
          promoText: djProfile?.promoText || null,
          promoHyperlink: djProfile?.promoHyperlink || null,
          socialLinks: djProfile?.socialLinks || {},
          irlShows: djProfile?.irlShows || [],
          myRecs: djProfile?.myRecs || {},
        },
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: adminUserId,
      });

      // Reserve the username with a pending marker
      transaction.set(usernameRef, {
        displayName: trimmedUsername,
        usernameHandle: normalizedUsername,
        uid: `pending:${normalizedEmail}`,
        reservedForEmail: normalizedEmail,
        isPending: true,
        claimedAt: FieldValue.serverTimestamp(),
      });

      // Also create a pending DJ role entry so they get DJ role on signup
      transaction.set(pendingDJRoleRef, {
        email: normalizedEmail,
        createdAt: FieldValue.serverTimestamp(),
        source: 'admin-pre-register',
      });
    });

    console.log(`[create-pending-dj-profile] Created pending profile for ${normalizedEmail} with username ${trimmedUsername}`);

    return NextResponse.json({
      success: true,
      profileId: pendingProfileRef.id,
      email: normalizedEmail,
      username: trimmedUsername,
      profileUrl: `/dj/${normalizedUsername}`,
    });
  } catch (error) {
    console.error('[create-pending-dj-profile] Error:', error);
    return NextResponse.json({ error: 'Failed to create pending DJ profile' }, { status: 500 });
  }
}

// PATCH - Update an existing pending DJ profile
export async function PATCH(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { profileId, djProfile } = body as {
      profileId: string;
      djProfile: DJProfileData;
    };

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Get the existing profile to preserve certain fields
    const profileRef = db.collection('pending-dj-profiles').doc(profileId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const existingData = profileDoc.data();
    if (existingData?.status !== 'pending') {
      return NextResponse.json({ error: 'Cannot edit a claimed profile' }, { status: 400 });
    }

    // Update only the djProfile field, preserving photoUrl if not provided
    await profileRef.update({
      djProfile: {
        bio: djProfile?.bio || null,
        photoUrl: djProfile?.photoUrl ?? existingData?.djProfile?.photoUrl ?? null,
        location: djProfile?.location || null,
        genres: djProfile?.genres || [],
        promoText: djProfile?.promoText || null,
        promoHyperlink: djProfile?.promoHyperlink || null,
        socialLinks: djProfile?.socialLinks || {},
        irlShows: djProfile?.irlShows || [],
        myRecs: djProfile?.myRecs || {},
      },
    });

    console.log(`[create-pending-dj-profile] Updated pending profile ${profileId}`);

    return NextResponse.json({
      success: true,
      profileId,
    });
  } catch (error) {
    console.error('[create-pending-dj-profile] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update pending DJ profile' }, { status: 500 });
  }
}

// DELETE - Delete a pending DJ profile
export async function DELETE(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Get the profile to find the username to delete
    const profileRef = db.collection('pending-dj-profiles').doc(profileId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const profileData = profileDoc.data();
    const normalizedUsername = profileData?.chatUsernameNormalized;

    // Delete the profile and username reservation
    await db.runTransaction(async (transaction) => {
      transaction.delete(profileRef);

      if (normalizedUsername) {
        const usernameRef = db.collection('usernames').doc(normalizedUsername);
        const usernameDoc = await transaction.get(usernameRef);
        // Only delete if it's a pending reservation
        if (usernameDoc.exists && usernameDoc.data()?.isPending) {
          transaction.delete(usernameRef);
        }
      }
    });

    console.log(`[create-pending-dj-profile] Deleted pending profile ${profileId}`);

    return NextResponse.json({
      success: true,
      profileId,
    });
  } catch (error) {
    console.error('[create-pending-dj-profile] DELETE Error:', error);
    return NextResponse.json({ error: 'Failed to delete pending DJ profile' }, { status: 500 });
  }
}
