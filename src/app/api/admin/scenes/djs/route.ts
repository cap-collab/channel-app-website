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

export type ResidencyCadence = 'monthly' | 'quarterly';

export interface DjForScenesAdmin {
  userId: string;
  displayName: string;
  chatUsername?: string;
  chatUsernameNormalized?: string;
  photoUrl?: string;
  role: string;
  sceneIds: string[];
  residencyCadence?: ResidencyCadence;
}

// GET - list all real DJ/broadcaster/admin users with their scene assignments
export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const snap = await db
      .collection('users')
      .where('role', 'in', ['dj', 'broadcaster', 'admin'])
      .get();

    const djs: DjForScenesAdmin[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const cadenceRaw = data.djProfile?.residency?.cadence;
      const residencyCadence: ResidencyCadence | undefined =
        cadenceRaw === 'monthly' || cadenceRaw === 'quarterly' ? cadenceRaw : undefined;
      djs.push({
        userId: doc.id,
        displayName: data.displayName || data.chatUsername || data.email || '(no name)',
        chatUsername: data.chatUsername,
        chatUsernameNormalized: data.chatUsernameNormalized,
        photoUrl: data.djProfile?.photoUrl,
        role: data.role,
        sceneIds: Array.isArray(data.djProfile?.sceneIds) ? data.djProfile.sceneIds : [],
        residencyCadence,
      });
    });

    djs.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ djs });
  } catch (err) {
    console.error('[scenes/djs GET] error', err);
    return NextResponse.json({ error: 'Failed to fetch DJs' }, { status: 500 });
  }
}
