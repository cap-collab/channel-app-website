import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const maxDuration = 300; // up to 5 min on Vercel; backfill should finish well under that

async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return false;
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return false;
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return role === 'admin' || role === 'broadcaster';
  } catch {
    return false;
  }
}

type DJ = {
  name?: string;
  username?: string;
  userId?: string;
  bio?: string;
  [k: string]: unknown;
};

type Plan = {
  archiveId: string;
  slug: string;
  showName: string;
  djUpdates: Array<{ index: number; djName: string; bioChars: number; via: 'userId' | 'username' }>;
};

async function buildBackfill(db: Firestore) {
  const archivesSnap = await db.collection('archives').get();

  const neededUserIds = new Set<string>();
  const neededUsernames = new Set<string>();
  for (const doc of archivesSnap.docs) {
    const djs = (doc.data().djs || []) as DJ[];
    for (const dj of djs) {
      if (dj.bio) continue;
      if (dj.userId) neededUserIds.add(dj.userId);
      else if (dj.username) {
        neededUsernames.add(dj.username.replace(/[\s-]+/g, '').toLowerCase());
      }
    }
  }

  const bioByUserId = new Map<string, string>();
  const bioByUsername = new Map<string, string>();

  const userIdList = Array.from(neededUserIds);
  for (let i = 0; i < userIdList.length; i += 30) {
    const batch = userIdList.slice(i, i + 30);
    const snap = await db.collection('users').where('__name__', 'in', batch).get();
    for (const doc of snap.docs) {
      const bio = doc.data()?.djProfile?.bio;
      if (typeof bio === 'string' && bio.trim().length > 0) bioByUserId.set(doc.id, bio);
    }
  }

  const usernameList = Array.from(neededUsernames);
  for (let i = 0; i < usernameList.length; i += 30) {
    const batch = usernameList.slice(i, i + 30);
    const snap = await db
      .collection('users')
      .where('chatUsernameNormalized', 'in', batch)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const bio = data?.djProfile?.bio;
      const normalized = data?.chatUsernameNormalized as string | undefined;
      if (normalized && typeof bio === 'string' && bio.trim().length > 0) {
        bioByUsername.set(normalized, bio);
      }
    }
  }

  const stillMissing = usernameList.filter((u) => !bioByUsername.has(u));
  for (let i = 0; i < stillMissing.length; i += 30) {
    const batch = stillMissing.slice(i, i + 30);
    const snap = await db
      .collection('pending-dj-profiles')
      .where('chatUsernameNormalized', 'in', batch)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const bio = data?.bio ?? data?.djProfile?.bio;
      const normalized = data?.chatUsernameNormalized as string | undefined;
      if (normalized && typeof bio === 'string' && bio.trim().length > 0) {
        bioByUsername.set(normalized, bio);
      }
    }
  }

  const plans: Plan[] = [];
  let archivesAlreadyHaveBios = 0;
  let djsWithoutAnyMatch = 0;

  for (const doc of archivesSnap.docs) {
    const data = doc.data();
    const djs = (data.djs || []) as DJ[];
    const djUpdates: Plan['djUpdates'] = [];
    let allHaveBio = djs.length > 0;
    for (let i = 0; i < djs.length; i++) {
      const dj = djs[i];
      if (dj.bio) continue;
      allHaveBio = false;
      let bio: string | undefined;
      let via: 'userId' | 'username' | null = null;
      if (dj.userId && bioByUserId.has(dj.userId)) {
        bio = bioByUserId.get(dj.userId);
        via = 'userId';
      } else if (dj.username) {
        const normalized = dj.username.replace(/[\s-]+/g, '').toLowerCase();
        if (bioByUsername.has(normalized)) {
          bio = bioByUsername.get(normalized);
          via = 'username';
        }
      }
      if (bio && via) {
        djUpdates.push({ index: i, djName: dj.name || '(no name)', bioChars: bio.length, via });
      } else {
        djsWithoutAnyMatch++;
      }
    }
    if (allHaveBio) archivesAlreadyHaveBios++;
    if (djUpdates.length > 0) {
      plans.push({ archiveId: doc.id, slug: data.slug, showName: data.showName, djUpdates });
    }
  }

  return {
    totalArchives: archivesSnap.size,
    archivesAlreadyHaveBios,
    djsWithoutAnyMatch,
    plans,
    bioByUserId,
    bioByUsername,
  };
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminAccess(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') !== 'false';

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  try {
    const { totalArchives, archivesAlreadyHaveBios, djsWithoutAnyMatch, plans, bioByUserId, bioByUsername } =
      await buildBackfill(db);
    const totalDjsToUpdate = plans.reduce((sum, p) => sum + p.djUpdates.length, 0);

    if (dryRun) {
      return NextResponse.json({
        mode: 'DRY_RUN',
        totalArchives,
        archivesAlreadyHaveBios,
        archivesNeedingUpdate: plans.length,
        djsWithoutAnyMatch,
        totalDjsToUpdate,
        firstFewPlans: plans.slice(0, 10),
        note: 'No writes. Re-run with ?dryRun=false to apply.',
      });
    }

    let written = 0;
    for (const plan of plans) {
      const ref = db.collection('archives').doc(plan.archiveId);
      const snap = await ref.get();
      const data = snap.data();
      if (!data) continue;
      const djs = (data.djs || []) as DJ[];
      let mutated = false;
      for (const update of plan.djUpdates) {
        const dj = djs[update.index];
        if (!dj || dj.bio) continue;
        let bio: string | undefined;
        if (update.via === 'userId' && dj.userId) bio = bioByUserId.get(dj.userId);
        else if (update.via === 'username' && dj.username) {
          bio = bioByUsername.get(dj.username.replace(/[\s-]+/g, '').toLowerCase());
        }
        if (bio) {
          djs[update.index] = { ...dj, bio };
          mutated = true;
        }
      }
      if (mutated) {
        await ref.update({ djs });
        written++;
      }
    }

    return NextResponse.json({
      mode: 'EXECUTED',
      totalArchives,
      archivesUpdated: written,
      totalDjsToUpdate,
      djsWithoutAnyMatch,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backfill failed' },
      { status: 500 }
    );
  }
}
