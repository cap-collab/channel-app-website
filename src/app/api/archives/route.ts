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
  genres?: string[];
  location?: string;
  bio?: string;
  tipButtonLink?: string;
  youtubeOptIn?: boolean;
  soundcloudOptIn?: boolean;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includePrivate = searchParams.get('includePrivate') === 'true';

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    // Get all archives without orderBy to avoid index requirement
    const snapshot = await archivesRef.get();

    // First pass: collect archives and identify which need slot lookups
    // Filter out unpublished recordings (isPublic === false means explicitly private)
    // Unless includePrivate=true (for DJ dashboard to see their own recordings)
    const slotIdsNeedingLookup = new Set<string>();
    const rawArchives = snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        // Skip archives still being uploaded
        if (data.uploadStatus === 'uploading') return false;
        // If includePrivate is true, include all archives
        // Otherwise, include only if isPublic is true or undefined (legacy archives)
        return includePrivate || data.isPublic !== false;
      })
      .map((doc) => {
        const data = doc.data();
        const djs: DJInfo[] = data.djs || [];

        // Check if any DJ is missing both username AND email (need to look up slot)
        const needsSlotLookup = djs.some((dj) => !dj.username && !dj.email);
        if (needsSlotLookup && data.broadcastSlotId) {
          slotIdsNeedingLookup.add(data.broadcastSlotId);
        }

        return {
          id: doc.id,
          data,
          djs,
        };
      });

    // Look up broadcast slots to get DJ emails for archives missing them
    const slotDjEmails = new Map<string, Map<string, string>>(); // slotId -> (djName -> email)
    if (slotIdsNeedingLookup.size > 0) {
      const slotsRef = db.collection('broadcast-slots');
      // Firestore doesn't support whereIn with more than 30 items, so batch if needed
      const slotIds = Array.from(slotIdsNeedingLookup);
      const batches = [];
      for (let i = 0; i < slotIds.length; i += 30) {
        batches.push(slotIds.slice(i, i + 30));
      }

      for (const batch of batches) {
        const slotDocs = await Promise.all(
          batch.map((slotId) => slotsRef.doc(slotId).get())
        );

        for (const slotDoc of slotDocs) {
          if (!slotDoc.exists) continue;
          const slotData = slotDoc.data();
          if (!slotData) continue;

          const djNameToEmail = new Map<string, string>();

          // Check djSlots array (venue broadcasts)
          if (slotData.djSlots && Array.isArray(slotData.djSlots)) {
            for (const slot of slotData.djSlots) {
              if (slot.djName && slot.djEmail) {
                djNameToEmail.set(slot.djName.toLowerCase(), slot.djEmail.toLowerCase());
              }
            }
          }

          // Check top-level DJ info (remote broadcasts)
          if (slotData.djEmail && (slotData.djName || slotData.liveDjUsername)) {
            const name = (slotData.djName || slotData.liveDjUsername) as string;
            djNameToEmail.set(name.toLowerCase(), (slotData.djEmail as string).toLowerCase());
          }

          if (djNameToEmail.size > 0) {
            slotDjEmails.set(slotDoc.id, djNameToEmail);
          }
        }
      }
    }

    // Second pass: enrich DJs with emails from slots, collect all emails for pending profile lookup
    const emailsNeedingLookup = new Set<string>();
    const enrichedRawArchives = rawArchives.map(({ id, data, djs }) => {
      const enrichedDjs = djs.map((dj) => {
        // If DJ already has email, use it
        if (dj.email) {
          if (!dj.username) {
            emailsNeedingLookup.add(dj.email.toLowerCase());
          }
          return dj;
        }

        // Try to get email from slot lookup
        if (!dj.username && data.broadcastSlotId) {
          const slotEmails = slotDjEmails.get(data.broadcastSlotId);
          if (slotEmails) {
            const email = slotEmails.get(dj.name.toLowerCase());
            if (email) {
              emailsNeedingLookup.add(email);
              return { ...dj, email };
            }
          }
        }

        return dj;
      });

      return { id, data, djs: enrichedDjs };
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

    // Look up DJ genres by userId and username
    const userIdsForGenres = new Set<string>();
    const usernamesForGenres = new Set<string>();
    for (const { djs } of enrichedRawArchives) {
      for (const dj of djs) {
        if (dj.userId) userIdsForGenres.add(dj.userId);
        if (dj.username) usernamesForGenres.add(dj.username.replace(/\s+/g, '').toLowerCase());
      }
    }

    type DJProfileSlice = {
      genres?: string[];
      location?: string;
      bio?: string;
      tipButtonLink?: string;
      youtubeOptIn?: boolean;
      soundcloudOptIn?: boolean;
    };
    const djProfileByUserId = new Map<string, DJProfileSlice>();
    const djProfileByUsername = new Map<string, DJProfileSlice>();

    const sliceProfile = (profile: Record<string, unknown> | undefined): DJProfileSlice | null => {
      if (!profile) return null;
      const genres = profile.genres;
      const location = profile.location;
      const bio = profile.bio;
      const tipButtonLink = profile.tipButtonLink;
      const youtubeOptIn = profile.youtubeOptIn;
      const soundcloudOptIn = profile.soundcloudOptIn;
      const slice: DJProfileSlice = {};
      if (Array.isArray(genres) && genres.length > 0) slice.genres = genres as string[];
      if (typeof location === 'string' && location) slice.location = location;
      if (typeof bio === 'string' && bio.trim().length > 0) slice.bio = bio;
      if (typeof tipButtonLink === 'string' && tipButtonLink.trim().length > 0) slice.tipButtonLink = tipButtonLink;
      // Only carry the flag when explicitly false (DJ opted out). When the
      // field is true/undefined, we leave it off the slice — the consumer
      // treats absence as "opted in" by default.
      if (youtubeOptIn === false) slice.youtubeOptIn = false;
      if (soundcloudOptIn === false) slice.soundcloudOptIn = false;
      return Object.keys(slice).length > 0 ? slice : null;
    };

    // Batch fetch by userId
    if (userIdsForGenres.size > 0) {
      const userIds = Array.from(userIdsForGenres);
      const batchSize = 30;
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        const snap = await db.collection('users').where('__name__', 'in', batch).get();
        for (const doc of snap.docs) {
          const slice = sliceProfile(doc.data()?.djProfile);
          if (slice) djProfileByUserId.set(doc.id, slice);
        }
      }
    }

    // Batch fetch by chatUsernameNormalized
    if (usernamesForGenres.size > 0) {
      const usernames = Array.from(usernamesForGenres);
      const batchSize = 30;
      for (let i = 0; i < usernames.length; i += batchSize) {
        const batch = usernames.slice(i, i + batchSize);
        const snap = await db.collection('users').where('chatUsernameNormalized', 'in', batch).get();
        for (const doc of snap.docs) {
          const slice = sliceProfile(doc.data()?.djProfile);
          const normalized = doc.data()?.chatUsernameNormalized;
          if (normalized && slice) djProfileByUsername.set(normalized, slice);
        }
      }
    }

    // Build final archives with enriched DJ data
    const archives: ArchiveSerialized[] = enrichedRawArchives.map(({ id, data, djs }) => {
      // Enrich DJs with pending profile usernames and genres
      const enrichedDjs = djs.map((dj) => {
        let enriched = dj;
        if (!dj.username && dj.email) {
          const username = emailToUsername.get(dj.email.toLowerCase());
          if (username) {
            enriched = { ...enriched, username };
          }
        }
        // Add genres and location from profile lookup (archive-stored data takes priority)
        const profileData = (dj.userId && djProfileByUserId.get(dj.userId))
          || (dj.username && djProfileByUsername.get(dj.username.replace(/\s+/g, '').toLowerCase()))
          || (enriched.username && djProfileByUsername.get(enriched.username.replace(/\s+/g, '').toLowerCase()));
        if (profileData) {
          if (!enriched.genres && profileData.genres) {
            enriched = { ...enriched, genres: profileData.genres };
          }
          if (!enriched.location && profileData.location) {
            enriched = { ...enriched, location: profileData.location };
          }
          // Live enrichment: profile values win for bio + tipButtonLink
          // since the DJ may have updated them after the archive was
          // recorded (the archive's snapshot is a fallback, not truth).
          if (profileData.bio) {
            enriched = { ...enriched, bio: profileData.bio };
          }
          if (profileData.tipButtonLink) {
            enriched = { ...enriched, tipButtonLink: profileData.tipButtonLink };
          }
          // youtubeOptIn / soundcloudOptIn are only carried through when
          // explicitly false (DJ opted out). Absence = opted in by default.
          // Always honor the live value — the DJ may have changed their mind.
          if (profileData.youtubeOptIn === false) {
            enriched = { ...enriched, youtubeOptIn: false };
          }
          if (profileData.soundcloudOptIn === false) {
            enriched = { ...enriched, soundcloudOptIn: false };
          }
        }
        return enriched;
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
        streamCount: data.streamCount,
        // Include new recording-related fields
        isPublic: data.isPublic,
        sourceType: data.sourceType,
        publishedAt: data.publishedAt,
        priority: data.priority || 'medium',
        sceneIdsOverride: data.sceneIdsOverride ?? null,
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
