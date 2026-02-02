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

// POST - Reserve usernames for all pending DJ profiles that don't have one
export async function POST(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Fetch all pending DJ profiles
    const pendingSnapshot = await db.collection('pending-dj-profiles')
      .where('status', '==', 'pending')
      .get();

    const results = {
      total: pendingSnapshot.size,
      reserved: 0,
      alreadyExists: 0,
      conflicts: [] as string[],
      errors: [] as string[],
    };

    for (const doc of pendingSnapshot.docs) {
      const data = doc.data();
      const chatUsername = data.chatUsername;
      const chatUsernameNormalized = data.chatUsernameNormalized;
      const email = data.email;

      if (!chatUsernameNormalized) {
        results.errors.push(`${chatUsername || doc.id} - no normalized username`);
        continue;
      }

      const usernameRef = db.collection('usernames').doc(chatUsernameNormalized);
      const usernameDoc = await usernameRef.get();

      if (usernameDoc.exists) {
        const existingData = usernameDoc.data();

        if (existingData?.isPending) {
          // Already reserved as pending
          results.alreadyExists++;
        } else {
          // Username taken by a real user - conflict!
          results.conflicts.push(`${chatUsername} (taken by uid: ${existingData?.uid})`);
        }
      } else {
        // Reserve the username
        try {
          await usernameRef.set({
            displayName: chatUsername,
            usernameHandle: chatUsernameNormalized,
            uid: email ? `pending:${email}` : `pending:${doc.id}`,
            reservedForEmail: email || null,
            isPending: true,
            claimedAt: FieldValue.serverTimestamp(),
          });
          results.reserved++;
        } catch (err) {
          results.errors.push(`${chatUsername} - ${err}`);
        }
      }
    }

    console.log(`[reserve-pending-usernames] Results:`, results);

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('[reserve-pending-usernames] Error:', error);
    return NextResponse.json({ error: 'Failed to reserve usernames' }, { status: 500 });
  }
}
