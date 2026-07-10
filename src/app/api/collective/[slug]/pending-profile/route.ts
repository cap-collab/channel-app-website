import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyOwnerAccess } from '@/lib/collective-owner-auth';
import { normalizeUsername } from '@/lib/dj-matching';
import type { EventDJRef } from '@/types/events';

// Create a NO-EMAIL display-only pending DJ profile on behalf of a collective,
// then add it as a linked resident/guest. Deliberately DIFFERENT from the admin
// create-pending-dj-profile route:
//   - never accepts an email
//   - never writes a `pending-dj-roles` doc (so it CANNOT auto-grant a DJ role
//     on signup — it's purely a display credit)
//   - never reserves a `usernames` handle
//   - stamps `createdViaCollective` for provenance
// `role` is never touched here; this is orthogonal to DJ roles.

function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 40;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const access = await verifyOwnerAccess(request, slug);
  if (!access.isOwner || !access.collectiveId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const list: 'resident' | 'guest' = body.list === 'guest' ? 'guest' : 'resident';
    const name: string = typeof body.name === 'string' ? body.name.trim() : '';
    const photoUrl: string | null = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl : null;
    const bio: string | null = typeof body.bio === 'string' && body.bio ? body.bio : null;
    const location: string | null = typeof body.location === 'string' && body.location ? body.location : null;
    const genres: string[] = Array.isArray(body.genres)
      ? body.genres.filter((g: unknown): g is string => typeof g === 'string')
      : [];
    const socialLinks = body.socialLinks && typeof body.socialLinks === 'object' ? body.socialLinks : {};

    if (!isValidName(name)) {
      return NextResponse.json({ error: 'A name (2–40 characters) is required' }, { status: 400 });
    }

    const normalized = normalizeUsername(name);
    if (!normalized) {
      return NextResponse.json({ error: 'Name must contain letters or numbers' }, { status: 400 });
    }

    // Dedupe by normalized handle across BOTH users and pending profiles. The
    // admin route only dedupes by email, which a no-email stub lacks — without
    // this, "create a profile" twice collides in the shared /dj/<slug> namespace.
    const [existingUser, existingPending] = await Promise.all([
      db.collection('users').where('chatUsernameNormalized', '==', normalized).limit(1).get(),
      db.collection('pending-dj-profiles').where('chatUsernameNormalized', '==', normalized).limit(1).get(),
    ]);

    let ref: EventDJRef;

    if (!existingUser.empty) {
      // A real DJ already owns this handle — link to them instead of creating a dupe.
      const u = existingUser.docs[0];
      const d = u.data();
      ref = {
        djName: d.djProfile?.name || d.chatUsername || name,
        djUserId: u.id,
        djUsername: d.chatUsername || undefined,
        djPhotoUrl: d.djProfile?.photoUrl || undefined,
      };
    } else if (!existingPending.empty) {
      // A pending profile already exists — link to it.
      const p = existingPending.docs[0].data();
      ref = {
        djName: p.name || p.chatUsername || name,
        djUsername: p.chatUsername || undefined,
        djPhotoUrl: p.djProfile?.photoUrl || undefined,
      };
    } else {
      // Create the display-only stub. No email, no pending-dj-roles, no usernames reservation.
      const pendingRef = db.collection('pending-dj-profiles').doc();
      await pendingRef.set({
        chatUsername: name,
        chatUsernameNormalized: normalized,
        name,
        djProfile: {
          bio,
          photoUrl,
          location,
          genres,
          sceneIds: [],
          tipButtonLink: null,
          socialLinks,
          irlShows: [],
          radioShows: [],
          myRecs: {},
        },
        status: 'pending',
        createdViaCollective: slug,
        createdBy: access.userId,
        createdAt: FieldValue.serverTimestamp(),
      });
      ref = {
        djName: name,
        djUsername: name,
        djPhotoUrl: photoUrl || undefined,
      };
    }

    // Add the ref to the collective's resident/guest list (dedupe by identity).
    const field = list === 'guest' ? 'guestDJs' : 'residentDJs';
    const current: EventDJRef[] = Array.isArray(access.collectiveData?.[field])
      ? (access.collectiveData![field] as EventDJRef[])
      : [];
    const key = ref.djUsername ? `u:${ref.djUsername.toLowerCase()}` : `n:${ref.djName.trim().toLowerCase()}`;
    const already = current.some((e) =>
      (e.djUsername ? `u:${e.djUsername.toLowerCase()}` : `n:${e.djName.trim().toLowerCase()}`) === key
    );
    const next = already ? current : [...current, ref];
    if (!already) {
      await db.collection('collectives').doc(access.collectiveId).update({ [field]: next });
    }

    return NextResponse.json({ success: true, [field]: next, entry: ref });
  } catch (error) {
    console.error('[collective/pending-profile] Error:', error);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}
