import { NextRequest } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

export interface OwnerAccessResult {
  isOwner: boolean;
  userId?: string;
  collectiveId?: string;
  // True when access was granted via admin/broadcaster role rather than ownership.
  isAdmin?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collectiveData?: Record<string, any>;
}

/**
 * Authorize a collective-owner self-service request for a specific collective slug.
 *
 * Mirrors verifyAdminAccess (src/app/api/admin/collectives/route.ts) but checks
 * SLUG MEMBERSHIP instead of role: the caller must own the collective, i.e. the
 * slug appears in their denormalized `ownedCollectiveSlugs` (kept in sync only by
 * /api/admin/collectives, so owners can't self-grant ownership).
 *
 * This is the SAME trust root the firestore archives rule uses for collective
 * tracklist edits. Ownership is a separate axis from `role` — this NEVER reads or
 * mutates role, so DJ/broadcaster/admin role reads are unaffected.
 *
 * Resolves the collective doc by slug so routes get collectiveId + data, and
 * double-checks owners[] as defense-in-depth (the slug list is the primary gate).
 */
export async function verifyOwnerAccess(
  request: NextRequest,
  slug: string
): Promise<OwnerAccessResult> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { isOwner: false };
    }

    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isOwner: false };

    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isOwner: false };

    const userId = decodedToken.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const role = userData?.role;
    // Admins/broadcasters manage every collective — no ownership/TC gate. This
    // mirrors their full access via the admin collectives API.
    const isAdmin = role === 'admin' || role === 'broadcaster';
    const ownedSlugs = userData?.ownedCollectiveSlugs;

    if (!isAdmin && (!Array.isArray(ownedSlugs) || !ownedSlugs.includes(slug))) {
      return { isOwner: false, userId };
    }

    // Resolve the collective doc so callers get its id + current data.
    const collectiveSnap = await db
      .collection('collectives')
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (collectiveSnap.empty) {
      return { isOwner: false, userId };
    }

    const collectiveDoc = collectiveSnap.docs[0];
    const collectiveData = collectiveDoc.data();

    // ownedCollectiveSlugs (checked above) is the SINGLE source of truth for
    // studio management access — same field the firestore cosmetic rule checks,
    // so the two gates agree. We deliberately do NOT also require membership in
    // the collective's owners[] array: owners[] is the *public* owner credit
    // (rendered in the Owners row), and some owners are management-only and must
    // stay off the public page (e.g. a non-performing admin). Such an owner has
    // ownedCollectiveSlugs set but is intentionally absent from owners[].

    return {
      isOwner: true,
      userId,
      collectiveId: collectiveDoc.id,
      collectiveData,
      isAdmin,
    };
  } catch {
    return { isOwner: false };
  }
}
