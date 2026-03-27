import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";
import { getAdminDb } from "@/lib/firebase-admin";
import { Show, IRLShowData, CuratorRec, DJProfile } from "@/types";

// Must be dynamic since it uses Firebase Admin SDK at runtime
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Caching: schedule data updates at the top of every hour, so we cache until
// the next hour boundary. DJ profile lookups are cached for 10 minutes.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FirestoreDoc = { id: string; data: () => any };

let scheduleCache: { shows: Show[]; irlShows: IRLShowData[]; curatorRecs: CuratorRec[]; djProfiles: DJProfile[] } | null = null;
let scheduleCacheExpiry = 0;

function getNextHourMs(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

// DJ profile cache (keyed by normalized username or userId)
const djProfileCache = new Map<string, { data: Record<string, unknown> | null; expiry: number }>();
const DJ_PROFILE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// OG metadata cache (populated in background, served on subsequent requests)
const ogMetadataCache = new Map<string, { ogTitle?: string; ogImage?: string; ogDescription?: string }>();

// Blocked profile matches cache: prevents enriching external shows with wrong DJ profiles
// Each entry is "djUsername:stationId" (or "djUsername:*" for all stations)
let blockedMatchesCache: Set<string> | null = null;
let blockedMatchesCacheExpiry = 0;
const BLOCKED_MATCHES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchBlockedMatches(): Promise<Set<string>> {
  const now = Date.now();
  if (blockedMatchesCache && now < blockedMatchesCacheExpiry) {
    return blockedMatchesCache;
  }

  const adminDb = getAdminDb();
  if (!adminDb) return new Set();

  const snapshot = await adminDb.collection("blocked-profile-matches").get();
  const blocked = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const username = data.djUsername as string;
    const stationId = data.stationId as string;
    if (username && stationId) {
      blocked.add(`${username.toLowerCase()}:${stationId.toLowerCase()}`);
    }
  }

  blockedMatchesCache = blocked;
  blockedMatchesCacheExpiry = now + BLOCKED_MATCHES_CACHE_TTL;
  console.log(`[API /schedule] Loaded ${blocked.size} blocked profile matches`);
  return blocked;
}

function isProfileMatchBlocked(blocked: Set<string>, djUsername: string, stationId: string): boolean {
  const normalizedUsername = djUsername.toLowerCase();
  const normalizedStation = stationId.toLowerCase();
  return blocked.has(`${normalizedUsername}:${normalizedStation}`) ||
         blocked.has(`${normalizedUsername}:*`);
}

// ---------------------------------------------------------------------------
// Shared query: fetch all DJ/broadcaster/admin users once, reuse everywhere
// ---------------------------------------------------------------------------

async function fetchDJUserDocs(): Promise<FirestoreDoc[]> {
  const adminDb = getAdminDb();
  if (!adminDb) return [];
  const snapshot = await adminDb
    .collection("users")
    .where("role", "in", ["dj", "broadcaster", "admin"])
    .get();
  return snapshot.docs as unknown as FirestoreDoc[];
}

// ---------------------------------------------------------------------------
// Enrich shows with DJ profiles (with per-profile caching)
// ---------------------------------------------------------------------------

