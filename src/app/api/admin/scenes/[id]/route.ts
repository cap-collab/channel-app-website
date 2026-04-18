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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const ref = db.collection('scenes').doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof body.name === 'string') updates.name = body.name;
    if (typeof body.emoji === 'string') updates.emoji = body.emoji;
    if (typeof body.color === 'string') updates.color = body.color;
    if (typeof body.order === 'number') updates.order = body.order;
    if (typeof body.description === 'string') updates.description = body.description;

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[scenes PATCH] error', err);
    return NextResponse.json({ error: 'Failed to update scene' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const ref = db.collection('scenes').doc(id);
    const existing = await ref.get();
    if (!existing.exists) return NextResponse.json({ error: 'Scene not found' }, { status: 404 });

    const affectedUsers = await db
      .collection('users')
      .where('djProfile.sceneIds', 'array-contains', id)
      .get();

    const batch = db.batch();
    affectedUsers.forEach((doc) => {
      batch.update(doc.ref, {
        'djProfile.sceneIds': FieldValue.arrayRemove(id),
      });
    });
    batch.delete(ref);
    await batch.commit();

    return NextResponse.json({ success: true, strippedFromUsers: affectedUsers.size });
  } catch (err) {
    console.error('[scenes DELETE] error', err);
    return NextResponse.json({ error: 'Failed to delete scene' }, { status: 500 });
  }
}
