import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Reserved usernames that cannot be registered (case-insensitive)
const RESERVED_USERNAMES = ['channel', 'admin', 'system', 'moderator', 'mod'];

// Validate username format (same rules as iOS app)
function isValidUsername(username: string): boolean {
  const trimmed = username.trim();

  // Length: 2-20 characters
  if (trimmed.length < 2 || trimmed.length > 20) {
    return false;
  }

  // Check reserved usernames
  if (RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
    return false;
  }

  // Alphanumeric only (no spaces) - required for @mentions to work properly
  return /^[A-Za-z0-9]+$/.test(trimmed);
}

// POST - Register a unique chat username
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    const adminAuth = getAdminAuth();

    if (!db || !adminAuth) {
      console.error('[register-username] Database or auth not configured');
      return NextResponse.json({ error: 'Service not configured' }, { status: 500 });
    }

    // Verify Firebase auth token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    let userId: string;

    try {
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      userId = decodedToken.uid;
    } catch (authError) {
      console.error('[register-username] Token verification failed:', authError);
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await request.json();
    const { username } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const trimmedUsername = username.trim();

    // Validate username format
    if (!isValidUsername(trimmedUsername)) {
      return NextResponse.json({
        error: 'Invalid username. Use 2-20 characters, letters and numbers only.'
      }, { status: 400 });
    }

    const normalizedUsername = trimmedUsername.toLowerCase();
    const usernameDocRef = db.collection('usernames').doc(normalizedUsername);
    const userDocRef = db.collection('users').doc(userId);

    // Use a transaction to ensure atomicity (same as iOS app)
    try {
      await db.runTransaction(async (transaction) => {
        const usernameDoc = await transaction.get(usernameDocRef);

        if (usernameDoc.exists) {
          // Check if this user already owns this username
          const existingUid = usernameDoc.data()?.uid;
          if (existingUid !== userId) {
            throw new Error('USERNAME_TAKEN');
          }
          // User already owns this username, just update the user doc
        } else {
          // Claim the username
          transaction.set(usernameDocRef, {
            displayName: trimmedUsername, // Store original casing
            uid: userId,
            claimedAt: FieldValue.serverTimestamp(),
          });
        }

        // Update user document with chatUsername
        transaction.set(userDocRef, {
          chatUsername: trimmedUsername,
          lastSeenAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      console.log('[register-username] Successfully registered:', { userId, username: trimmedUsername });

      return NextResponse.json({
        success: true,
        username: trimmedUsername,
      });
    } catch (txError) {
      if (txError instanceof Error && txError.message === 'USERNAME_TAKEN') {
        return NextResponse.json({
          error: 'Username already taken. Try another one.'
        }, { status: 409 });
      }
      throw txError;
    }
  } catch (error) {
    console.error('[register-username] Error:', error);
    return NextResponse.json({ error: 'Failed to register username' }, { status: 500 });
  }
}
