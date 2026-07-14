import { NextResponse } from 'next/server';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { normalizeUsername } from '@/lib/dj-matching';
import { enrichArchives, DJInfo, RawArchive } from '@/lib/archives-enrich';

export const dynamic = 'force-dynamic';

// Per-DJ recordings + past broadcast shows. Replaces the old approach where
// the DJ profile page fetched the WHOLE archive catalog via /api/archives and
// filtered it client-side (shipping every archive + tracklist to the browser
// just to show one DJ's handful). Here we filter server-side and enrich only
// the matches, so the payload is proportional to this DJ — not the catalog.
//
// Resolution mirrors DJPublicProfileClient's fetchDJProfile + the archive/slot
// matching in fetchPastShowsAndRecordings, kept server-side so a single request
// replaces its previous 4 round-trips.

interface PastBroadcastShow {
  id: string;
  showName: string;
  startTime: number;
  endTime: number;
  showImageUrl?: string;
  stationId: string;
  stationName: string;
}

/** Resolve the profile identity we match archives/slots against. */
interface ResolvedProfile {
  chatUsername: string;
  email: string;
  uid: string; // real user uid, or 'pending-…' / 'collective-…'
  profileType: 'user' | 'pending' | 'collective';
  ownedCollectiveSlugs: string[]; // slugs of collectives this user owns
  // Collective-only: its own slug + member match sets (owners + residents).
  collectiveSlug?: string;
  memberUids: string[];
  memberUsernames: string[]; // normalized (strip \s and -)
  memberNames: string[]; // lowercased
}

const toMillis = (t: unknown): number =>
  t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0;

async function resolveProfile(db: Firestore, normalized: string): Promise<ResolvedProfile | null> {
  // 1. Claimed user (Studio writes here — preferred).
  const usersSnap = await db
    .collection('users')
    .where('chatUsernameNormalized', '==', normalized)
    .where('role', 'in', ['dj', 'broadcaster', 'admin'])
    .get();
  if (!usersSnap.empty) {
    const doc = usersSnap.docs[0];
    const data = doc.data();
    return {
      chatUsername: data.chatUsername || '',
      email: (data.email || '').toLowerCase(),
      uid: doc.id,
      profileType: 'user',
      // Denormalized on the user doc + kept in sync by /api/admin/collectives.
      // Using it here avoids a live `collectives where owners array-contains`
      // query per page load.
      ownedCollectiveSlugs: Array.isArray(data.ownedCollectiveSlugs)
        ? data.ownedCollectiveSlugs.filter((s: unknown): s is string => typeof s === 'string')
        : [],
      memberUids: [],
      memberUsernames: [],
      memberNames: [],
    };
  }

  // 2. Pending profile (unclaimed DJ).
  const pendingSnap = await db
    .collection('pending-dj-profiles')
    .where('chatUsernameNormalized', '==', normalized)
    .get();
  if (!pendingSnap.empty) {
    const data = pendingSnap.docs[0].data();
    return {
      chatUsername: data.chatUsername || data.djName || data.chatUsernameNormalized || '',
      email: (data.email || '').toLowerCase(),
      uid: `pending-${pendingSnap.docs[0].id}`,
      profileType: 'pending',
      ownedCollectiveSlugs: [],
      memberUids: [],
      memberUsernames: [],
      memberNames: [],
    };
  }

  // 3. Collective (shares the /dj/<slug> namespace).
  const colSnap = await db.collection('collectives').where('slug', '==', normalized).limit(1).get();
  if (!colSnap.empty) {
    const doc = colSnap.docs[0];
    const data = doc.data();
    const memberUids = new Set<string>();
    const memberUsernames = new Set<string>();
    const memberNames: string[] = [];
    for (const u of (data.owners ?? []) as unknown[]) {
      if (typeof u === 'string' && u.length > 0) memberUids.add(u);
    }
    for (const r of (data.residentDJs ?? []) as { djUserId?: string; djUsername?: string; djName?: string }[]) {
      if (r.djUserId) memberUids.add(r.djUserId);
      if (r.djUsername) memberUsernames.add(normalizeUsername(r.djUsername));
      if (r.djName) memberNames.push(r.djName.toLowerCase());
    }
    return {
      chatUsername: data.name || data.slug || '',
      email: (data.socialLinks?.email || '').toLowerCase(),
      uid: `collective-${doc.id}`,
      profileType: 'collective',
      ownedCollectiveSlugs: [],
      collectiveSlug: data.slug,
      memberUids: Array.from(memberUids),
      memberUsernames: Array.from(memberUsernames),
      memberNames,
    };
  }

  return null;
}

