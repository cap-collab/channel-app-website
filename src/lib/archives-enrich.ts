import type { Firestore } from 'firebase-admin/firestore';
import { ArchiveSerialized } from '@/types/broadcast';
import { normalizeTrackIds, publicTrackIds } from '@/lib/track-ids';
import { normalizeUsername } from '@/lib/dj-matching';

export interface DJInfo {
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
  metaOptIn?: boolean;
  instagram?: string;
}

/** A raw archive doc paired with its parsed djs[], as read from Firestore. */
export interface RawArchive {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  djs: DJInfo[];
}

type DJProfileSlice = {
  genres?: string[];
  location?: string;
  bio?: string;
  tipButtonLink?: string;
  youtubeOptIn?: boolean;
  soundcloudOptIn?: boolean;
  metaOptIn?: boolean;
  instagram?: string;
};

const sliceProfile = (profile: Record<string, unknown> | undefined): DJProfileSlice | null => {
  if (!profile) return null;
  const genres = profile.genres;
  const location = profile.location;
  const bio = profile.bio;
  const tipButtonLink = profile.tipButtonLink;
  const youtubeOptIn = profile.youtubeOptIn;
  const soundcloudOptIn = profile.soundcloudOptIn;
  const metaOptIn = profile.metaOptIn;
  const socialLinks = profile.socialLinks as Record<string, unknown> | undefined;
  const instagram = socialLinks?.instagram;
  const slice: DJProfileSlice = {};
  if (Array.isArray(genres) && genres.length > 0) slice.genres = genres as string[];
  if (typeof location === 'string' && location) slice.location = location;
  if (typeof bio === 'string' && bio.trim().length > 0) slice.bio = bio;
  if (typeof tipButtonLink === 'string' && tipButtonLink.trim().length > 0) slice.tipButtonLink = tipButtonLink;
  // Opt-in flags: only carry when explicitly false (DJ opted out).
  // Absence = opted-in by default. Consumer treats accordingly.
  if (youtubeOptIn === false) slice.youtubeOptIn = false;
  if (soundcloudOptIn === false) slice.soundcloudOptIn = false;
  if (metaOptIn === false) slice.metaOptIn = false;
  // Instagram handle: stored as the bare handle (no @, no URL — see
  // saveSocialLinks in studio). Only carried when set.
  if (typeof instagram === 'string' && instagram.trim().length > 0) {
    slice.instagram = instagram.trim();
  }
  return Object.keys(slice).length > 0 ? slice : null;
};

// Strip DJ PII (email + Firebase UID) from an archive DJ before the payload
// reaches a listener. Neither field has any listener-facing consumer — email is
// only used server-side for slot/profile matching, and userId's sole reader (the
// own-show check) now compares usernames instead. Consent flags are intentionally
// NOT stripped here: they carry no PII and are read only in admin/studio contexts.
export function toPublicDj<T extends { email?: string; userId?: string }>(
  dj: T,
): Omit<T, 'email' | 'userId'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { email, userId, ...rest } = dj;
  return rest;
}

/**
 * Enrich a set of raw archive docs into the serialized public `Archive` shape:
 * fills missing DJ emails from broadcast slots, resolves pending-profile
 * usernames, live-enriches genres/bio/tip/opt-ins/instagram from the DJ's
 * current profile, and masks private tracks. Shared by /api/archives (whole
 * catalog) and /api/dj/[username]/recordings (one DJ) so the two never drift.
 *
 * Enrichment lookups (slots, pending profiles, user profiles) scale with the
 * number of DISTINCT DJs across the passed archives — cheap when the caller has
 * already narrowed to a single DJ's recordings.
 */
