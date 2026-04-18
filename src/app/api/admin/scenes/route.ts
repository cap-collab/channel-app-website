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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// GET - list all scenes (public, SSR-safe)
export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ scenes: [] });
    const snap = await db.collection('scenes').get();
    const scenes: Array<Record<string, unknown>> = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const createdAt = data.createdAt?.toMillis?.() ?? data.createdAt ?? 0;
      const updatedAt = data.updatedAt?.toMillis?.() ?? data.updatedAt ?? 0;
      scenes.push({ id: doc.id, ...data, createdAt, updatedAt });
    });
    scenes.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    return NextResponse.json({ scenes });
  } catch (err) {
    console.error('[scenes GET] error', err);
    return NextResponse.json({ error: 'Failed to fetch scenes' }, { status: 500 });
  }
}

// POST - create a new scene
export async function POST(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { name, emoji, color, order, description, id: providedId } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (!emoji || typeof emoji !== 'string') {
      return NextResponse.json({ error: 'Emoji required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const id = typeof providedId === 'string' && providedId ? slugify(providedId) : slugify(name);
    if (!id) return NextResponse.json({ error: 'Could not derive slug from name' }, { status: 400 });

    const ref = db.collection('scenes').doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      return NextResponse.json({ error: `Scene with id '${id}' already exists` }, { status: 409 });
    }

    await ref.set({
      name,
      emoji,
      color: typeof color === 'string' ? color : 'bg-gray-700 text-gray-100 border-gray-500',
      order: typeof order === 'number' ? order : 0,
      description: typeof description === 'string' ? description : '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[scenes POST] error', err);
    return NextResponse.json({ error: 'Failed to create scene' }, { status: 500 });
  }
}