/** Build the map of this DJ's past broadcast slots (for live-broadcast matching). */
async function loadPastSlots(
  db: Firestore,
  djEmail: string,
): Promise<Map<string, { showName: string; startTime: number; endTime: number; showImageUrl?: string }>> {
  const pastSlotsMap = new Map<string, { showName: string; startTime: number; endTime: number; showImageUrl?: string }>();
  if (!djEmail) return pastSlotsMap;

  const slotsRef = db.collection('broadcast-slots');
  const nowTs = new Date();
  const [remoteSnap, venueSnap] = await Promise.all([
    // Remote broadcasts: root-level djEmail.
    slotsRef.where('endTime', '<', nowTs).where('djEmail', '==', djEmail).get(),
    // Venue broadcasts: djSlots[] — filtered below.
    slotsRef.where('endTime', '<', nowTs).where('broadcastType', '==', 'venue').get(),
  ]);

  remoteSnap.forEach((doc) => {
    const data = doc.data();
    // Recording-type slots appear via archives; uploads (uploading/completed) aren't shows.
    if (data.broadcastType === 'recording') return;
    if (data.status === 'uploading' || data.status === 'completed') return;
    pastSlotsMap.set(doc.id, {
      showName: data.showName || 'Broadcast',
      startTime: toMillis(data.startTime),
      endTime: toMillis(data.endTime),
      showImageUrl: data.showImageUrl,
    });
  });

  venueSnap.forEach((doc) => {
    const data = doc.data();
    if (Array.isArray(data.djSlots)) {
      const hasMatch = data.djSlots.some(
        (slot: { djEmail?: string }) => slot.djEmail?.toLowerCase() === djEmail,
      );
      if (hasMatch) {
        pastSlotsMap.set(doc.id, {
          showName: data.showName || 'Broadcast',
          startTime: toMillis(data.startTime),
          endTime: toMillis(data.endTime),
          showImageUrl: data.showImageUrl,
        });
      }
    }
  });

  return pastSlotsMap;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  try {
    const db = getAdminDb();
    if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

    const { username } = await params;
    const normalized = normalizeUsername(decodeURIComponent(username));

    const profile = await resolveProfile(db, normalized);
    if (!profile) {
      return NextResponse.json({ recordings: [], pastBroadcastShows: [] });
    }

    const djEmail = profile.email;
    const djUserId = profile.uid;
    const isRealUserUid =
      profile.profileType === 'user' && !!djUserId &&
      !djUserId.startsWith('pending-') && !djUserId.startsWith('collective-');

    // Owned-collective slugs: for a user, straight off the doc (ownedCollectiveSlugs).
    // For a collective profile, itself. Used to match archives credited to a
    // collective (archive.djs[].username === <slug>).
    const myCollectiveSlugs = new Set<string>();
    if (isRealUserUid) {
      for (const s of profile.ownedCollectiveSlugs) myCollectiveSlugs.add(normalizeUsername(s));
    }
    if (profile.profileType === 'collective' && profile.collectiveSlug) {
      myCollectiveSlugs.add(normalizeUsername(profile.collectiveSlug));
    }

    const memberUids = new Set(profile.memberUids);
    const memberUsernames = new Set(profile.memberUsernames);
    const memberNames = profile.memberNames;
    // Canonical username form used for ALL username/slug comparisons below (see
    // normalizeUsername — strips spaces, hyphens, dots; matches generateSlug).
    const canonUsername = normalizeUsername(profile.chatUsername);

    // Read archives + this DJ's past slots in parallel.
    const [archivesSnap, pastSlotsMap] = await Promise.all([
      db.collection('archives').get(),
      loadPastSlots(db, djEmail),
    ]);

    // Filter archives to this DJ BEFORE enrichment — enrichment then runs only
    // for the (small) matched set. Mirrors the client-side matcher exactly.
    const matched: RawArchive[] = [];
    archivesSnap.forEach((doc) => {
      const data = doc.data();
      if (data.uploadStatus === 'uploading') return;
      // Must have a recording and be neither private nor hidden.
      if (!data.recordingUrl || data.isPublic === false || data.priority === 'hidden') return;

      const djs: DJInfo[] = data.djs || [];
      const matchesDj = djs.some((dj) => {
        if (djUserId && dj.userId === djUserId) return true;
        if (dj.userId && memberUids.size > 0 && memberUids.has(dj.userId)) return true;
        if (dj.username && memberUsernames.size > 0 &&
            memberUsernames.has(normalizeUsername(dj.username))) return true;
        if (dj.name && memberNames.length > 0 && memberNames.includes(dj.name.toLowerCase())) return true;
        if (dj.username && canonUsername && normalizeUsername(dj.username) === canonUsername) return true;
        // Collective slug match (slug stored as archive.djs[].username).
        if (dj.username && myCollectiveSlugs.size > 0 && myCollectiveSlugs.has(normalizeUsername(dj.username))) return true;
        if (dj.email && djEmail) return dj.email.toLowerCase() === djEmail;
        return false;
      });

      // Per-archive cross-listing by UID.
      const crossById =
        !!djUserId && Array.isArray(data.crossListUserIds) && data.crossListUserIds.includes(djUserId);
      // Per-archive cross-listing by normalized username (reaches pending DJs,
      // survives account claim).
      const crossByName =
        !!canonUsername && Array.isArray(data.crossListUsernames) &&
        data.crossListUsernames.some(
          (u: string) => typeof u === 'string' && normalizeUsername(u) === canonUsername,
        );
      // Live broadcasts matched by slot.
      const crossBySlot =
        data.sourceType === 'live' && data.broadcastSlotId && pastSlotsMap.has(data.broadcastSlotId);

      if (matchesDj || crossById || crossByName || crossBySlot) {
        matched.push({ id: doc.id, data, djs });
      }
    });

    const recordings = await enrichArchives(db, matched);
    recordings.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    // Past broadcast slots (of this DJ) that DON'T have a recording → shown as
    // plain past shows.
    const slotsWithRecordings = new Set(
      recordings.filter((a) => a.broadcastSlotId).map((a) => a.broadcastSlotId),
    );
    const pastBroadcastShows: PastBroadcastShow[] = [];
    pastSlotsMap.forEach((slot, slotId) => {
      if (!slotsWithRecordings.has(slotId)) {
        pastBroadcastShows.push({
          id: `broadcast-${slotId}`,
          showName: slot.showName,
          startTime: slot.startTime,
          endTime: slot.endTime,
          showImageUrl: slot.showImageUrl,
          stationId: 'broadcast',
          stationName: 'Channel Radio',
        });
      }
    });

    return NextResponse.json({ recordings, pastBroadcastShows });
  } catch (error) {
    console.error('[api/dj/recordings] error:', error);
    return NextResponse.json({ error: 'Failed to fetch recordings' }, { status: 500 });
  }
}
