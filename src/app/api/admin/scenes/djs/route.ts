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
  // Primary label: the DJ name (chatUsername). Falls back to internal name /
  // email so we never show a blank row, but chatUsername is what we want.
  displayName: string;
  chatUsername?: string;
  chatUsernameNormalized?: string;
  // Internal real name (e.g. used in Resend emails). Kept separate from
  // displayName so the admin sees both at a glance.
  name?: string;
  photoUrl?: string;
  role: string;
  sceneIds: string[];
  residencyCadence?: ResidencyCadence;
  // Soonest upcoming Channel slot for this DJ (Unix ms). Undefined if none.
  nextSlotStart?: number;
}

// GET - list all real DJ/broadcaster/admin users with their scene assignments
export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const [snap, slotsSnap] = await Promise.all([
      db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get(),
      db.collection('broadcast-slots').get(),
    ]);

    // Index soonest upcoming slot by djUserId and by lowercase djUsername.
    const now = Date.now();
    const nextSlotByUserId = new Map<string, number>();
    const nextSlotByUsername = new Map<string, number>();
    const recordHit = (key: string, ts: number, map: Map<string, number>) => {
      const existing = map.get(key);
      if (existing === undefined || ts < existing) map.set(key, ts);
    };
    const toMs = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
        return (v as { toMillis: () => number }).toMillis();
      }
      return 0;
    };
    slotsSnap.forEach((doc) => {
      const data = doc.data();
      const startTime = toMs(data.startTime);
      if (startTime <= now) return;
      if (data.status === 'cancelled' || data.broadcastType === 'recording') return;

      if (data.djUserId) recordHit(data.djUserId, startTime, nextSlotByUserId);
      if (data.djUsername) {
        recordHit((data.djUsername as string).toLowerCase(), startTime, nextSlotByUsername);
      }
      const djSlots: Array<{ djUserId?: string; djUsername?: string }> = data.djSlots ?? [];
      djSlots.forEach((d) => {
        if (d.djUserId) recordHit(d.djUserId, startTime, nextSlotByUserId);
        if (d.djUsername) recordHit(d.djUsername.toLowerCase(), startTime, nextSlotByUsername);
      });
    });

    const djs: DjForScenesAdmin[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const cadenceRaw = data.djProfile?.residency?.cadence;
      const residencyCadence: ResidencyCadence | undefined =
        cadenceRaw === 'monthly' || cadenceRaw === 'quarterly' ? cadenceRaw : undefined;
      const usernameLower = (data.chatUsernameNormalized || data.chatUsername || '').toLowerCase();
      const candidates: number[] = [];
      const a = nextSlotByUserId.get(doc.id);
      if (a !== undefined) candidates.push(a);
      if (usernameLower) {
        const b = nextSlotByUsername.get(usernameLower);
        if (b !== undefined) candidates.push(b);
      }
      const nextSlotStart = candidates.length ? Math.min(...candidates) : undefined;

      djs.push({
        userId: doc.id,
        displayName: data.chatUsername || data.name || data.email || '(no name)',
        chatUsername: data.chatUsername,
        chatUsernameNormalized: data.chatUsernameNormalized,
        name: data.name,
        photoUrl: data.djProfile?.photoUrl,
        role: data.role,
        sceneIds: Array.isArray(data.djProfile?.sceneIds) ? data.djProfile.sceneIds : [],
        residencyCadence,
        nextSlotStart,
      });
    });

    djs.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ djs });
  } catch (err) {
    console.error('[scenes/djs GET] error', err);
    return NextResponse.json({ error: 'Failed to fetch DJs' }, { status: 500 });
  }
}