async function enrichShowsWithDJProfiles(shows: Show[]): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) return shows;

  const blocked = await fetchBlockedMatches();

  const djUsernames = new Set<string>();
  shows.forEach((show) => {
    if (show.djUsername && show.stationId !== "broadcast") {
      // Skip blocked username+station combos
      if (!isProfileMatchBlocked(blocked, show.djUsername, show.stationId)) {
        djUsernames.add(show.djUsername);
      }
    }
  });

  if (djUsernames.size === 0) return shows;

  const now = Date.now();
  const profiles: Record<string, {
    displayName?: string;
    bio?: string;
    photoUrl?: string;
    location?: string;
    genres?: string[];
    isChannelUser?: boolean;
  }> = {};

  const toFetch: string[] = [];

  // Check cache first
  Array.from(djUsernames).forEach((normalized) => {
    const cached = djProfileCache.get(`username:${normalized}`);
    if (cached && now < cached.expiry && cached.data) {
      profiles[normalized] = cached.data as typeof profiles[string];
    } else {
      toFetch.push(normalized);
    }
  });

  if (toFetch.length > 0) {
    console.log(`[API /schedule] Looking up ${toFetch.length} DJ profiles (${djUsernames.size - toFetch.length} cached)`);

    const promises = toFetch.map(async (normalized) => {
      try {
        const usersSnapshot = await adminDb
          .collection("users")
          .where("chatUsernameNormalized", "==", normalized)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          const userData = usersSnapshot.docs[0].data();
          const djProfile = userData?.djProfile;
          const profile = {
            displayName: userData?.chatUsername,
            bio: djProfile?.bio || undefined,
            photoUrl: djProfile?.photoUrl || undefined,
            location: djProfile?.location || undefined,
            genres: djProfile?.genres || undefined,
            isChannelUser: true,
          };
          profiles[normalized] = profile;
          djProfileCache.set(`username:${normalized}`, { data: profile, expiry: now + DJ_PROFILE_CACHE_TTL });
          return;
        }

        const pendingSnapshot = await adminDb
          .collection("pending-dj-profiles")
          .where("chatUsernameNormalized", "==", normalized)
          .limit(1)
          .get();

        if (!pendingSnapshot.empty) {
          const data = pendingSnapshot.docs[0].data();
          const djProfile = data?.djProfile;
          const profile = {
            displayName: data?.chatUsername || data?.djName,
            bio: djProfile?.bio || undefined,
            photoUrl: djProfile?.photoUrl || undefined,
            location: djProfile?.location || undefined,
            genres: djProfile?.genres || undefined,
            isChannelUser: false,
          };
          profiles[normalized] = profile;
          djProfileCache.set(`username:${normalized}`, { data: profile, expiry: now + DJ_PROFILE_CACHE_TTL });
        } else {
          // Cache the miss too so we don't re-query
          djProfileCache.set(`username:${normalized}`, { data: null, expiry: now + DJ_PROFILE_CACHE_TTL });
        }
      } catch {
        // Silently ignore individual lookup errors
      }
    });

    await Promise.all(promises);
  }

  return shows.map((show) => {
    if (show.djUsername && show.stationId !== "broadcast" &&
        !isProfileMatchBlocked(blocked, show.djUsername, show.stationId)) {
      const profile = profiles[show.djUsername];
      if (profile) {
        return {
          ...show,
          dj: profile.displayName || show.dj,
          djBio: profile.bio,
          djPhotoUrl: profile.photoUrl,
          djLocation: profile.location,
          djGenres: profile.genres,
          isChannelUser: profile.isChannelUser,
        };
      }
    }
    return show;
  });
}

// ---------------------------------------------------------------------------
// Enrich broadcast shows with live profile data (with per-profile caching)
// ---------------------------------------------------------------------------

async function enrichBroadcastShows(shows: Show[]): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) return shows;

  const djUserIds = new Set<string>();
  shows.forEach((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      djUserIds.add(show.djUserId);
    }
  });

  if (djUserIds.size === 0) return shows;

  const now = Date.now();
  const djProfiles: Record<string, { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string }> = {};

  const toFetch: string[] = [];

  Array.from(djUserIds).forEach((userId) => {
    const cached = djProfileCache.get(`uid:${userId}`);
    if (cached && now < cached.expiry && cached.data) {
      djProfiles[userId] = cached.data as typeof djProfiles[string];
    } else {
      toFetch.push(userId);
    }
  });

  if (toFetch.length > 0) {
    const promises = toFetch.map(async (userId) => {
      try {
        const userDoc = await adminDb.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string } | undefined;
          if (djProfile) {
            const profile = {
              bio: djProfile.bio || undefined,
              photoUrl: djProfile.photoUrl || undefined,
              promoText: djProfile.promoText || undefined,
              promoHyperlink: djProfile.promoHyperlink || undefined,
              location: djProfile.location || undefined,
            };
            djProfiles[userId] = profile;
            djProfileCache.set(`uid:${userId}`, { data: profile, expiry: now + DJ_PROFILE_CACHE_TTL });
          }
        }
      } catch (err) {
        console.error(`[API /schedule] Failed to fetch broadcast DJ profile for ${userId}:`, err);
      }
    });

    await Promise.all(promises);
  }

  return shows.map((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      const profile = djProfiles[show.djUserId];
      if (profile) {
        return {
          ...show,
          djBio: show.djBio || profile.bio,
          djPhotoUrl: show.djPhotoUrl || profile.photoUrl,
          promoText: show.promoText || profile.promoText,
          promoUrl: show.promoUrl || profile.promoHyperlink,
          djLocation: profile.location,
          isChannelUser: true,
        };
      }
    }
    return show;
  });
}

