import { NextRequest, NextResponse } from 'next/server';
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
    const { collectiveId, sceneIds } = body;

    if (!collectiveId || typeof collectiveId !== 'string') {
      return NextResponse.json({ error: 'collectiveId required' }, { status: 400 });
    }
    if (!Array.isArray(sceneIds) || !sceneIds.every((s) => typeof s === 'string')) {
      return NextResponse.json({ error: 'sceneIds must be an array of strings' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const collectiveRef = db.collection('collectives').doc(collectiveId);
    const collectiveDoc = await collectiveRef.get();
    if (!collectiveDoc.exists) {
      return NextResponse.json({ error: 'Collective not found' }, { status: 404 });
    }

    const unique = Array.from(new Set(sceneIds));
    await collectiveRef.update({ sceneIds: unique });

    return NextResponse.json({ success: true, sceneIds: unique });
  } catch (err) {
    console.error('[scenes/collective-assignment PATCH] error', err);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}
