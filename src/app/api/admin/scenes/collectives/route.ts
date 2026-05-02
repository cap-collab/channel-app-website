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

export interface CollectiveForScenesAdmin {
  collectiveId: string;
  name: string;
  slug: string;
  photoUrl?: string;
  sceneIds: string[];
}

// GET - list all collectives with their scene assignments
export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const snap = await db.collection('collectives').get();

    const collectives: CollectiveForScenesAdmin[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      collectives.push({
        collectiveId: doc.id,
        name: data.name || '(unnamed)',
        slug: data.slug || '',
        photoUrl: data.photo || undefined,
        sceneIds: Array.isArray(data.sceneIds) ? data.sceneIds : [],
      });
    });

    collectives.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ collectives });
  } catch (err) {
    console.error('[scenes/collectives GET] error', err);
    return NextResponse.json({ error: 'Failed to fetch collectives' }, { status: 500 });
  }
}
