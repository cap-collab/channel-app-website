import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { resolveActivityUid } from '@/lib/account-links';

async function verifyUser(request: NextRequest): Promise<{ userId?: string }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return {};
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return {};
    const decoded = await auth.verifyIdToken(token);
    return { userId: decoded.uid };
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { sceneId } = await request.json();
    if (!sceneId || typeof sceneId !== 'string') {
      return NextResponse.json({ error: 'sceneId required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    // Linked accounts: an alias is only a login — favourite the scene on the
    // primary so taste never splits across a person's two accounts.
    const activityUid = await resolveActivityUid(db, userId);

    const sceneDoc = await db.collection('scenes').doc(sceneId).get();
    if (!sceneDoc.exists) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    await db.collection('users').doc(activityUid).update({
      favoriteSceneIds: FieldValue.arrayUnion(sceneId),
    });

    return NextResponse.json({ success: true, sceneId });
  } catch (err) {
    console.error('[scenes/favorite POST] error', err);
    return NextResponse.json({ error: 'Failed to favorite scene' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { sceneId } = await request.json();
    if (!sceneId || typeof sceneId !== 'string') {
      return NextResponse.json({ error: 'sceneId required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    // Linked accounts: an alias is only a login — favourite the scene on the
    // primary so taste never splits across a person's two accounts.
    const activityUid = await resolveActivityUid(db, userId);

    await db.collection('users').doc(activityUid).update({
      favoriteSceneIds: FieldValue.arrayRemove(sceneId),
    });

    return NextResponse.json({ success: true, sceneId });
  } catch (err) {
    console.error('[scenes/favorite DELETE] error', err);
    return NextResponse.json({ error: 'Failed to unfavorite scene' }, { status: 500 });
  }
}
