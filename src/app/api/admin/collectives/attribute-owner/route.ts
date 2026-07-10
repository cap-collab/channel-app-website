import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Admin: pre-attribute a collective owner BY EMAIL, for the collective funnel.
//
// The existing /api/admin/collectives owners[] field takes UIDs of existing
// accounts. This endpoint handles the "person may not have an account yet" case:
//   - if a user with that email exists → grant collective rights immediately
//     (arrayUnion the slug into ownedCollectiveSlugs + add uid to owners[]).
//     Terms are NOT auto-accepted — they still accept in the funnel; ownership
//     is what admin controls here.
//   - if not → write an email-bound `pending-collective-roles` entry that the
//     funnel (assign-collective-role) or signup (reconcile) will consume.
//
// This never touches `role` — ownership is a separate axis.
async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean; userId?: string }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const role = userDoc.data()?.role;
    return { isAdmin: role === 'admin' || role === 'broadcaster', userId: decodedToken.uid };
  } catch {
    return { isAdmin: false };
  }
}

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

    const { email, collectiveSlug } = await request.json();
    if (!email || !collectiveSlug) {
      return NextResponse.json({ error: 'email and collectiveSlug are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Confirm the collective exists (fail fast on a typo'd slug).
    const collSnap = await db.collection('collectives')
      .where('slug', '==', collectiveSlug)
      .limit(1)
      .get();
    if (collSnap.empty) {
      return NextResponse.json({ error: 'Collective not found' }, { status: 404 });
    }
    const collectiveRef = collSnap.docs[0].ref;

    // Existing user → grant ownership now.
    const usersSnap = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!usersSnap.empty) {
      const userRef = usersSnap.docs[0].ref;
      const userId = usersSnap.docs[0].id;
      await userRef.update({ ownedCollectiveSlugs: FieldValue.arrayUnion(collectiveSlug) });
      await collectiveRef.update({ owners: FieldValue.arrayUnion(userId) });
      return NextResponse.json({ success: true, attributed: 'user', userId });
    }

    // No account yet → email-bound pending entry (idempotent per email+slug).
    const existing = await db.collection('pending-collective-roles')
      .where('email', '==', normalizedEmail)
      .where('collectiveSlug', '==', collectiveSlug)
      .limit(1)
      .get();

    if (existing.empty) {
      await db.collection('pending-collective-roles').add({
        email: normalizedEmail,
        collectiveSlug,
        createdAt: FieldValue.serverTimestamp(),
        source: 'admin-pre-attribute',
      });
    }

    return NextResponse.json({ success: true, attributed: 'pending' });
  } catch (error) {
    console.error('[attribute-owner] Error:', error);
    return NextResponse.json({ error: 'Failed to attribute owner' }, { status: 500 });
  }
}
