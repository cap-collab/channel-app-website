import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - list all scenes (public, SSR-safe)
// Scenes are seeded via scripts/seed-scenes.ts, not created from the admin UI.
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
