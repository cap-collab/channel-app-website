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

export interface CollectiveOwnerRef {
  userId: string;
  name: string;
}

export interface CollectiveForScenesAdmin {
  collectiveId: string;
  name: string;
  slug: string;
  photoUrl?: string;
  sceneIds: string[];
  // Owners = the collective's crew. Owning a collective makes IT the owner's
  // crew lead in the recommendation affiliation graph (see buildAffiliationGraph).
  owners: CollectiveOwnerRef[];
}

// GET - list all collectives with their scene assignments
export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const snap = await db.collection('collectives').get();

    // Resolve owner uids → display names in one batched pass (deduped across
    // collectives). Owners are stored as uids on the collective doc.
    const ownerUidsByCollective = new Map<string, string[]>();
    const allOwnerUids = new Set<string>();
    snap.forEach((doc) => {
      const owners = Array.isArray(doc.data().owners)
        ? (doc.data().owners as string[]).filter(Boolean)
        : [];
      ownerUidsByCollective.set(doc.id, owners);
      owners.forEach((uid) => allOwnerUids.add(uid));
    });

    const ownerNameByUid = new Map<string, string>();
    const uidList = Array.from(allOwnerUids);
    for (let i = 0; i < uidList.length; i += 300) {
      const refs = uidList.slice(i, i + 300).map((uid) => db.collection('users').doc(uid));
      const docs = await db.getAll(...refs);
      for (const d of docs) {
        if (!d.exists) continue;
        const u = d.data() || {};
        ownerNameByUid.set(
          d.id,
          (u.chatUsername as string) || (u.name as string) || (u.displayName as string) || d.id,
        );
      }
    }

    const collectives: CollectiveForScenesAdmin[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const owners = (ownerUidsByCollective.get(doc.id) ?? []).map((uid) => ({
        userId: uid,
        name: ownerNameByUid.get(uid) || uid,
      }));
      collectives.push({
        collectiveId: doc.id,
        name: data.name || '(unnamed)',
        slug: data.slug || '',
        photoUrl: data.photo || undefined,
        sceneIds: Array.isArray(data.sceneIds) ? data.sceneIds : [],
        owners,
      });
    });

    collectives.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ collectives });
  } catch (err) {
    console.error('[scenes/collectives GET] error', err);
    return NextResponse.json({ error: 'Failed to fetch collectives' }, { status: 500 });
  }
}