// Get today's date string in America/Los_Angeles (prevents UTC rollover filtering out west-coast evening shows)
function getTodayPDT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

// ---------------------------------------------------------------------------
// Extract IRL events from the Firestore `events` collection
// ---------------------------------------------------------------------------

async function extractAdminEvents(): Promise<IRLShowData[]> {
  const db = getAdminDb();
  if (!db) return [];
  const now = Date.now();
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  const cutoff = now + twoWeeksMs;

  const snapshot = await db
    .collection("events")
    .where("date", ">=", now)
    .where("date", "<=", cutoff)
    .get();

  // Collect venue IDs that need slug lookups
  const venueIdsToResolve = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.venueId) venueIdsToResolve.add(data.venueId);
    if (data.linkedVenues) {
      for (const v of data.linkedVenues) {
        if (v.venueId) venueIdsToResolve.add(v.venueId);
      }
    }
  }

  // Batch-resolve venue slugs
  const venueSlugMap = new Map<string, string>();
  const venueIds = Array.from(venueIdsToResolve);
  for (let i = 0; i < venueIds.length; i += 10) {
    const batch = venueIds.slice(i, i + 10);
    const venueDocs = await Promise.all(batch.map((id) => db.collection("venues").doc(id).get()));
    for (const vDoc of venueDocs) {
      if (vDoc.exists) {
        const slug = vDoc.data()?.slug;
        if (slug) venueSlugMap.set(vDoc.id, slug);
      }
    }
  }

  const irlShows: IRLShowData[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data.location) continue;

    const dateObj = new Date(data.date);
    // Format date in PDT so late-night events don't shift to the next day
    const pdtParts = dateObj.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // "YYYY-MM-DD"
    const dateStr = pdtParts;

    const firstDJ = data.djs?.[0];

    // Compute click-through URL: DJ > collective > venue
    let linkUrl: string | undefined;
    const firstCollective = data.linkedCollectives?.[0];
    if (firstDJ?.djUsername) {
      linkUrl = `/dj/${firstDJ.djUsername}`;
    } else if (firstCollective?.collectiveSlug) {
      linkUrl = `/collective/${firstCollective.collectiveSlug}`;
    } else {
      const venueId = data.linkedVenues?.[0]?.venueId || data.venueId;
      const venueSlug = venueId ? venueSlugMap.get(venueId) : undefined;
      if (venueSlug) {
        linkUrl = `/venue/${venueSlug}`;
      }
    }

    // Venue display name: first linked venue, or legacy venueName
    const venueName = data.linkedVenues?.[0]?.venueName || data.venueName || undefined;

    // Build allDjs array for watchlist matching across all DJs in the lineup
    const allDjs = (data.djs || [])
      .filter((dj: { djUsername?: string; djName?: string }) => dj.djUsername || dj.djName)
      .map((dj: { djUsername?: string; djName?: string }) => ({
        djUsername: dj.djUsername || "",
        djName: dj.djName || "",
      }));

    irlShows.push({
      djUsername: firstDJ?.djUsername || "",
      djName: firstDJ?.djName || data.name || "Event",
      djPhotoUrl: firstDJ?.djPhotoUrl || undefined,
      djLocation: data.location,
      djGenres: data.genres || undefined,
      eventName: data.name || "Event",
      location: data.location,
      ticketUrl: data.ticketLink || "",
      date: dateStr,
      eventPhotoUrl: data.photo || undefined,
      venueName,
      linkUrl,
      allDjs: allDjs.length > 1 ? allDjs : undefined,
    });
  }

  // Resolve isChannelUser for each IRL show DJ using the shared profile cache
  const now2 = Date.now();
  const djUsernamesToCheck = new Set<string>();
  for (const show of irlShows) {
    if (show.djUsername) djUsernamesToCheck.add(show.djUsername.toLowerCase());
  }

  const channelUserMap = new Map<string, boolean>();
  const toFetch: string[] = [];
  for (const normalized of Array.from(djUsernamesToCheck)) {
    const cached = djProfileCache.get(`username:${normalized}`);
    if (cached && now2 < cached.expiry) {
      channelUserMap.set(normalized, cached.data?.isChannelUser === true);
    } else {
      toFetch.push(normalized);
    }
  }

  if (toFetch.length > 0 && db) {
    await Promise.all(toFetch.map(async (normalized) => {
      try {
        const usersSnap = await db.collection("users")
          .where("chatUsernameNormalized", "==", normalized)
          .limit(1)
          .get();
        if (!usersSnap.empty) {
          channelUserMap.set(normalized, true);
          djProfileCache.set(`username:${normalized}`, { data: { isChannelUser: true }, expiry: now2 + DJ_PROFILE_CACHE_TTL });
          return;
        }
        channelUserMap.set(normalized, false);
      } catch {
        // Silently ignore lookup errors
      }
    }));
  }

  for (const show of irlShows) {
    if (show.djUsername) {
      show.isChannelUser = channelUserMap.get(show.djUsername.toLowerCase()) ?? false;
    }
  }

  return irlShows;
}

