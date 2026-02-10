import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";
import { getAdminDb } from "@/lib/firebase-admin";
import { Show, IRLShowData, CuratorRec } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Enrich shows with DJ profiles from Firebase using the pre-matched `p` field (djUsername)
 *
 * The metadata build does the expensive regex matching and adds `p` field to shows.
 * At runtime, we just do direct Firestore lookups by normalized username - O(unique profiles).
 *
 * This is much faster than the old approach which did O(shows × candidate names) lookups.
 */
async function enrichShowsWithDJProfiles(shows: Show[]): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping DJ profile enrichment");
    return shows;
  }

  // Collect unique djUsernames from shows (pre-matched in metadata build)
  const djUsernames = new Set<string>();
  shows.forEach((show) => {
    if (show.djUsername && show.stationId !== "broadcast") {
      djUsernames.add(show.djUsername);
    }
  });

  if (djUsernames.size === 0) {
    return shows;
  }

  console.log(`[API /schedule] Looking up ${djUsernames.size} DJ profiles from Firebase`);

  // Fetch profiles from Firebase (users collection first, then pending-dj-profiles)
  const profiles: Record<string, {
    displayName?: string;
    bio?: string;
    photoUrl?: string;
    location?: string;
    genres?: string[];
  }> = {};

  const promises = Array.from(djUsernames).map(async (normalized) => {
    try {
      // Try users collection first (claimed profiles have priority)
      const usersSnapshot = await adminDb
        .collection("users")
        .where("chatUsernameNormalized", "==", normalized)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        const userData = usersSnapshot.docs[0].data();
        const djProfile = userData?.djProfile;
        profiles[normalized] = {
          displayName: userData?.chatUsername,
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          location: djProfile?.location || undefined,
          genres: djProfile?.genres || undefined,
        };
        return;
      }

      // Fall back to pending-dj-profiles (query by chatUsernameNormalized field)
      const pendingSnapshot = await adminDb
        .collection("pending-dj-profiles")
        .where("chatUsernameNormalized", "==", normalized)
        .limit(1)
        .get();

      if (!pendingSnapshot.empty) {
        const data = pendingSnapshot.docs[0].data();
        const djProfile = data?.djProfile;
        profiles[normalized] = {
          displayName: data?.chatUsername || data?.djName,
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          location: djProfile?.location || undefined,
          genres: djProfile?.genres || undefined,
        };
      }
    } catch {
      // Silently ignore individual lookup errors
    }
  });

  await Promise.all(promises);

  console.log(`[API /schedule] Found ${Object.keys(profiles).length} profiles`);

  // Enrich shows with profile data
  return shows.map((show) => {
    if (show.djUsername && show.stationId !== "broadcast") {
      const profile = profiles[show.djUsername];
      if (profile) {
        return {
          ...show,
          dj: profile.displayName || show.dj,
          djBio: profile.bio,
          djPhotoUrl: profile.photoUrl,
          djLocation: profile.location,
          djGenres: profile.genres,
        };
      }
    }
    return show;
  });
}

/**
 * Enrich broadcast shows with live profile data from Firestore
 * Broadcast shows need real-time data (promo text, payment info)
 */
async function enrichBroadcastShows(shows: Show[]): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    return shows;
  }

  // Collect all unique DJ user IDs from broadcast shows
  const djUserIds = new Set<string>();
  shows.forEach((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      djUserIds.add(show.djUserId);
    }
  });

  if (djUserIds.size === 0) {
    return shows;
  }

  // Fetch broadcast DJ profiles from users collection
  const djProfiles: Record<string, { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string }> = {};

  const promises = Array.from(djUserIds).map(async (userId) => {
    try {
      const userDoc = await adminDb.collection("users").doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string } | undefined;
        if (djProfile) {
          djProfiles[userId] = {
            bio: djProfile.bio || undefined,
            photoUrl: djProfile.photoUrl || undefined,
            promoText: djProfile.promoText || undefined,
            promoHyperlink: djProfile.promoHyperlink || undefined,
            location: djProfile.location || undefined,
          };
        }
      }
    } catch (err) {
      console.error(`[API /schedule] Failed to fetch broadcast DJ profile for ${userId}:`, err);
    }
  });

  await Promise.all(promises);

  // Enrich broadcast shows only
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
        };
      }
    }
    return show;
  });
}

