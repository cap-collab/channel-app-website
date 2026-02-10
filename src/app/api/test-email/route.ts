import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import { queryUsersWhere, queryCollection, getUserFavorites } from "@/lib/firebase-rest";
import { wordBoundaryMatch } from "@/lib/dj-matching";
import { matchesGenre } from "@/lib/genres";
import { matchesCity } from "@/lib/city-detection";

const STATION_NAMES: Record<string, string> = {
  nts1: "NTS 1",
  nts2: "NTS 2",
  rinse: "Rinse FM",
  rinsefr: "Rinse FR",
  dublab: "dublab",
  subtle: "Subtle Radio",
  broadcast: "Channel Broadcast",
};

interface MetadataShow {
  n: string;
  s: string;
  e: string;
  j?: string | null;
  p?: string | null;
}

interface Metadata {
  v: number;
  updated: string;
  stations: {
    [stationKey: string]: MetadataShow[];
  };
}

interface ShowData {
  name: string;
  dj?: string;
  startTime: string;
  stationId: string;
  stationName: string;
  profileUsername?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  isIRL?: boolean;
  irlLocation?: string;
  irlTicketUrl?: string;
}

// Strip ALL non-alphanumeric characters and lowercase (like the cron does)
function normalizeForLookup(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Fetch OG metadata from a URL (with timeout)
async function fetchOgMetadata(url: string): Promise<{ ogTitle?: string; ogImage?: string }> {
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
      || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/i)?.[1];
    return { ogTitle: ogTitle?.trim(), ogImage: ogImage?.trim() };
  } catch {
    return {};
  }
}