// ---------------------------------------------------------------------------
// Extract DJ radio shows from pre-fetched DJ user docs (no extra query)
// ---------------------------------------------------------------------------

function extractDJRadioShows(djUserDocs: FirestoreDoc[]): Show[] {
  const radioShows: Show[] = [];
  const today = getTodayPDT();

  for (const doc of djUserDocs) {
    const userData = doc.data();
    const djProfile = userData?.djProfile;
    const chatUsername = userData?.chatUsername;
    const userEmail = userData?.email;

    if (!djProfile?.radioShows || !Array.isArray(djProfile.radioShows)) continue;

    for (const show of djProfile.radioShows) {
      if (!show.date) continue;
      if (show.date < today) continue;

      const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
      const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
      const showId = `dj-radio-${chatUsername?.replace(/\s+/g, "").toLowerCase()}-${show.date}-${radioNameSlug}-${showNameSlug}`;

      const timezone = show.timezone || "America/Los_Angeles";
      const timeStr = show.time || "12:00";
      const [hours, minutes] = timeStr.split(":").map(Number);

      const localDateTime = `${show.date}T${String(hours || 0).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}:00`;
      const testDate = new Date(localDateTime + "Z");
      const localStr = testDate.toLocaleString("en-US", { timeZone: timezone, hour12: false });
      const localMatch = localStr.match(/(\d+):(\d+):(\d+)/);
      const localHour = localMatch ? parseInt(localMatch[1]) : hours || 0;

      let offsetHours = (hours || 0) - localHour;
      if (offsetHours > 12) offsetHours -= 24;
      if (offsetHours < -12) offsetHours += 24;

      const startTimeMs = testDate.getTime() + (offsetHours * 60 * 60 * 1000);
      const startTime = new Date(startTimeMs).toISOString();
      const durationHours = parseFloat(show.duration) || 1;
      const endTime = new Date(startTimeMs + durationHours * 60 * 60 * 1000).toISOString();

      const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

      radioShows.push({
        id: showId,
        name: showName,
        dj: chatUsername || "Unknown DJ",
        startTime,
        endTime,
        stationId: "dj-radio",
        djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase(),
        djPhotoUrl: djProfile.photoUrl || undefined,
        djLocation: djProfile.location || undefined,
        djGenres: djProfile.genres || undefined,
        djEmail: userEmail || undefined,
        description: show.url ? `Listen at: ${show.url}` : undefined,
        imageUrl: djProfile.photoUrl || undefined,
        isChannelUser: true,
      });
    }
  }

  radioShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return radioShows;
}

// ---------------------------------------------------------------------------
// Extract radio shows from pending DJ profiles (same logic as extractDJRadioShows)
// ---------------------------------------------------------------------------

