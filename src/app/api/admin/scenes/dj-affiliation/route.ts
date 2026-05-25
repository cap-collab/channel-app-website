import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

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
    const isAdmin = role === 'admin' || role === 'broadcaster';
    return { isAdmin, userId: decodedToken.uid };
  } catch {
    return { isAdmin: false };
  }
}

export async function PATCH(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { userId, affiliatedWithUid } = body as { userId?: string; affiliatedWithUid?: string | null };

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }
    if (affiliatedWithUid !== null && typeof affiliatedWithUid !== 'string') {
      return NextResponse.json({ error: 'affiliatedWithUid must be a string or null' }, { status: 400 });
    }
    if (affiliatedWithUid && affiliatedWithUid === userId) {
      return NextResponse.json({ error: 'Cannot affiliate a user with themselves' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (affiliatedWithUid) {
      const targetDoc = await db.collection('users').doc(affiliatedWithUid).get();
      if (!targetDoc.exists) {
        return NextResponse.json({ error: 'Affiliated artist not found' }, { status: 404 });
      }
      const targetRole = targetDoc.data()?.role;
      if (targetRole !== 'dj' && targetRole !== 'broadcaster' && targetRole !== 'admin') {
        return NextResponse.json({ error: 'Affiliated user must be a DJ' }, { status: 400 });
      }
      await userRef.update({ 'djProfile.affiliatedWithUid': affiliatedWithUid });
    } else {
      await userRef.update({ 'djProfile.affiliatedWithUid': FieldValue.delete() });
    }

    return NextResponse.json({ success: true, affiliatedWithUid: affiliatedWithUid ?? null });
  } catch (err) {
    console.error('[scenes/dj-affiliation PATCH] error', err);
    return NextResponse.json({ error: 'Failed to update affiliation' }, { status: 500 });
  }
}
