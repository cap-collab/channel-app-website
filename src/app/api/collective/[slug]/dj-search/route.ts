import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyOwnerAccess } from '@/lib/collective-owner-auth';
import { normalizeUsername } from '@/lib/dj-matching';
import type { EventDJRef } from '@/types/events';

// Owner-gated typeahead for the residents/guests picker. Returns matching DJs
// from BOTH `users` (real DJ accounts) and `pending-dj-profiles` as ready-to-add
// EventDJRefs. Done server-side (admin SDK) so we don't expose a broad users
// query to the client and so it stays owner-authorized.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const access = await verifyOwnerAccess(request, slug);
  if (!access.isOwner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    const qNorm = normalizeUsername(q);
    if (qNorm.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Fetch candidate DJs from both sources, then match/dedupe in memory. Both
    // sets are small (DJ roster), so a prefix scan on normalized handle is fine.
    const [usersSnap, pendingSnap] = await Promise.all([
      db.collection('users').where('role', 'in', ['dj', 'broadcaster', 'admin']).get(),
      db.collection('pending-dj-profiles').where('status', '==', 'pending').get(),
    ]);

    const byKey = new Map<string, EventDJRef>();

    // Pending first so real users can override the same normalized handle
    // (a claimed pending profile becomes a user; user data is fresher).
    for (const doc of pendingSnap.docs) {
      const d = doc.data();
      const norm: string = d.chatUsernameNormalized || normalizeUsername(d.chatUsername || d.name || '');
      if (!norm) continue;
      const name: string = d.name || d.chatUsername || '';
      const nameNorm = normalizeUsername(name);
      if (!norm.includes(qNorm) && !nameNorm.includes(qNorm)) continue;
      byKey.set(norm, {
        djName: name,
        djUsername: d.chatUsername || undefined,
        djPhotoUrl: d.djProfile?.photoUrl || undefined,
      });
    }

    for (const doc of usersSnap.docs) {
      const d = doc.data();
      const handle: string = d.chatUsername || '';
      const norm: string = d.chatUsernameNormalized || normalizeUsername(handle);
      if (!norm) continue;
      const name: string = d.djProfile?.name || handle;
      const nameNorm = normalizeUsername(name);
      if (!norm.includes(qNorm) && !nameNorm.includes(qNorm)) continue;
      byKey.set(norm, {
        djName: name,
        djUserId: doc.id,
        djUsername: handle || undefined,
        djPhotoUrl: d.djProfile?.photoUrl || undefined,
      });
    }

    const results = Array.from(byKey.values())
      .sort((a, b) => a.djName.localeCompare(b.djName))
      .slice(0, 12);

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[collective/dj-search] Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