async function extractPendingDJRadioShows(): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) return [];

  const radioShows: Show[] = [];
  const today = getTodayPDT();

  try {
    const snapshot = await adminDb.collection("pending-dj-profiles").get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const djProfile = data?.djProfile;
      const chatUsername = data?.chatUsername || data?.djName;

      if (!djProfile?.radioShows || !Array.isArray(djProfile.radioShows)) continue;

      for (const show of djProfile.radioShows) {
        if (!show.date) continue;
        if (show.date < today) continue;

        const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
        const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
        const usernameSlug = chatUsername?.replace(/\s+/g, "").toLowerCase() || "pending";
        const showId = `dj-radio-pending-${usernameSlug}-${show.date}-${radioNameSlug}-${showNameSlug}`;

        const timezone = show.timezone || "America/Los_Angeles";
        const timeStr = show.time || "12:00";
        const [hours, minutes] = timeStr.split(":").map(Number);

        const localDateTime = `${show.date}T${String(hours || 0).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}:00`;
        const testDate = new Date(localDateTime + "Z");
        const localStr = testDate.toLocaleString("en-US", { timeZone: timezone, hour12: false });
        const localMatch = localStr.match(/(\d+):(\d+):(\d+)/);
        const localHour = localMatch ? parseInt(localMatch[1]) : hours || 0;

        let offsetHours = (hours || 0) - localHour;
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        const startTimeMs = testDate.getTime() + (offsetHours * 60 * 60 * 1000);
        const startTime = new Date(startTimeMs).toISOString();
        const durationHours = parseFloat(show.duration) || 1;
        const endTime = new Date(startTimeMs + durationHours * 60 * 60 * 1000).toISOString();

        const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

        radioShows.push({
          id: showId,
          name: showName,
          dj: chatUsername || "Unknown DJ",
          startTime,
          endTime,
          stationId: "dj-radio",
          djUsername: usernameSlug,
          djPhotoUrl: djProfile.photoUrl || undefined,
          djLocation: djProfile.location || undefined,
          djGenres: djProfile.genres || undefined,
          djEmail: data?.email || undefined,
          description: show.url ? `Listen at: ${show.url}` : undefined,
          imageUrl: djProfile.photoUrl || undefined,
          isChannelUser: false,
        });
      }
    }
  } catch (error) {
    console.error("[API /schedule] Failed to extract pending DJ radio shows:", error);
  }

  radioShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return radioShows;
}

// ---------------------------------------------------------------------------
// Fetch Open Graph metadata from a URL (title, image, description)
// ---------------------------------------------------------------------------

