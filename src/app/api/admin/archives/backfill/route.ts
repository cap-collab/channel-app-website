import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesSnap = await db.collection('archives').get();

    // Collect all DJ userIds and usernames that need profile lookup
    const userIdsToLookup = new Set<string>();
    const usernamesToLookup = new Set<string>();
    const archivesNeedingUpdate: { id: string; djs: Record<string, unknown>[] }[] = [];

    for (const doc of archivesSnap.docs) {
      const data = doc.data();
      const djs = data.djs || [];
      let needsUpdate = false;

      for (const dj of djs) {
        const hasGenres = Array.isArray(dj.genres) && dj.genres.length > 0;
        const hasLocation = !!dj.location;
        const hasPhoto = !!dj.photoUrl;
        if (!hasGenres || !hasLocation || !hasPhoto) {
          needsUpdate = true;
          if (dj.userId) userIdsToLookup.add(dj.userId);
          if (dj.username) usernamesToLookup.add(dj.username.replace(/[\s-]+/g, '').toLowerCase());
        }
      }

      if (needsUpdate) {
        archivesNeedingUpdate.push({ id: doc.id, djs });
      }
    }

    // Batch fetch profiles by userId
    const profileByUserId = new Map<string, { genres?: string[]; location?: string; photoUrl?: string }>();
    const userIds = Array.from(userIdsToLookup);
    for (let i = 0; i < userIds.length; i += 30) {
      const batch = userIds.slice(i, i + 30);
      const snap = await db.collection('users').where('__name__', 'in', batch).get();
      for (const doc of snap.docs) {
        const p = doc.data()?.djProfile;
        if (p) {
          profileByUserId.set(doc.id, {
            genres: Array.isArray(p.genres) && p.genres.length > 0 ? p.genres : undefined,
            location: p.location || undefined,
            photoUrl: p.photoUrl || undefined,
          });
        }
      }
    }

    // Batch fetch profiles by username
    const profileByUsername = new Map<string, { genres?: string[]; location?: string; photoUrl?: string }>();
    const usernames = Array.from(usernamesToLookup);
    for (let i = 0; i < usernames.length; i += 30) {
      const batch = usernames.slice(i, i + 30);
      const snap = await db.collection('users').where('chatUsernameNormalized', 'in', batch).get();
      for (const doc of snap.docs) {
        const p = doc.data()?.djProfile;
        const normalized = doc.data()?.chatUsernameNormalized;
        if (p && normalized) {
          profileByUsername.set(normalized, {
            genres: Array.isArray(p.genres) && p.genres.length > 0 ? p.genres : undefined,
            location: p.location || undefined,
            photoUrl: p.photoUrl || undefined,
          });
        }
      }
    }

    // Update archives
    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const { id, djs } of archivesNeedingUpdate) {
      let changed = false;
      const newDjs = djs.map((dj: Record<string, unknown>) => {
        const hasGenres = Array.isArray(dj.genres) && (dj.genres as string[]).length > 0;
        const hasLocation = !!dj.location;
        const hasPhoto = !!dj.photoUrl;
        if (hasGenres && hasLocation && hasPhoto) return dj;

        const profile: { genres?: string[]; location?: string; photoUrl?: string } | undefined =
          (dj.userId ? profileByUserId.get(dj.userId as string) : undefined) ||
          (dj.username ? profileByUsername.get((dj.username as string).replace(/[\s-]+/g, '').toLowerCase()) : undefined);

        if (!profile) return dj;

        const updatedDj = { ...dj };
        if (!hasGenres && profile.genres) {
          updatedDj.genres = profile.genres;
          changed = true;
        }
        if (!hasLocation && profile.location) {
          updatedDj.location = profile.location;
          changed = true;
        }
        if (!hasPhoto && profile.photoUrl) {
          updatedDj.photoUrl = profile.photoUrl;
          changed = true;
        }
        return updatedDj;
      });

      if (changed) {
        batch.update(db.collection('archives').doc(id), { djs: newDjs });
        updated++;
      } else {
        skipped++;
      }
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      total: archivesSnap.size,
      needingUpdate: archivesNeedingUpdate.length,
      updated,
      skipped,
      profilesFound: profileByUserId.size + profileByUsername.size,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    const message = error instanceof Error ? error.message : 'Backfill failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
