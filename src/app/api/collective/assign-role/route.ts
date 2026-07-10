import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

// Grant COLLECTIVE rights to a user by email (mirror of assign-dj-role, but on
// the ownership axis — this NEVER reads or writes `role`, so DJ/broadcaster/admin
// role reads are completely unaffected).
//
// Entitlement (WHICH collective) comes from an admin-created, email-bound
// `pending-collective-roles` entry { email, collectiveSlug }. On accept:
//   - existing user  → stamp collectiveTermsAcceptedAt + arrayUnion the slug into
//     ownedCollectiveSlugs, add uid to that collective's owners[], consume the
//     pending entry.
//   - no user yet    → leave the pending entry (stamp collectiveTermsAcceptedAt on
//     it) for reconcile-broadcast-slots to consume on signup.
//
// Graceful dead-end: valid code but NO pending-collective-role for the email →
// nothing to attribute. We report attributed:false so the UI can show an
// "ask an admin to be added" state rather than silently granting nothing.
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find the admin-created entitlement(s) for this email.
    const pendingRolesSnap = await db.collection('pending-collective-roles')
      .where('email', '==', normalizedEmail)
      .get();

    const slugs = pendingRolesSnap.docs
      .map((d) => d.data().collectiveSlug)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);

    // Find the user (may not exist yet).
    let usersSnapshot = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();
    if (usersSnapshot.empty && email.trim() !== normalizedEmail) {
      usersSnapshot = await db.collection('users')
        .where('email', '==', email.trim())
        .limit(1)
        .get();
    }

    if (usersSnapshot.empty) {
      // No account yet — stamp acceptance on the pending entries so reconcile
      // consumes them on signup. If there are none, there's nothing to do; the
      // user still accepted terms, but attribution waits for an admin.
      const now = Timestamp.now();
      for (const doc of pendingRolesSnap.docs) {
        await doc.ref.update({ collectiveTermsAcceptedAt: now });
      }
      return NextResponse.json({
        success: true,
        existingUser: false,
        attributed: slugs.length > 0,
        slugs,
      });
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    const updateData: Record<string, unknown> = {
      collectiveTermsAcceptedAt: Timestamp.now(),
    };
    if (slugs.length > 0) {
      updateData.ownedCollectiveSlugs = FieldValue.arrayUnion(...slugs);
    }
    await userDoc.ref.update(updateData);

    // Sync collectives.owners[] for each attributed slug (canonical owner source).
    for (const slug of slugs) {
      const collSnap = await db.collection('collectives')
        .where('slug', '==', slug)
        .limit(1)
        .get();
      if (!collSnap.empty) {
        await collSnap.docs[0].ref.update({ owners: FieldValue.arrayUnion(userId) });
      }
    }

    // Consume the pending entries.
    for (const doc of pendingRolesSnap.docs) {
      await doc.ref.delete();
    }

    return NextResponse.json({
      success: true,
      existingUser: true,
      attributed: slugs.length > 0,
      slugs,
    });
  } catch (error) {
    console.error('[assign-collective-role] Error:', error);
    return NextResponse.json({ error: 'Failed to assign collective role' }, { status: 500 });
  }
}