async function sendTestEmail(to: string, section?: string) {
  const now = new Date();

  // ── Find the user by email ───────────────────────────────────────
  const matchingUsers = await queryUsersWhere("email", "EQUAL", to);
  const user = matchingUsers[0];
  if (!user) {
    return NextResponse.json({
      success: false,
      error: `No user found with email: ${to}`,
    }, { status: 404 });
  }

  const userId = user.id;
  const userData = user.data;
  const userTimezone = (userData.timezone as string) || "America/Los_Angeles";
  const irlCity = userData.irlCity as string | undefined;
  const preferredGenres = (userData.preferredGenres as string[]) || [];

  console.log(`[test-email] Found user ${userId}, timezone: ${userTimezone}, city: ${irlCity}, genres: ${preferredGenres.join(", ")}`);

  // ── Fetch ALL upcoming shows (same as cron) ──────────────────────
  const allShows: ShowData[] = [];

  // 1. From metadata (NTS, Rinse, dublab, Subtle)
  try {
    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { cache: "no-store" }
    );
    if (metadataResponse.ok) {
      const metadata: Metadata = await metadataResponse.json();
      for (const [stationKey, shows] of Object.entries(metadata.stations)) {
        if (Array.isArray(shows)) {
          for (const show of shows) {
            allShows.push({
              name: show.n,
              dj: show.j || undefined,
              startTime: show.s,
              stationId: stationKey,
              stationName: STATION_NAMES[stationKey] || stationKey,
              profileUsername: show.p || undefined,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("[test-email] Failed to fetch metadata:", error);
  }

  // 2. From Firebase broadcast slots
  try {
    const broadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "endTime", op: "GREATER_THAN", value: now }],
      500
    );
    for (const slot of broadcastSlots) {
      const data = slot.data;
      if ((data.status as string) === "cancelled") continue;
      allShows.push({
        name: data.showName as string,
        dj: data.djName as string | undefined,
        startTime: (data.startTime as Date)?.toISOString() || now.toISOString(),
        stationId: "broadcast",
        stationName: "Channel Broadcast",
      });
    }
  } catch (error) {
    console.error("[test-email] Failed to fetch broadcast slots:", error);
  }

  // 3. IRL events from DJ profiles
  const todayStr = now.toISOString().split("T")[0];
  let djUsers: Array<{ id: string; data: Record<string, unknown> }> = [];
  try {
    djUsers = await queryUsersWhere("role", "EQUAL", "dj");
    for (const djUser of djUsers) {
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const displayName = djUser.data.displayName as string | undefined;
      if (!djProfile) continue;

      const irlShows = djProfile.irlShows as Array<{
        name: string;
        location: string;
        url: string;
        date: string;
      }> | undefined;

      if (irlShows && Array.isArray(irlShows)) {
        for (const irlShow of irlShows) {
          if (!irlShow.date || irlShow.date < todayStr) continue;
          allShows.push({
            name: irlShow.name,
            dj: displayName,
            startTime: `${irlShow.date}T20:00:00.000Z`,
            stationId: "irl",
            stationName: "IRL Event",
            djUsername: chatUsername,
            isIRL: true,
            irlLocation: irlShow.location,
            irlTicketUrl: irlShow.url,
          });
        }
      }
    }
  } catch (error) {
    console.error("[test-email] Failed to fetch DJ users:", error);
  }

  // Build DJ profile map for photo/genre/location lookups
  const djProfileMap = new Map<string, { username: string; photoUrl?: string; genres?: string[]; location?: string }>();
  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const chatUsername = djUser.data.chatUsername as string | undefined;
    if (!chatUsername) continue;
    djProfileMap.set(normalizeForLookup(chatUsername), {
      username: chatUsername,
      photoUrl: (djProfile?.photoUrl as string) || undefined,
      genres: (djProfile?.genres as string[]) || undefined,
      location: (djProfile?.location as string) || undefined,
    });
  }

  // Also add pending-dj-profiles
  try {
    const pendingProfiles = await queryCollection("pending-dj-profiles", [], 10000);
    for (const pending of pendingProfiles) {
      const chatUsername = pending.data.chatUsername as string | undefined;
      const chatUsernameNormalized = pending.data.chatUsernameNormalized as string | undefined;
      const djProfile = pending.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;
      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        if (!djProfileMap.has(chatUsernameNormalized)) {
          djProfileMap.set(chatUsernameNormalized, {
            username: displayName,
            photoUrl,
            genres: (djProfile?.genres as string[]) || undefined,
            location: (djProfile?.location as string) || undefined,
          });
        }
        const normalized2 = normalizeForLookup(displayName);
        if (normalized2 !== chatUsernameNormalized && !djProfileMap.has(normalized2)) {
          djProfileMap.set(normalized2, djProfileMap.get(chatUsernameNormalized)!);
        }
      }
    }
  } catch (error) {
    console.error("[test-email] Failed to fetch pending profiles:", error);
  }

  // Resolve DJ photos for all shows
  const futureShows = allShows.filter((s) => new Date(s.startTime) > now);
  futureShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  for (const show of futureShows) {
    if (show.profileUsername) {
      const profile = djProfileMap.get(normalizeForLookup(show.profileUsername));
      if (profile) {
        show.djUsername = profile.username;
        show.djPhotoUrl = profile.photoUrl;
      }
    }
    if (!show.djUsername && show.dj) {
      const profile = djProfileMap.get(normalizeForLookup(show.dj));
      if (profile) {
        show.djUsername = profile.username;
        show.djPhotoUrl = profile.photoUrl;
      }
    }
  }

  console.log(`[test-email] ${futureShows.length} upcoming shows total`);

  // ── Section 1: User's REAL favorite shows ────────────────────────
  // Fetch all favorite types: show, irl, search (watchlist)
  const [showFavorites, irlFavorites, watchlistFavorites] = await Promise.all([
    getUserFavorites(userId, "show"),
    getUserFavorites(userId, "irl"),
    getUserFavorites(userId, "search"),
  ]);

  console.log(`[test-email] User favorites: ${showFavorites.length} shows, ${irlFavorites.length} IRL, ${watchlistFavorites.length} watchlist`);

  const favoriteShows: Array<{
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    isIRL?: boolean;
    irlLocation?: string;
    irlTicketUrl?: string;
  }> = [];
  const favoriteShowKeys = new Set<string>();

  // Match show favorites against upcoming shows
  for (const fav of showFavorites) {
    const favTerm = (fav.data.term as string)?.toLowerCase();
    const favStation = fav.data.stationId as string | undefined;
    if (!favTerm) continue;

    for (const show of futureShows) {
      const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
      if (favoriteShowKeys.has(showKey)) continue;

      if (show.name.toLowerCase() === favTerm && (!favStation || show.stationId === favStation)) {
        let djUsername = show.djUsername;
        let djPhotoUrl = show.djPhotoUrl;
        if (!djUsername && show.dj) {
          const profile = djProfileMap.get(normalizeForLookup(show.dj));
          if (profile) { djUsername = profile.username; djPhotoUrl = profile.photoUrl; }
        }
        favoriteShows.push({
          showName: show.name,
          djName: show.dj,
          djUsername,
          djPhotoUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: new Date(show.startTime),
          isIRL: show.isIRL,
          irlLocation: show.irlLocation,
          irlTicketUrl: show.irlTicketUrl,
        });
        favoriteShowKeys.add(showKey);
        break;
      }
    }
  }

  // Match watchlist (search) favorites against upcoming shows using word boundary matching
  for (const fav of watchlistFavorites) {
    const term = (fav.data.term as string)?.toLowerCase();
    if (!term) continue;

    for (const show of futureShows) {
      const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
      if (favoriteShowKeys.has(showKey)) continue;

      const nameMatch = wordBoundaryMatch(show.name, term);
      const djMatch = show.dj ? wordBoundaryMatch(show.dj, term) : false;

      if (nameMatch || djMatch) {
        let djUsername = show.djUsername;
        let djPhotoUrl = show.djPhotoUrl;
        if (!djUsername && show.dj) {
          const profile = djProfileMap.get(normalizeForLookup(show.dj));
          if (profile) { djUsername = profile.username; djPhotoUrl = profile.photoUrl; }
        }
        favoriteShows.push({
          showName: show.name,
          djName: show.dj,
          djUsername,
          djPhotoUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: new Date(show.startTime),
          isIRL: show.isIRL,
          irlLocation: show.irlLocation,
          irlTicketUrl: show.irlTicketUrl,
        });
        favoriteShowKeys.add(showKey);
      }
    }
  }

  // Match IRL favorites against upcoming IRL shows
  for (const fav of irlFavorites) {
    const favDjName = (fav.data.djName as string) || (fav.data.term as string);
    if (!favDjName) continue;

    for (const show of futureShows) {
      if (!show.isIRL) continue;
      const showKey = `${show.name.toLowerCase()}-irl`;
      if (favoriteShowKeys.has(showKey)) continue;

      if (show.dj && wordBoundaryMatch(show.dj, favDjName)) {
        favoriteShows.push({
          showName: show.name,
          djName: show.dj,
          djUsername: show.djUsername,
          djPhotoUrl: show.djPhotoUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: new Date(show.startTime),
          isIRL: true,
          irlLocation: show.irlLocation,
          irlTicketUrl: show.irlTicketUrl,
        });
        favoriteShowKeys.add(showKey);
        break;
      }
    }
  }

  favoriteShows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  console.log(`[test-email] Matched ${favoriteShows.length} favorite shows: ${favoriteShows.map((s) => s.showName).join(", ")}`);

  // ── Section 2: Curator recs from followed DJs ────────────────────
  interface CuratorRecData {
    djName: string;
    djUsername: string;
    djPhotoUrl?: string;
    url: string;
    type: "music" | "irl" | "online";
    title?: string;
    imageUrl?: string;
    ogTitle?: string;
    ogImage?: string;
  }
  const curatorRecs: CuratorRecData[] = [];

  // Watchlist terms are the DJs the user follows
  const followedTerms = watchlistFavorites.map((w) => (w.data.term as string)?.toLowerCase()).filter(Boolean);

  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const chatUsername = djUser.data.chatUsername as string | undefined;
    if (!chatUsername || !djProfile) continue;

    // Check if this DJ is followed by the user
    const djUsernameLower = chatUsername.replace(/\s+/g, "").toLowerCase();
    const isFollowed = followedTerms.some((term) =>
      term === djUsernameLower || term === chatUsername.toLowerCase()
    );
    if (!isFollowed) continue;

    const rawRecs = djProfile.myRecs;
    if (!rawRecs) continue;

    const djPhotoUrl = (djProfile.photoUrl as string) || undefined;

    if (Array.isArray(rawRecs)) {
      for (const item of rawRecs as Array<{ type?: string; title?: string; url?: string; imageUrl?: string }>) {
        if (curatorRecs.length >= 4) break;
        if (item?.url || item?.title) {
          curatorRecs.push({ djUsername: djUsernameLower, djName: chatUsername, djPhotoUrl, url: item.url || "", type: (item.type as "music" | "irl" | "online") || "music", title: item.title, imageUrl: item.imageUrl });
        }
      }
    } else {
      const myRecs = rawRecs as { bandcampLinks?: string[]; eventLinks?: string[] };
      for (const url of myRecs.bandcampLinks || []) {
        if (url && curatorRecs.length < 4) {
          curatorRecs.push({ djUsername: djUsernameLower, djName: chatUsername, djPhotoUrl, url, type: "music" });
        }
      }
      for (const url of myRecs.eventLinks || []) {
        if (url && curatorRecs.length < 4) {
          curatorRecs.push({ djUsername: djUsernameLower, djName: chatUsername, djPhotoUrl, url, type: "irl" });
        }
      }
    }
    if (curatorRecs.length >= 4) break;
  }

  // Enrich curator recs with OG metadata
  if (curatorRecs.length > 0) {
    const ogResults = await Promise.allSettled(
      curatorRecs.map((rec) => fetchOgMetadata(rec.url))
    );
    ogResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        if (result.value.ogTitle) curatorRecs[i].ogTitle = result.value.ogTitle;
        if (result.value.ogImage) curatorRecs[i].ogImage = result.value.ogImage;
      }
    });
  }

  console.log(`[test-email] Found ${curatorRecs.length} curator recs from followed DJs`);

  // ── Section 3: Picked-for-you shows ─────────────────────────────
  // Priority: 1) genre match, 2) city match, 3) any online show with profile+photo
  // No IRL events unless user has location set
  const preferenceShows: Array<{
    showName: string;
    djName?: string;
    djUsername?: string;
    djPhotoUrl?: string;
    stationName: string;
    stationId: string;
    startTime: Date;
    isIRL?: boolean;
    irlLocation?: string;
    irlTicketUrl?: string;
    matchLabel?: string;
  }> = [];

  const prefShowKeys = new Set<string>();

  // Step 1: Genre-matched shows
  if (preferredGenres.length > 0) {
    for (const show of futureShows) {
      const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
      if (favoriteShowKeys.has(showKey)) continue;
      if (prefShowKeys.has(showKey)) continue;
      if (preferenceShows.length >= 6) break;

      // Skip IRL events if user has no location set
      if (show.isIRL && !irlCity) continue;

      let djGenres: string[] | undefined;
      let djLocation: string | undefined;
      let djUsername = show.djUsername;
      let djPhotoUrl = show.djPhotoUrl;

      if (show.dj) {
        const profile = djProfileMap.get(normalizeForLookup(show.dj));
        if (profile) {
          djGenres = profile.genres;
          djLocation = profile.location;
          if (!djUsername) djUsername = profile.username;
          if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
        }
      }

      if (!djUsername || !djPhotoUrl) continue;

      const genreMatch = djGenres
        ? preferredGenres.some((g) => matchesGenre(djGenres!, g))
        : false;

      const showLocation = show.isIRL ? show.irlLocation : djLocation;
      const cityMatch = irlCity && showLocation ? matchesCity(showLocation, irlCity) : false;

      if (genreMatch) {
        const matchParts: string[] = [];
        if (cityMatch && irlCity) matchParts.push(irlCity.toUpperCase());
        const matchingGenres = preferredGenres.filter((g) => djGenres && matchesGenre(djGenres, g));
        matchParts.push(matchingGenres.map((g) => g.toUpperCase()).join(" + "));

        preferenceShows.push({
          showName: show.name,
          djName: show.dj,
          djUsername,
          djPhotoUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: new Date(show.startTime),
          isIRL: show.isIRL,
          irlLocation: show.irlLocation,
          irlTicketUrl: show.irlTicketUrl,
          matchLabel: matchParts.join(" + "),
        });
        prefShowKeys.add(showKey);
      }
    }
  }

  // Step 2: City-matched shows (if still not enough and user has city)
  if (preferenceShows.length < 4 && irlCity) {
    for (const show of futureShows) {
      const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
      if (favoriteShowKeys.has(showKey)) continue;
      if (prefShowKeys.has(showKey)) continue;
      if (preferenceShows.length >= 6) break;

      let djLocation: string | undefined;
      let djUsername = show.djUsername;
      let djPhotoUrl = show.djPhotoUrl;

      if (show.dj) {
        const profile = djProfileMap.get(normalizeForLookup(show.dj));
        if (profile) {
          djLocation = profile.location;
          if (!djUsername) djUsername = profile.username;
          if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
        }
      }

      if (!djUsername || !djPhotoUrl) continue;

      const showLocation = show.isIRL ? show.irlLocation : djLocation;
      const cityMatch = showLocation ? matchesCity(showLocation, irlCity) : false;

      if (cityMatch) {
        preferenceShows.push({
          showName: show.name,
          djName: show.dj,
          djUsername,
          djPhotoUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: new Date(show.startTime),
          isIRL: show.isIRL,
          irlLocation: show.irlLocation,
          irlTicketUrl: show.irlTicketUrl,
          matchLabel: irlCity.toUpperCase(),
        });
        prefShowKeys.add(showKey);
      }
    }
  }

  // Step 3: Any online show with profile+photo (no IRL)
  if (preferenceShows.length < 4) {
    for (const show of futureShows) {
      if (preferenceShows.length >= 6) break;
      if (!show.dj) continue;
      if (show.isIRL) continue; // No IRL in random fallback
      const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
      if (favoriteShowKeys.has(showKey)) continue;
      if (prefShowKeys.has(showKey)) continue;
      if (!show.djUsername || !show.djPhotoUrl) continue;

      preferenceShows.push({
        showName: show.name,
        djName: show.dj,
        djUsername: show.djUsername,
        djPhotoUrl: show.djPhotoUrl,
        stationName: show.stationName,
        stationId: show.stationId,
        startTime: new Date(show.startTime),
      });
      prefShowKeys.add(showKey);
    }
  }

  console.log(`[test-email] Found ${preferenceShows.length} preference shows (incl. fallbacks)`);

  // Filter by section if specified
  const finalFavorites = section === "2" || section === "3" ? [] : favoriteShows;
  const finalRecs = section === "1" || section === "3" ? [] : curatorRecs;
  const finalPrefs = section === "1" || section === "2" ? [] : preferenceShows;

  try {
    const success = await sendWatchlistDigestEmail({
      to,
      userTimezone,
      favoriteShows: finalFavorites,
      curatorRecs: finalRecs,
      preferenceShows: finalPrefs,
      preferredGenres,
    });

    if (success) {
      return NextResponse.json({
        success: true,
        message: `Test email sent to ${to}`,
        userId,
        section: section || "all",
        favoriteShowCount: finalFavorites.length,
        curatorRecCount: finalRecs.length,
        preferenceShowCount: finalPrefs.length,
        favoriteShowNames: finalFavorites.map((s) => s.showName),
        curatorRecDJs: finalRecs.map((r) => r.djName),
        curatorRecDetails: finalRecs.map((r) => ({ title: r.title, imageUrl: r.imageUrl, ogTitle: r.ogTitle, ogImage: r.ogImage, url: r.url })),
        preferenceShowNames: finalPrefs.map((s) => s.showName),
      });
    } else {
      return NextResponse.json({
        success: false,
        error: "Failed to send email - check server logs (no content to send?)",
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Test email error:", error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}

// Test endpoint to preview the watchlist digest email — uses the REAL user's favorites
// Query params:
//   ?secret=XXX          (required)
//   &to=email@example    (optional, defaults to cap@channel-app.com)
//   &section=1|2|3       (optional, test individual sections — 1=favorites, 2=recs, 3=preferences)
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";
  const section = request.nextUrl.searchParams.get("section") || undefined;
  return sendTestEmail(to, section);
}

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";
  const section = request.nextUrl.searchParams.get("section") || undefined;
  return sendTestEmail(to, section);
}