// Fetch IRL shows from DJ profiles
async function fetchIRLShows(): Promise<IRLShowData[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping IRL shows");
    return [];
  }

  try {
    // Query all users with DJ role who might have IRL shows
    const usersSnapshot = await adminDb
      .collection("users")
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .get();

    const irlShows: IRLShowData[] = [];
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const djProfile = userData?.djProfile;
      const chatUsername = userData?.chatUsername;

      if (!djProfile?.irlShows || !Array.isArray(djProfile.irlShows)) {
        return;
      }

      // Skip system/admin accounts without proper DJ profiles for IRL shows
      // These accounts shouldn't have their IRL shows displayed publicly
      if (!chatUsername || !djProfile.photoUrl) {
        return;
      }

      // Filter to upcoming shows only
      for (const show of djProfile.irlShows) {
        // Skip if no date (URL is optional - some events don't have ticket links)
        if (!show.date) continue;

        // Skip past shows (compare ISO date strings)
        if (show.date < today) continue;

        irlShows.push({
          djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase() || "",
          djName: chatUsername || "Unknown DJ",
          djPhotoUrl: djProfile.photoUrl || undefined,
          djLocation: djProfile.location || undefined,
          djGenres: djProfile.genres || undefined,
          eventName: show.name || "Event",
          location: show.location || "",
          ticketUrl: show.url,
          date: show.date,
        });
      }
    });

    // Sort by date ascending
    irlShows.sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate: keep only one IRL show per DJ per location (the soonest one)
    // This prevents the same DJ from appearing multiple times in the same city
    const deduped: IRLShowData[] = [];
    const seen = new Set<string>();
    for (const show of irlShows) {
      const key = `${show.djUsername}-${show.location.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(show);
      }
    }

    return deduped;
  } catch (error) {
    console.error("[API /schedule] Error fetching IRL shows:", error);
    return [];
  }
}

// Fetch radio shows from DJ profiles (DJ-added upcoming radio appearances)
async function fetchDJRadioShows(): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping DJ radio shows");
    return [];
  }

  try {
    // Query all users with DJ role who might have radio shows
    const usersSnapshot = await adminDb
      .collection("users")
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .get();

    const radioShows: Show[] = [];
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const djProfile = userData?.djProfile;
      const chatUsername = userData?.chatUsername;
      const userEmail = userData?.email;

      if (!djProfile?.radioShows || !Array.isArray(djProfile.radioShows)) {
        return;
      }

      // Filter to upcoming shows only
      for (const show of djProfile.radioShows) {
        // Skip if no date (radio name and other fields are optional)
        if (!show.date) continue;

        // Skip past shows (compare ISO date strings)
        if (show.date < today) continue;

        // Create a unique ID that won't collide with other shows
        // Include the show name to differentiate from external shows with same DJ
        const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
        const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
        const showId = `dj-radio-${chatUsername?.replace(/\s+/g, "").toLowerCase()}-${show.date}-${radioNameSlug}-${showNameSlug}`;

        // Parse date and time to create start/end times
        // Use the DJ's timezone if available, otherwise default to America/Los_Angeles
        const timezone = show.timezone || "America/Los_Angeles";
        const timeStr = show.time || "12:00"; // Default to noon if no time
        const [hours, minutes] = timeStr.split(":").map(Number);

        // Create ISO string with the time, then adjust for timezone
        // We need to find what UTC time corresponds to this local time
        const localDateTime = `${show.date}T${String(hours || 0).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}:00`;

        // Get timezone offset for this specific date/time
        // Create a date assuming UTC, then see what local time that produces in the target timezone
        const testDate = new Date(localDateTime + "Z");
        const localStr = testDate.toLocaleString("en-US", { timeZone: timezone, hour12: false });
        const localMatch = localStr.match(/(\d+):(\d+):(\d+)/);
        const localHour = localMatch ? parseInt(localMatch[1]) : hours || 0;

        // Calculate offset: if UTC 09:00 shows as 01:00 local, offset is -8 hours
        // So to get 09:00 local, we need 17:00 UTC (add 8 hours)
        let offsetHours = (hours || 0) - localHour;
        // Handle day wraparound
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        const startTimeMs = testDate.getTime() + (offsetHours * 60 * 60 * 1000);
        const startTime = new Date(startTimeMs).toISOString();

        // Use duration from show, default to 1 hour
        const durationHours = parseFloat(show.duration) || 1;
        const endTime = new Date(startTimeMs + durationHours * 60 * 60 * 1000).toISOString();

        // Build show name - use provided name, or construct from DJ and radio
        const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

        radioShows.push({
          id: showId,
          name: showName,
          dj: chatUsername || "Unknown DJ",
          startTime,
          endTime,
          stationId: "dj-radio", // Special station ID for DJ-added radio shows
          djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase(),
          djPhotoUrl: djProfile.photoUrl || undefined,
          djLocation: djProfile.location || undefined,
          djGenres: djProfile.genres || undefined,
          djEmail: userEmail || undefined, // Include email for prioritization
          // Store additional info for display
          description: show.url ? `Listen at: ${show.url}` : undefined,
          // Custom fields for DJ radio shows
          imageUrl: djProfile.photoUrl || undefined,
        });
      }
    });

    // Sort by date ascending
    radioShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return radioShows;
  } catch (error) {
    console.error("[API /schedule] Error fetching DJ radio shows:", error);
    return [];
  }
}

// Fetch Open Graph metadata from a URL (title, image, description)
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

// Fetch curator recommendations (myRecs) from DJ profiles
async function fetchCuratorRecs(): Promise<CuratorRec[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    return [];
  }

  try {
    const usersSnapshot = await adminDb
      .collection("users")
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .get();

    const recs: CuratorRec[] = [];

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const djProfile = userData?.djProfile;
      const chatUsername = userData?.chatUsername;

      if (!chatUsername || !djProfile?.myRecs) return;

      const djUsername = chatUsername.replace(/\s+/g, "").toLowerCase();
      const djName = chatUsername;
      const djPhotoUrl = djProfile.photoUrl || undefined;

      const myRecs = djProfile.myRecs;
      if (Array.isArray(myRecs)) {
        // New format: array of { type, title, url, imageUrl? }
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
        // Legacy format: { bandcampLinks, eventLinks }
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
    });

    // Fetch OG metadata for recs that need it (no DJ-provided title/image and have a URL)
    const enriched = await Promise.allSettled(
      recs.map(async (rec) => {
        if (rec.url && (!rec.title || !rec.imageUrl)) {
          const og = await fetchOgMetadata(rec.url);
          return { ...rec, ...og };
        }
        return rec;
      })
    );

    return enriched.map((result, i) =>
      result.status === "fulfilled" ? result.value : recs[i]
    );
  } catch (error) {
    console.error("[API /schedule] Error fetching curator recs:", error);
    return [];
  }
}

export async function GET() {
  try {
    // Fetch shows, IRL shows, DJ radio shows, and curator recs in parallel
    const [shows, irlShows, djRadioShows, curatorRecs] = await Promise.all([
      getAllShows(),
      fetchIRLShows(),
      fetchDJRadioShows(),
      fetchCuratorRecs(),
    ]);

    // Merge DJ radio shows into the main shows array
    const allShows = [...shows, ...djRadioShows];

    // Enrich shows with DJ profiles from Firebase using pre-matched `p` field
    // This does O(unique djUsernames) lookups instead of O(shows × candidate names)
    const showsWithProfiles = await enrichShowsWithDJProfiles(allShows);

    // Enrich broadcast shows with live data from Firestore (for promo text, payment info)
    const enrichedShows = await enrichBroadcastShows(showsWithProfiles);

    return NextResponse.json({ shows: enrichedShows, irlShows, curatorRecs });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], irlShows: [], curatorRecs: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
