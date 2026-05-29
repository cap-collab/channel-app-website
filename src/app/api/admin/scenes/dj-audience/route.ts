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

// PATCH /api/admin/scenes/dj-audience
// Body: { userId: string, audienceDjUids: string[] }
// Replaces users/{userId}.djProfile.audienceDjUids with the given list,
// after deduping, dropping self-references, and verifying each target is
// a DJ-role user.
export async function PATCH(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { userId, audienceDjUids } = body as {
      userId?: string;
      audienceDjUids?: string[];
    };

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }
    if (!Array.isArray(audienceDjUids)) {
      return NextResponse.json({ error: 'audienceDjUids must be an array' }, { status: 400 });
    }

    // Dedupe + drop self-reference + sanity filter strings
    const cleaned = Array.from(
      new Set(
        audienceDjUids.filter(
          (uid): uid is string => typeof uid === 'string' && uid.length > 0 && uid !== userId,
        ),
      ),
    );

    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Verify each target uid exists and is a DJ-role user.
    for (const targetUid of cleaned) {
      const targetDoc = await db.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) {
        return NextResponse.json(
          { error: `Audience DJ not found: ${targetUid}` },
          { status: 404 },
        );
      }
      const targetRole = targetDoc.data()?.role;
      if (targetRole !== 'dj' && targetRole !== 'broadcaster' && targetRole !== 'admin') {
        return NextResponse.json(
          { error: `Audience target must be a DJ: ${targetUid}` },
          { status: 400 },
        );
      }
    }

    await userRef.update({ 'djProfile.audienceDjUids': cleaned });

    return NextResponse.json({ success: true, audienceDjUids: cleaned });
  } catch (err) {
    console.error('[scenes/dj-audience PATCH] error', err);
    return NextResponse.json({ error: 'Failed to update audience' }, { status: 500 });
  }
}
