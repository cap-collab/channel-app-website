import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { normalizeUsername } from '@/lib/dj-matching';

// POST - Backfill chatUsernameNormalized for all existing users
export async function POST() {
  try {
    const db = getAdminDb();

    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // No auth - run once then delete this endpoint

    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('chatUsername', '!=', '').get();

    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const chatUsername = data.chatUsername;

      if (!chatUsername) {
        skipped++;
        continue;
      }

      // Canonical normalization (strips ALL non-alphanumerics incl dots) — same
      // rule /dj/<username> resolves with, so backfilled values stay reachable.
      const normalized = normalizeUsername(chatUsername);

      // Only update if not already set or different
      if (data.chatUsernameNormalized !== normalized) {
        batch.update(doc.ref, { chatUsernameNormalized: normalized });
        updated++;
      } else {
        skipped++;
      }
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      updated,
      skipped,
      total: snapshot.size,
    });
  } catch (error) {
    console.error('[backfill-normalized-usernames] Error:', error);
    return NextResponse.json({ error: 'Failed to backfill' }, { status: 500 });
  }
}
