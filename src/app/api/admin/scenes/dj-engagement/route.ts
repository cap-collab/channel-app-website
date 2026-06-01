import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { wordBoundaryMatch } from '@/lib/dj-matching';

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return { isAdmin: role === 'admin' || role === 'broadcaster' };
  } catch {
    return { isAdmin: false };
  }
}

export interface DjEngagementCounts {
  watchlist: number;
  listeners: number;
}
export interface DjEngagementResponse {
  counts: Record<string, DjEngagementCounts>;
  computedAt: string;
}

// 3-day in-memory cache. Process-local; survives across hot requests in the
// same lambda warm pool but is rebuilt cold on cold start.
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
let cache: { data: DjEngagementResponse; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const force = request.nextUrl.searchParams.get('force') === '1';
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) {
    return NextResponse.json(cache.data);
  }

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const djsSnap = await db
      .collection('users')
      .where('role', 'in', ['dj', 'broadcaster', 'admin'])
      .get();

    // Build name → uid lookup keyed by lowercased chatUsernameNormalized (or
    // chatUsername fallback). This is the same key loveHistory/streamHistory
    // use for djUsername / djUsernames entries.
    const uidByName = new Map<string, string>();
    const djs: Array<{ uid: string; name: string }> = [];
    djsSnap.forEach((doc) => {
      const data = doc.data();
      const raw = (data.chatUsernameNormalized || data.chatUsername || '') as string;
      const name = raw.toLowerCase().trim();
      if (!name) return;
      uidByName.set(name, doc.id);
      djs.push({ uid: doc.id, name });
    });

    // listenersByUid: distinct user UIDs who hearted OR streamed this DJ.
    const listenersByUid = new Map<string, Set<string>>();
    const addListener = (djUid: string, userUid: string) => {
      const set = listenersByUid.get(djUid) ?? new Set<string>();
      set.add(userUid);
      listenersByUid.set(djUid, set);
    };

    // Hearts (loveHistory subcollection, keyed by djUsername field).
    const loveSnap = await db.collectionGroup('loveHistory').get();
    loveSnap.forEach((doc) => {
      const djUsername = (doc.data().djUsername as string | undefined)?.toLowerCase().trim();
      if (!djUsername) return;
      const djUid = uidByName.get(djUsername);
      if (!djUid) return;
      const parentPath = doc.ref.parent.parent?.path; // users/{userId}
      if (!parentPath?.startsWith('users/')) return;
      const userUid = parentPath.slice('users/'.length);
      if (userUid === djUid) return; // self
      addListener(djUid, userUid);
    });

    // Streams (streamHistory subcollection — djUsernames is an array).
    const streamSnap = await db.collectionGroup('streamHistory').get();
    streamSnap.forEach((doc) => {
      const usernames = doc.data().djUsernames;
      if (!Array.isArray(usernames)) return;
      const parentPath = doc.ref.parent.parent?.path;
      if (!parentPath?.startsWith('users/')) return;
      const userUid = parentPath.slice('users/'.length);
      for (const raw of usernames) {
        if (typeof raw !== 'string') continue;
        const djUsername = raw.toLowerCase().trim();
        const djUid = uidByName.get(djUsername);
        if (!djUid) continue;
        if (userUid === djUid) continue;
        addListener(djUid, userUid);
      }
    });

    // Watchlist: scan every user's `favorites` subcollection where type == "search",
    // word-boundary match each term against each DJ's name.
    const watchlistByUid = new Map<string, Set<string>>();
    const favSnap = await db
      .collectionGroup('favorites')
      .where('type', '==', 'search')
      .get();
    favSnap.forEach((doc) => {
      const term = doc.data().term;
      if (typeof term !== 'string' || !term) return;
      const parentPath = doc.ref.parent.parent?.path;
      if (!parentPath?.startsWith('users/')) return;
      const userUid = parentPath.slice('users/'.length);
      for (const { uid: djUid, name: djName } of djs) {
        if (userUid === djUid) continue;
        if (wordBoundaryMatch(djName, term)) {
          const set = watchlistByUid.get(djUid) ?? new Set<string>();
          set.add(userUid);
          watchlistByUid.set(djUid, set);
        }
      }
    });

    const counts: Record<string, DjEngagementCounts> = {};
    for (const { uid } of djs) {
      counts[uid] = {
        watchlist: watchlistByUid.get(uid)?.size ?? 0,
        listeners: listenersByUid.get(uid)?.size ?? 0,
      };
    }

    const response: DjEngagementResponse = {
      counts,
      computedAt: new Date().toISOString(),
    };
    cache = { data: response, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[scenes/dj-engagement GET] error', err);
    return NextResponse.json({ error: 'Failed to compute engagement counts' }, { status: 500 });
  }
}
