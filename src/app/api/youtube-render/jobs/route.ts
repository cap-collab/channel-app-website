import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

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

type RenderData = {
  showName: string;
  djName: string;
  djPhotoUrl: string;
  djGenres: string[];
  djDescription: string | null;
  sceneSlug: string | null;
};

type CreateJobBody = {
  archiveId: string;
  archiveSlug: string;
  recordingUrl: string;
  durationSec: number;
  renderData: RenderData;
};

function validateBody(raw: unknown): CreateJobBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Invalid body' };
  const b = raw as Record<string, unknown>;
  if (typeof b.archiveId !== 'string' || !b.archiveId) return { error: 'archiveId required' };
  if (typeof b.archiveSlug !== 'string' || !b.archiveSlug) return { error: 'archiveSlug required' };
  if (typeof b.recordingUrl !== 'string' || !/^https:\/\//.test(b.recordingUrl))
    return { error: 'recordingUrl must be https://' };
  if (typeof b.durationSec !== 'number' || b.durationSec <= 0 || b.durationSec > 6 * 60 * 60)
    return { error: 'durationSec must be > 0 and <= 6h' };
  const rd = b.renderData as Record<string, unknown> | undefined;
  if (!rd || typeof rd !== 'object') return { error: 'renderData required' };
  if (typeof rd.showName !== 'string') return { error: 'renderData.showName required' };
  if (typeof rd.djName !== 'string') return { error: 'renderData.djName required' };
  if (typeof rd.djPhotoUrl !== 'string' || !/^https:\/\//.test(rd.djPhotoUrl))
    return { error: 'renderData.djPhotoUrl must be https://' };
  if (!Array.isArray(rd.djGenres) || !rd.djGenres.every((g) => typeof g === 'string'))
    return { error: 'renderData.djGenres must be string[]' };
  if (rd.djDescription !== null && typeof rd.djDescription !== 'string')
    return { error: 'renderData.djDescription must be string|null' };
  if (rd.sceneSlug !== null && rd.sceneSlug !== undefined && typeof rd.sceneSlug !== 'string')
    return { error: 'renderData.sceneSlug must be string|null' };
  return {
    archiveId: b.archiveId,
    archiveSlug: b.archiveSlug,
    recordingUrl: b.recordingUrl,
    durationSec: b.durationSec,
    renderData: {
      showName: rd.showName,
      djName: rd.djName,
      djPhotoUrl: rd.djPhotoUrl,
      djGenres: rd.djGenres as string[],
      djDescription: (rd.djDescription as string | null) ?? null,
      sceneSlug: (rd.sceneSlug as string | null | undefined) ?? null,
    },
  };
}

export async function POST(request: NextRequest) {
  const { isAdmin, userId } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const validated = validateBody(raw);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const now = Date.now();
  const docRef = db.collection('youtube-render-jobs').doc();
  await docRef.set({
    archiveId: validated.archiveId,
    archiveSlug: validated.archiveSlug,
    recordingUrl: validated.recordingUrl,
    durationSec: validated.durationSec,
    renderData: validated.renderData,
    status: 'queued',
    progressPct: 0,
    createdAt: now,
    createdBy: userId,
  });

  return NextResponse.json({ jobId: docRef.id });
}

export async function GET(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const snap = await db
    .collection('youtube-render-jobs')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const jobs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json({ jobs });
}
