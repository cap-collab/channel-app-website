import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

interface DJInfo {
  name: string;
  username?: string;
  photoUrl?: string;
  userId?: string;
  email?: string;
}

export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    // Get all archives without orderBy to avoid index requirement
    const snapshot = await archivesRef.get();

    // Collect all DJ emails that don't have a username
    const emailsNeedingLookup = new Set<string>();
    const rawArchives = snapshot.docs.map((doc) => {
      const data = doc.data();
      const djs: DJInfo[] = data.djs || [];

      // Find DJs without username but with email
      djs.forEach((dj) => {
        if (!dj.username && dj.email) {
          emailsNeedingLookup.add(dj.email.toLowerCase());
        }
      });

      return {
        id: doc.id,
        data,
        djs,
      };
    });

    // Look up pending profiles for DJs without usernames
    const emailToUsername = new Map<string, string>();
    if (emailsNeedingLookup.size > 0) {
      const pendingProfilesRef = db.collection('pending-dj-profiles');
      const pendingSnapshot = await pendingProfilesRef
        .where('status', '==', 'pending')
        .get();

      pendingSnapshot.docs.forEach((doc) => {
        const profile = doc.data();
        if (profile.email && profile.chatUsernameNormalized) {
          const email = profile.email.toLowerCase();
          if (emailsNeedingLookup.has(email)) {
            emailToUsername.set(email, profile.chatUsername);
          }
        }
      });
    }

    // Build final archives with enriched DJ data
    const archives: ArchiveSerialized[] = rawArchives.map(({ id, data, djs }) => {
      // Enrich DJs with pending profile usernames
      const enrichedDjs = djs.map((dj) => {
        if (!dj.username && dj.email) {
          const username = emailToUsername.get(dj.email.toLowerCase());
          if (username) {
            return { ...dj, username };
          }
        }
        return dj;
      });

      return {
        id,
        slug: data.slug,
        broadcastSlotId: data.broadcastSlotId,
        showName: data.showName,
        djs: enrichedDjs,
        recordingUrl: data.recordingUrl,
        duration: data.duration || 0,
        recordedAt: data.recordedAt,
        createdAt: data.createdAt,
        stationId: data.stationId || 'channel-main',
        showImageUrl: data.showImageUrl,
      };
    });

    // Sort by recordedAt descending (most recent first)
    archives.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    // Limit to 100
    const limitedArchives = archives.slice(0, 100);

    return NextResponse.json({ archives: limitedArchives });
  } catch (error) {
    console.error('Error fetching archives:', error);
    return NextResponse.json({ error: 'Failed to fetch archives' }, { status: 500 });
  }
}