export async function enrichArchives(db: Firestore, rawArchives: RawArchive[]): Promise<ArchiveSerialized[]> {
  // Slot lookups for archives whose djs[] are missing both username and email.
  const slotIdsNeedingLookup = new Set<string>();
  for (const { data, djs } of rawArchives) {
    const needsSlotLookup = djs.some((dj) => !dj.username && !dj.email);
    if (needsSlotLookup && data.broadcastSlotId) slotIdsNeedingLookup.add(data.broadcastSlotId);
  }

  const slotDjEmails = new Map<string, Map<string, string>>(); // slotId -> (djName -> email)
  if (slotIdsNeedingLookup.size > 0) {
    const slotsRef = db.collection('broadcast-slots');
    const slotIds = Array.from(slotIdsNeedingLookup);
    for (let i = 0; i < slotIds.length; i += 30) {
      const batch = slotIds.slice(i, i + 30);
      const slotDocs = await Promise.all(batch.map((slotId) => slotsRef.doc(slotId).get()));
      for (const slotDoc of slotDocs) {
        if (!slotDoc.exists) continue;
        const slotData = slotDoc.data();
        if (!slotData) continue;
        const djNameToEmail = new Map<string, string>();
        if (slotData.djSlots && Array.isArray(slotData.djSlots)) {
          for (const slot of slotData.djSlots) {
            if (slot.djName && slot.djEmail) {
              djNameToEmail.set(slot.djName.toLowerCase(), slot.djEmail.toLowerCase());
            }
          }
        }
        if (slotData.djEmail && (slotData.djName || slotData.liveDjUsername)) {
          const name = (slotData.djName || slotData.liveDjUsername) as string;
          djNameToEmail.set(name.toLowerCase(), (slotData.djEmail as string).toLowerCase());
        }
        if (djNameToEmail.size > 0) slotDjEmails.set(slotDoc.id, djNameToEmail);
      }
    }
  }

  // Enrich DJs with emails from slots; collect emails needing pending-profile lookup.
  const emailsNeedingLookup = new Set<string>();
  const enrichedRawArchives = rawArchives.map(({ id, data, djs }) => {
    const enrichedDjs = djs.map((dj) => {
      if (dj.email) {
        if (!dj.username) emailsNeedingLookup.add(dj.email.toLowerCase());
        return dj;
      }
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

  // Resolve pending-profile usernames for DJs identified only by email.
  const emailToUsername = new Map<string, string>();
  if (emailsNeedingLookup.size > 0) {
    const pendingSnapshot = await db
      .collection('pending-dj-profiles')
      .where('status', '==', 'pending')
      .get();
    pendingSnapshot.docs.forEach((doc) => {
      const profile = doc.data();
      if (profile.email && profile.chatUsernameNormalized) {
        const email = profile.email.toLowerCase();
        if (emailsNeedingLookup.has(email)) emailToUsername.set(email, profile.chatUsername);
      }
    });
  }

  // Live-enrich DJ genres/bio/etc. by userId and username.
  const userIdsForGenres = new Set<string>();
  const usernamesForGenres = new Set<string>();
  for (const { djs } of enrichedRawArchives) {
    for (const dj of djs) {
      if (dj.userId) userIdsForGenres.add(dj.userId);
      if (dj.username) usernamesForGenres.add(normalizeUsername(dj.username));
    }
  }

  const djProfileByUserId = new Map<string, DJProfileSlice>();
  const djProfileByUsername = new Map<string, DJProfileSlice>();

  if (userIdsForGenres.size > 0) {
    const userIds = Array.from(userIdsForGenres);
    for (let i = 0; i < userIds.length; i += 30) {
      const batch = userIds.slice(i, i + 30);
      const snap = await db.collection('users').where('__name__', 'in', batch).get();
      for (const doc of snap.docs) {
        const slice = sliceProfile(doc.data()?.djProfile);
        if (slice) djProfileByUserId.set(doc.id, slice);
      }
    }
  }

  if (usernamesForGenres.size > 0) {
    const usernames = Array.from(usernamesForGenres);
    for (let i = 0; i < usernames.length; i += 30) {
      const batch = usernames.slice(i, i + 30);
      const snap = await db.collection('users').where('chatUsernameNormalized', 'in', batch).get();
      for (const doc of snap.docs) {
        const slice = sliceProfile(doc.data()?.djProfile);
        const normalized = doc.data()?.chatUsernameNormalized;
        if (normalized && slice) djProfileByUsername.set(normalized, slice);
      }
    }
  }

  const archives: ArchiveSerialized[] = enrichedRawArchives.map(({ id, data, djs }) => {
    const enrichedDjs = djs.map((dj) => {
      let enriched = dj;
      if (!dj.username && dj.email) {
        const username = emailToUsername.get(dj.email.toLowerCase());
        if (username) enriched = { ...enriched, username };
      }
      const profileData = (dj.userId && djProfileByUserId.get(dj.userId))
        || (dj.username && djProfileByUsername.get(normalizeUsername(dj.username)))
        || (enriched.username && djProfileByUsername.get(normalizeUsername(enriched.username)));
      if (profileData) {
        if (!enriched.genres && profileData.genres) enriched = { ...enriched, genres: profileData.genres };
        if (!enriched.location && profileData.location) enriched = { ...enriched, location: profileData.location };
        // Live enrichment: profile values win for bio + tipButtonLink since the
        // DJ may have updated them after the archive was recorded.
        if (profileData.bio) enriched = { ...enriched, bio: profileData.bio };
        if (profileData.tipButtonLink) enriched = { ...enriched, tipButtonLink: profileData.tipButtonLink };
        if (profileData.youtubeOptIn === false) enriched = { ...enriched, youtubeOptIn: false };
        if (profileData.soundcloudOptIn === false) enriched = { ...enriched, soundcloudOptIn: false };
        if (profileData.metaOptIn === false) enriched = { ...enriched, metaOptIn: false };
        if (profileData.instagram) enriched = { ...enriched, instagram: profileData.instagram };
      }
      return toPublicDj(enriched);
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
      tracklistViewCount: data.tracklistViewCount,
      isPublic: data.isPublic,
      sourceType: data.sourceType,
      publishedAt: data.publishedAt,
      priority: data.priority || 'medium',
      sceneIdsOverride: data.sceneIdsOverride ?? null,
      sceneSlugs: Array.isArray(data.sceneSlugs) ? data.sceneSlugs : undefined,
      tempo: data.tempo ?? null,
      venueId: data.venueId ?? null,
      venueName: data.venueName ?? null,
      venueSlug: data.venueSlug ?? null,
      crossListUserIds: Array.isArray(data.crossListUserIds) ? data.crossListUserIds : undefined,
      crossListUsernames: Array.isArray(data.crossListUsernames) ? data.crossListUsernames : undefined,
      // Mask private tracks BEFORE the payload leaves the server — the real
      // text of a private track never reaches a public listener.
      trackIds: publicTrackIds(normalizeTrackIds(data.trackIds)),
    };
  });

  return archives;
}