async function fetchOgMetadata(url: string): Promise<{ ogTitle?: string; ogImage?: string; ogDescription?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ChannelBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return {};
    const html = await res.text();

    const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i)?.[1]
      || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:title"/i)?.[1]
      || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const ogImage = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i)?.[1]
      || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/i)?.[1]
      || html.match(/<meta\s+(?:property|name)="twitter:image"\s+content="([^"]+)"/i)?.[1]
      || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="twitter:image"/i)?.[1];
    const ogDescription = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i)?.[1]
      || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:description"/i)?.[1];

    return {
      ogTitle: ogTitle?.trim(),
      ogImage: ogImage?.trim(),
      ogDescription: ogDescription?.trim(),
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Extract curator recommendations from pre-fetched DJ user docs
// ---------------------------------------------------------------------------

async function extractCuratorRecs(djUserDocs: FirestoreDoc[]): Promise<CuratorRec[]> {
  const recs: CuratorRec[] = [];

  for (const doc of djUserDocs) {
    const userData = doc.data();
    const djProfile = userData?.djProfile;
    const chatUsername = userData?.chatUsername;

    if (!chatUsername || !djProfile?.myRecs) continue;

    const djUsername = chatUsername.replace(/\s+/g, "").toLowerCase();
    const djName = djProfile.djName || chatUsername;
    const djPhotoUrl = djProfile.photoUrl || undefined;

    const myRecs = djProfile.myRecs;
    if (Array.isArray(myRecs)) {
      for (const item of myRecs) {
        if (item?.url || item?.title) {
          recs.push({
            djUsername,
            djName,
            djPhotoUrl,
            url: item.url || "",
            type: item.type || "music",
            title: item.title || undefined,
            imageUrl: item.imageUrl || undefined,
          });
        }
      }
    } else {
      if (myRecs.bandcampLinks) {
        for (const url of myRecs.bandcampLinks) {
          if (url) recs.push({ djUsername, djName, djPhotoUrl, url, type: "music" });
        }
      }
      if (myRecs.eventLinks) {
        for (const url of myRecs.eventLinks) {
          if (url) recs.push({ djUsername, djName, djPhotoUrl, url, type: "irl" });
        }
      }
    }
  }

  // Apply cached OG metadata immediately (non-blocking)
  const result = recs.map((rec) => {
    if (rec.url && (!rec.title || !rec.imageUrl)) {
      const cached = ogMetadataCache.get(rec.url);
      if (cached) return { ...rec, ...cached };
    }
    return rec;
  });

  // Fire off OG fetches in background for recs that need it (don't await)
  const recsNeedingOg = recs.filter(
    (rec) => rec.url && (!rec.title || !rec.imageUrl) && !ogMetadataCache.has(rec.url)
  );
  if (recsNeedingOg.length > 0) {
    Promise.allSettled(
      recsNeedingOg.map(async (rec) => {
        const og = await fetchOgMetadata(rec.url);
        if (og.ogTitle || og.ogImage) {
          ogMetadataCache.set(rec.url, og);
        }
      })
    ).catch(() => {});
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extract DJ profiles for genre-based discovery (no upcoming show required)
// ---------------------------------------------------------------------------

async function extractDJProfiles(djUserDocs: FirestoreDoc[]): Promise<DJProfile[]> {
  const profiles: DJProfile[] = [];
  const seenUsernames = new Set<string>();

  // Channel users first (from users collection)
  for (const doc of djUserDocs) {
    const data = doc.data();
    const djProfile = data?.djProfile as Record<string, unknown> | undefined;
    const chatUsername = data?.chatUsername as string | undefined;
    if (!chatUsername || !djProfile) continue;
    const username = chatUsername.replace(/\s+/g, "").toLowerCase();
    const genres = djProfile.genres as string[] | undefined;
    if (!genres || genres.length === 0) continue;
    seenUsernames.add(username);
    profiles.push({
      username,
      displayName: (djProfile.djName as string) || chatUsername,
      photoUrl: (djProfile.photoUrl as string) || undefined,
      location: (djProfile.location as string) || undefined,
      genres,
      bio: (djProfile.bio as string) || undefined,
      isChannelUser: true,
    });
  }

  // Pending DJs (from pending-dj-profiles collection)
  const db = getAdminDb();
  if (db) {
    try {
      const pendingSnapshot = await db.collection("pending-dj-profiles").get();
      for (const doc of pendingSnapshot.docs) {
        const data = doc.data();
        const djProfile = data?.djProfile as Record<string, unknown> | undefined;
        const chatUsername = (data?.chatUsername as string) || (data?.djName as string);
        if (!chatUsername || !djProfile) continue;
        const username = chatUsername.replace(/\s+/g, "").toLowerCase();
        if (seenUsernames.has(username)) continue;
        const genres = djProfile.genres as string[] | undefined;
        if (!genres || genres.length === 0) continue;
        seenUsernames.add(username);
        profiles.push({
          username,
          displayName: (djProfile.djName as string) || chatUsername,
          photoUrl: (djProfile.photoUrl as string) || undefined,
          location: (djProfile.location as string) || undefined,
          genres,
          bio: (djProfile.bio as string) || undefined,
          isChannelUser: false,
        });
      }
    } catch {
      // Silently ignore pending profile fetch errors
    }
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// GET handler with full response caching (until next hour boundary)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const now = Date.now();

    // Return cached response if still valid
    if (scheduleCache && now < scheduleCacheExpiry) {
      console.log(`[API /schedule] Serving from cache (expires in ${Math.round((scheduleCacheExpiry - now) / 1000)}s)`);
      return NextResponse.json(scheduleCache, {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" },
      });
    }

    // Fetch metadata shows and DJ user docs in parallel (1 Firestore query instead of 3)
    const [shows, djUserDocs] = await Promise.all([
      getAllShows(),
      fetchDJUserDocs(),
    ]);

    // Extract DJ radio shows, pending DJ radio shows, curator recs, events, and profiles in parallel
    const [djRadioShows, pendingDjRadioShows, curatorRecs, irlShows, djProfiles] = await Promise.all([
      Promise.resolve(extractDJRadioShows(djUserDocs)),
      extractPendingDJRadioShows(),
      extractCuratorRecs(djUserDocs),
      extractAdminEvents(),
      extractDJProfiles(djUserDocs),
    ]);

    // Merge DJ radio shows (from users and pending profiles) into the main shows array
    const allShows = [...shows, ...djRadioShows, ...pendingDjRadioShows];

    // Enrich shows with DJ profiles in parallel (disjoint subsets: broadcast vs non-broadcast)
    const nonBroadcastShows = allShows.filter(s => s.stationId !== 'broadcast');
    const broadcastShows = allShows.filter(s => s.stationId === 'broadcast');
    const [enrichedNonBroadcast, enrichedBroadcast] = await Promise.all([
      enrichShowsWithDJProfiles(nonBroadcastShows),
      enrichBroadcastShows(broadcastShows),
    ]);
    const enrichedShows = [...enrichedNonBroadcast, ...enrichedBroadcast];

    // Cache until next hour boundary
    const result = { shows: enrichedShows, irlShows, curatorRecs, djProfiles };
    scheduleCache = result;
    scheduleCacheExpiry = getNextHourMs();

    console.log(`[API /schedule] Cached until ${new Date(scheduleCacheExpiry).toISOString()}`);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], irlShows: [], curatorRecs: [], djProfiles: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
