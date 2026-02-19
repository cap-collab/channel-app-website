import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  updateUser,
  addUserFavorite,
  isRestApiConfigured,
  queryCollection,
} from "@/lib/firebase-rest";
import { wordBoundaryMatch } from "@/lib/dj-matching";
import { matchesGenre } from "@/lib/genres";
import { matchesCity } from "@/lib/city-detection";

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Metadata uses short keys
interface MetadataShow {
  n: string;
  s: string;
  e: string;
  j?: string | null;
  p?: string | null; // profile username (for DJ profile link)
}

interface Metadata {
  v: number;
  updated: string;
  stations: {
    [stationKey: string]: MetadataShow[];
  };
}

interface Show {
  name: string;
  dj?: string;
  startTime: string;
  stationId: string;
  stationName: string;
}

const STATION_NAMES: Record<string, string> = {
  nts1: "NTS 1",
  nts2: "NTS 2",
  rinse: "Rinse FM",
  rinsefr: "Rinse FR",
  dublab: "dublab",
  subtle: "Subtle Radio",
  broadcast: "Channel Broadcast",
};

// Extended show type that includes user linking info for broadcast shows
interface BroadcastShow extends Show {
  djUserId?: string;
  djEmail?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  profileUsername?: string; // `p` field from metadata - authoritative DJ profile key
  isIRL?: boolean;
  irlLocation?: string;
  irlTicketUrl?: string;
}

// Word boundary matching for DJ/show names
// e.g. "PAC" matches "PAC" or "Night PAC" but NOT "pace" or "space"
function containsMatch(text: string, term: string): boolean {
  return wordBoundaryMatch(text, term);
}

// Generate a unique ID for a show to track deduplication
// Format: "stationId-showName-startDate" (normalized)
function generateShowId(stationId: string, showName: string, startTime: Date): string {
  const dateStr = startTime.toISOString().split("T")[0]; // YYYY-MM-DD
  const normalizedName = showName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${stationId}-${normalizedName}-${dateStr}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Test mode: ?testEmail=user@example.com bypasses schedule/dedup and only sends to that email
  const testEmail = request.nextUrl.searchParams.get("testEmail");

  if (!isRestApiConfigured()) {
    return NextResponse.json(
      { error: "Firebase REST API not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch current metadata
    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { cache: "no-store" }
    );

    if (!metadataResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch metadata" },
        { status: 500 }
      );
    }

    const metadata: Metadata = await metadataResponse.json();

    // Get all shows from all stations (external metadata)
    const allShows: BroadcastShow[] = [];
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

    // Also fetch Channel Broadcast shows from Firebase
    const now = new Date();
    const broadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "endTime", op: "GREATER_THAN", value: now }],
      500
    );

    console.log(`[watchlist-digest] Found ${broadcastSlots.length} upcoming broadcast slots`);

    for (const slot of broadcastSlots) {
      const data = slot.data;
      const status = data.status as string;
      if (status === "cancelled") continue;

      const startTime = data.startTime as Date;
      const showName = data.showName as string;
      const djName = data.djName as string | undefined;
      const djUserId = data.djUserId as string | undefined;
      const djEmail = data.djEmail as string | undefined;

      allShows.push({
        name: showName,
        dj: djName,
        startTime: startTime?.toISOString() || now.toISOString(),
        stationId: "broadcast",
        stationName: "Channel Broadcast",
        djUserId,
        djEmail,
      });
    }

    // Also fetch IRL events from DJ profiles
    const todayStr = now.toISOString().split("T")[0];
    const djUsers = await queryUsersWhere("role", "EQUAL", "dj");
    let irlEventsAdded = 0;

    for (const djUser of djUsers) {
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const displayName = djUser.data.displayName as string | undefined;

      if (!djProfile) continue;

      // Get IRL shows from DJ profile
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
            startTime: `${irlShow.date}T20:00:00.000Z`, // Default to 8 PM
            stationId: "irl",
            stationName: "IRL Event",
            djUserId: djUser.id,
            djUsername: chatUsername,
            isIRL: true,
            irlLocation: irlShow.location,
            irlTicketUrl: irlShow.url,
          });
          irlEventsAdded++;
        }
      }

      // Get radio shows from DJ profile
      const radioShows = djProfile.radioShows as Array<{
        name: string;
        radioName: string;
        url: string;
        date: string;
        time: string;
        duration: string;
        timezone?: string;
      }> | undefined;

      if (radioShows && Array.isArray(radioShows)) {
        for (const radioShow of radioShows) {
          if (!radioShow.date || radioShow.date < todayStr) continue;

          // Get the timezone the DJ entered the time in (default to America/New_York for legacy data)
          const djTimezone = radioShow.timezone || "America/New_York";
          const timeStr = radioShow.time || "12:00";

          // Convert DJ's local time to UTC using Intl.DateTimeFormat
          // Strategy: Find what UTC time, when formatted in djTimezone, equals the DJ's input
          const localDateTimeStr = `${radioShow.date}T${timeStr}:00`;

          // Parse the DJ's intended local time as if it were UTC (baseline)
          const naiveDate = new Date(localDateTimeStr + "Z");

          // Format this UTC time in the DJ's timezone to find the offset
          const djFormatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: djTimezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          });
          const formattedInDjTz = djFormatter.format(naiveDate).replace(", ", "T").replace(" ", "");

          // The difference between the naive interpretation and the DJ timezone interpretation
          // tells us the offset. We need to adjust so the DJ's local time is correct.
          const djTzDate = new Date(formattedInDjTz + "Z");
          const offsetMs = naiveDate.getTime() - djTzDate.getTime();

          // Apply offset to get correct UTC time
          const correctUtcDate = new Date(naiveDate.getTime() + offsetMs);
          const startTime = correctUtcDate.toISOString();

          allShows.push({
            name: radioShow.name,
            dj: displayName,
            startTime,
            stationId: radioShow.radioName.toLowerCase().replace(/\s+/g, "-"),
            stationName: radioShow.radioName,
            djUserId: djUser.id,
            djUsername: chatUsername,
          });
        }
      }
    }

    console.log(`[watchlist-digest] Added ${irlEventsAdded} IRL events from DJ profiles`);
    console.log(`[watchlist-digest] Total shows to check: ${allShows.length}`);

    // Build a lookup map from chatUsernameNormalized to profile info
    // Key: chatUsernameNormalized from DB (authoritative)
    // Value: { username (for URL), photoUrl (for picture) }
    // Sources: 1) pending-dj-profiles, 2) users with DJ role
    const djNameToProfile = new Map<string, { username: string; photoUrl?: string; genres?: string[]; location?: string }>();
    // Normalize to match how pending-dj-profiles stores chatUsernameNormalized
    // Strip ALL non-alphanumeric characters and lowercase (like dublab sync does)
    const normalizeForLookup = (str: string): string => {
      return str.toLowerCase().replace(/[^a-z0-9]/g, "");
    };

    // 1. Add from pending-dj-profiles (these take priority)
    const pendingProfiles = await queryCollection("pending-dj-profiles", [], 10000);
    for (const pending of pendingProfiles) {
      const chatUsername = pending.data.chatUsername as string | undefined;
      const chatUsernameNormalized = pending.data.chatUsernameNormalized as string | undefined;
      const djProfile = pending.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        const genres = (djProfile?.genres as string[]) || undefined;
        const location = (djProfile?.location as string) || undefined;
        const profileInfo = { username: displayName, photoUrl, genres, location };
        // Index by the stored chatUsernameNormalized (primary key)
        djNameToProfile.set(chatUsernameNormalized, profileInfo);
        // Also index by our normalized version of chatUsername
        const normalizedChatUsername = normalizeForLookup(displayName);
        if (normalizedChatUsername !== chatUsernameNormalized) {
          djNameToProfile.set(normalizedChatUsername, profileInfo);
        }
        // Also index by normalized version without hyphens (subtle uses hyphens, dublab doesn't)
        const withoutHyphens = chatUsernameNormalized.replace(/-/g, "");
        if (withoutHyphens !== chatUsernameNormalized && withoutHyphens !== normalizedChatUsername) {
          djNameToProfile.set(withoutHyphens, profileInfo);
        }
      }
    }
    console.log(`[watchlist-digest] Added ${pendingProfiles.length} pending DJ profiles to map`);

    // 2. Add from approved DJ users (don't overwrite pending profiles)
    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const chatUsernameNormalized = djUser.data.chatUsernameNormalized as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        const genres = (djProfile?.genres as string[]) || undefined;
        const location = (djProfile?.location as string) || undefined;
        const profileInfo = { username: displayName, photoUrl, genres, location };
        if (!djNameToProfile.has(chatUsernameNormalized)) {
          djNameToProfile.set(chatUsernameNormalized, profileInfo);
        }
        // Also index by our normalized version of chatUsername
        const normalizedChatUsername = normalizeForLookup(displayName);
        if (normalizedChatUsername !== chatUsernameNormalized && !djNameToProfile.has(normalizedChatUsername)) {
          djNameToProfile.set(normalizedChatUsername, profileInfo);
        }
        // Also index by normalized version without hyphens
        const withoutHyphens = chatUsernameNormalized.replace(/-/g, "");
        if (withoutHyphens !== chatUsernameNormalized && withoutHyphens !== normalizedChatUsername && !djNameToProfile.has(withoutHyphens)) {
          djNameToProfile.set(withoutHyphens, profileInfo);
        }
      }
    }

    console.log(`[watchlist-digest] Built DJ profile map with ${djNameToProfile.size} total entries`);

    // Debug: Log some sample entries with photos
    let withPhotos = 0;
    let withoutPhotos = 0;
    djNameToProfile.forEach((profile, key) => {
      if (profile.photoUrl) {
        withPhotos++;
        if (withPhotos <= 3) {
          console.log(`[watchlist-digest] Sample profile with photo: ${key} -> ${profile.username}, photoUrl: ${profile.photoUrl?.substring(0, 50)}...`);
        }
      } else {
        withoutPhotos++;
      }
    });
    console.log(`[watchlist-digest] Profiles with photos: ${withPhotos}, without: ${withoutPhotos}`);

    // Collect curator recs from DJ profiles (for Section 2 of digest email)
    interface CuratorRecData {
      djUsername: string;
      djName: string;
      djPhotoUrl?: string;
      url: string;
      type: "music" | "irl" | "online";
      title?: string;
      imageUrl?: string;
      ogTitle?: string;
      ogImage?: string;
    }
    const allCuratorRecs: CuratorRecData[] = [];
    for (const djUser of djUsers) {
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const chatUsername = djUser.data.chatUsername as string | undefined;
      if (!chatUsername || !djProfile) continue;

      const rawRecs = djProfile.myRecs;
      if (!rawRecs) continue;

      const djUsername = chatUsername.replace(/\s+/g, "").toLowerCase();
      const djPhotoUrl = (djProfile.photoUrl as string) || undefined;

      if (Array.isArray(rawRecs)) {
        for (const item of rawRecs as Array<{ type?: string; title?: string; url?: string; imageUrl?: string }>) {
          if (item?.url || item?.title) {
            allCuratorRecs.push({ djUsername, djName: chatUsername, djPhotoUrl, url: item.url || "", type: (item.type as "music" | "irl" | "online") || "music", title: item.title, imageUrl: item.imageUrl });
          }
        }
      } else {
        const myRecs = rawRecs as { bandcampLinks?: string[]; eventLinks?: string[] };
        for (const url of myRecs.bandcampLinks || []) {
          if (url) allCuratorRecs.push({ djUsername, djName: chatUsername, djPhotoUrl, url, type: "music" });
        }
        for (const url of myRecs.eventLinks || []) {
          if (url) allCuratorRecs.push({ djUsername, djName: chatUsername, djPhotoUrl, url, type: "irl" });
        }
      }
    }

    // Fetch OG metadata for curator recs in parallel (with timeout)
    if (allCuratorRecs.length > 0) {
      const ogResults = await Promise.allSettled(
        allCuratorRecs.map(async (rec) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(rec.url, {
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
        })
      );
      ogResults.forEach((result, i) => {
        if (result.status === "fulfilled" && result.value) {
          if (result.value.ogTitle) allCuratorRecs[i].ogTitle = result.value.ogTitle;
          if (result.value.ogImage) allCuratorRecs[i].ogImage = result.value.ogImage;
        }
      });
    }
    console.log(`[watchlist-digest] Collected ${allCuratorRecs.length} curator recs from DJ profiles`);

    // Get ALL users who have watchlist items (type="search" favorites)
    // We need to query all users and check their favorites
    // First get users with email notifications enabled (for email sending)
    const usersWithNotifications = await queryUsersWhere("emailNotifications.watchlistMatch", "EQUAL", true);

    // Also get users who may have watchlist items but no email notifications
    // We'll process them for auto-favoriting but won't send emails
    const allUsersWithWatchlist = new Map<string, { wantsEmail: boolean }>();

    for (const user of usersWithNotifications) {
      allUsersWithWatchlist.set(user.id, { wantsEmail: true });
    }

    // Query all users who have any favorites of type "search" (watchlist items)
    // This is a workaround since we can't directly query subcollections
    // We'll check each user's favorites during processing
    const allUsers = await queryUsersWhere("createdAt", "GREATER_THAN", new Date(0));
    for (const user of allUsers) {
      if (!allUsersWithWatchlist.has(user.id)) {
        allUsersWithWatchlist.set(user.id, { wantsEmail: false });
      }
    }

    console.log(`[watchlist-digest] Processing ${allUsersWithWatchlist.size} users`);

    const users = Array.from(allUsersWithWatchlist.entries()).map(([id, info]) => ({
      id,
      ...info,
    }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let emailsSent = 0;
    let usersProcessed = 0;

    let showsAddedToFavorites = 0;

    for (const user of users) {
      const userData = await getUser(user.id);
      if (!userData) continue;

      const userEmail = userData.email as string | undefined;
      const userId = user.id;

      // Test mode: skip users that don't match the test email
      if (testEmail && userEmail?.toLowerCase() !== testEmail.toLowerCase()) {
        usersProcessed++;
        continue;
      }


      // Check if we already processed this user today (for email) — skip in test mode
      const lastEmailAt = userData.lastWatchlistEmailAt as Date | string | undefined;
      const alreadySentEmailToday = !testEmail && lastEmailAt && new Date(lastEmailAt) >= today;

      // Track which shows we've already emailed about (by unique show ID)
      // Key: "stationId-showName-startDate" (e.g. "nts1-myshow-2026-02-10")
      const lastWatchlistDigestShows = (userData.lastWatchlistDigestShows as Record<string, string>) || {};
      const lastSentCuratorRecs = (userData.lastSentCuratorRecs as string[]) || [];
      const sentRecUrls = new Set(lastSentCuratorRecs);

      // Get user's watchlist (search type favorites)
      const favorites = await getUserFavorites(user.id, "search");
      const watchlistDocs = favorites.map((doc) => ({
        id: doc.id,
        term: doc.data.term as string,
      }));

      // Find matching shows from watchlist
      const matches: Array<{
        showId: string; // Unique ID for deduplication
        showName: string;
        djName?: string;
        djUsername?: string;
        djPhotoUrl?: string;
        stationName: string;
        stationId: string;
        startTime: Date;
        searchTerm: string;
        watchlistDocId: string;
        isNewForEmail: boolean;
        isIRL?: boolean;
        irlLocation?: string;
        irlTicketUrl?: string;
      }> = [];

      for (const show of allShows) {
        const showStart = new Date(show.startTime);
        const broadcastShow = show as BroadcastShow;

        // Skip past shows
        if (showStart < now) continue;

        let matched = false;
        let matchedTerm = "";

        // Check each watchlist term
        for (const watchlistDoc of watchlistDocs) {
          const termLower = watchlistDoc.term.toLowerCase();

          // Word boundary matching: "stu" matches "Stu's Show" but NOT "Stuart"
          if (
            containsMatch(show.name, termLower) ||
            (show.dj && containsMatch(show.dj, termLower))
          ) {
            matched = true;
            matchedTerm = watchlistDoc.term;
            break;
          }
        }

        // For broadcast shows, also check if user's ID or email matches the DJ
        if (!matched && show.stationId === "broadcast") {
          if (
            (broadcastShow.djUserId && broadcastShow.djUserId === userId) ||
            (broadcastShow.djEmail && userEmail && broadcastShow.djEmail.toLowerCase() === userEmail.toLowerCase())
          ) {
            matched = true;
            matchedTerm = "your broadcast";
          }
        }

        if (matched) {
          // Look up DJ profile info
          // Priority: 1) metadata `p` field (authoritative profile username)
          //           2) broadcastShow.djUsername (already set for broadcast/IRL shows)
          //           3) fuzzy match on search term or DJ name
          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;

          // Use metadata `p` field as primary lookup key
          if (broadcastShow.profileUsername) {
            const lookupKey = normalizeForLookup(broadcastShow.profileUsername);
            const djProfile = djNameToProfile.get(lookupKey);
            if (djProfile) {
              djUsername = djProfile.username;
              djPhotoUrl = djProfile.photoUrl;
              if (!djPhotoUrl) {
                console.log(`[watchlist-digest] Profile found for "${broadcastShow.profileUsername}" (key: ${lookupKey}) but no photoUrl`);
              }
            } else {
              console.log(`[watchlist-digest] No profile found for "${broadcastShow.profileUsername}" (key: ${lookupKey})`);
              // Even without a Firebase profile, use `p` as the username for links
              djUsername = djUsername || broadcastShow.profileUsername;
            }
          }

          // Fallback: fuzzy match on search term or DJ name
          if (!djUsername) {
            let djProfile = matchedTerm ? djNameToProfile.get(normalizeForLookup(matchedTerm)) : undefined;
            if (!djProfile && show.dj) {
              djProfile = djNameToProfile.get(normalizeForLookup(show.dj));
            }
            if (djProfile) {
              djUsername = djProfile.username;
              djPhotoUrl = djProfile.photoUrl;
            }
          }

          // Generate unique show ID for deduplication
          const showId = generateShowId(show.stationId, show.name, showStart);

          // A show is "new for email" if we haven't emailed about it before
          const isNewForEmail = !lastWatchlistDigestShows[showId];

          matches.push({
            showId,
            showName: show.name,
            djName: show.dj,
            djUsername,
            djPhotoUrl,
            stationName: show.stationName,
            stationId: show.stationId,
            startTime: showStart,
            searchTerm: matchedTerm,
            watchlistDocId: "",
            isNewForEmail,
            isIRL: broadcastShow.isIRL,
            irlLocation: broadcastShow.irlLocation,
            irlTicketUrl: broadcastShow.irlTicketUrl,
          });
        }
      }

      // Auto-favorite watchlist matches
      if (matches.length > 0) {
        matches.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        const uniqueMatches = matches.filter(
          (match, index, self) =>
            index === self.findIndex(
              (m) => m.showName.toLowerCase() === match.showName.toLowerCase() && m.stationId === match.stationId
            )
        );

        for (const match of uniqueMatches) {
          const existingFavorites = await getUserFavorites(user.id, "show");
          const alreadyFavorited = existingFavorites.some(
            (f) =>
              (f.data.term as string)?.toLowerCase() === match.showName.toLowerCase() &&
              (f.data.stationId as string) === match.stationId
          );

          if (!alreadyFavorited) {
            await addUserFavorite(user.id, {
              term: match.showName.toLowerCase(),
              type: "show",
              showName: match.showName,
              djName: match.djName || null,
              stationId: match.stationId,
              createdAt: new Date(),
              createdBy: "system",
              matchedFromWatchlist: match.searchTerm,
            });
            showsAddedToFavorites++;
            console.log(`[watchlist-digest] Added "${match.showName}" to favorites for user ${user.id}`);
          }
        }
      }

      // ── Build digest email ──────────────────────────────────────────
      const irlCity = userData.irlCity as string | undefined;
      const preferredGenres = (userData.preferredGenres as string[]) || [];

      if ((!user.wantsEmail && !testEmail) || alreadySentEmailToday) {
        usersProcessed++;
        continue;
      }

      // Build Section 1: favorite shows (from all favorite types)
      const showFavorites = await getUserFavorites(user.id, "show");
      const irlFavorites = await getUserFavorites(user.id, "irl");

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
      const favoriteShowNames = new Set<string>();

      // Match show favorites against allShows to find upcoming instances
      for (const fav of showFavorites) {
        const favTerm = (fav.data.term as string)?.toLowerCase();
        const favStation = fav.data.stationId as string | undefined;
        if (!favTerm) continue;

        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowNames.has(showKey)) continue;

          if (show.name.toLowerCase() === favTerm && (!favStation || show.stationId === favStation)) {
            const broadcastShow = show as BroadcastShow;
            let djUsername = broadcastShow.djUsername;
            let djPhotoUrl = broadcastShow.djPhotoUrl;
            // Use metadata `p` field as primary lookup key (same as watchlist section)
            if (broadcastShow.profileUsername) {
              const lookupKey = normalizeForLookup(broadcastShow.profileUsername);
              const djProfile = djNameToProfile.get(lookupKey);
              if (djProfile) {
                djUsername = djProfile.username;
                djPhotoUrl = djProfile.photoUrl;
              } else {
                djUsername = djUsername || broadcastShow.profileUsername;
              }
            }
            // Fallback: fuzzy match on DJ name
            if (!djUsername && show.dj) {
              const djProfile = djNameToProfile.get(normalizeForLookup(show.dj));
              if (djProfile) { djUsername = djProfile.username; djPhotoUrl = djProfile.photoUrl; }
            }
            favoriteShows.push({
              showName: show.name,
              djName: show.dj,
              djUsername,
              djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              isIRL: broadcastShow.isIRL,
              irlLocation: broadcastShow.irlLocation,
              irlTicketUrl: broadcastShow.irlTicketUrl,
            });
            favoriteShowNames.add(showKey);
            break;
          }
        }
      }

      // Match watchlist (search) favorites
      for (const watchlistDoc of watchlistDocs) {
        const term = watchlistDoc.term.toLowerCase();
        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowNames.has(showKey)) continue;

          if (containsMatch(show.name, term) || (show.dj && containsMatch(show.dj, term))) {
            const broadcastShow = show as BroadcastShow;
            let djUsername = broadcastShow.djUsername;
            let djPhotoUrl = broadcastShow.djPhotoUrl;
            // Use metadata `p` field as primary lookup key
            if (broadcastShow.profileUsername) {
              const lookupKey = normalizeForLookup(broadcastShow.profileUsername);
              const djProfile = djNameToProfile.get(lookupKey);
              if (djProfile) {
                djUsername = djProfile.username;
                djPhotoUrl = djProfile.photoUrl;
              } else {
                djUsername = djUsername || broadcastShow.profileUsername;
              }
            }
            if (!djUsername && show.dj) {
              const djProfile = djNameToProfile.get(normalizeForLookup(show.dj));
              if (djProfile) { djUsername = djProfile.username; djPhotoUrl = djProfile.photoUrl; }
            }
            favoriteShows.push({
              showName: show.name,
              djName: show.dj,
              djUsername,
              djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              isIRL: broadcastShow.isIRL,
              irlLocation: broadcastShow.irlLocation,
              irlTicketUrl: broadcastShow.irlTicketUrl,
            });
            favoriteShowNames.add(showKey);
          }
        }
      }

      // Match IRL favorites against allShows
      for (const fav of irlFavorites) {
        const favDjName = (fav.data.djName as string) || (fav.data.term as string);
        if (!favDjName) continue;

        for (const show of allShows) {
          const broadcastShow = show as BroadcastShow;
          if (!broadcastShow.isIRL) continue;
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const showKey = `${show.name.toLowerCase()}-irl`;
          if (favoriteShowNames.has(showKey)) continue;

          if (show.dj && containsMatch(show.dj, favDjName.toLowerCase())) {
            favoriteShows.push({
              showName: show.name,
              djName: show.dj,
              djUsername: broadcastShow.djUsername,
              djPhotoUrl: broadcastShow.djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              isIRL: true,
              irlLocation: broadcastShow.irlLocation,
              irlTicketUrl: broadcastShow.irlTicketUrl,
            });
            favoriteShowNames.add(showKey);
            break;
          }
        }
      }

      favoriteShows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      // Build Section 2: curator recs from followed DJs (exclude already-sent ones)
      const followedDJNames = watchlistDocs.map((w) => w.term.toLowerCase());
      const userCuratorRecs = allCuratorRecs.filter((rec) =>
        (followedDJNames.includes(rec.djUsername.toLowerCase()) ||
        followedDJNames.includes(rec.djName.toLowerCase())) &&
        !sentRecUrls.has(rec.url)
      ).slice(0, 4);

      // Build Section 3: picked-for-you shows
      // Priority: 1) genre match (if user has genres), 2) random online shows with profile+photo
      // No IRL events unless user has location set
      const preferenceMatches: Array<{
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

      const prefKeys = new Set<string>();

      // Step 1: Genre-matched shows (if user has preferred genres)
      if (preferredGenres.length > 0) {
        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowNames.has(showKey)) continue;
          if (prefKeys.has(showKey)) continue;
          if (preferenceMatches.length >= 6) break;

          const broadcastShow = show as BroadcastShow;

          // Skip IRL events if user has no location set
          if (broadcastShow.isIRL && !irlCity) continue;

          let djGenres: string[] | undefined;
          let djLocation: string | undefined;
          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;

          if (show.dj) {
            const profile = djNameToProfile.get(normalizeForLookup(show.dj));
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

          // Also check city match if available (for matchLabel)
          const showLocation = broadcastShow.isIRL ? broadcastShow.irlLocation : djLocation;
          const cityMatch = irlCity && showLocation ? matchesCity(showLocation, irlCity) : false;

          if (genreMatch) {
            const matchParts: string[] = [];
            if (cityMatch && irlCity) matchParts.push(irlCity.toUpperCase());
            const matchingGenres = preferredGenres.filter((g) => djGenres && matchesGenre(djGenres, g));
            matchParts.push(matchingGenres.map((g) => g.toUpperCase()).join(" + "));

            preferenceMatches.push({
              showName: show.name,
              djName: show.dj,
              djUsername,
              djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              isIRL: broadcastShow.isIRL,
              irlLocation: broadcastShow.irlLocation,
              irlTicketUrl: broadcastShow.irlTicketUrl,
              matchLabel: matchParts.join(" + "),
            });
            prefKeys.add(showKey);
          }
        }
      }

      // Step 2: If still not enough, add city-matched shows (if user has city but we need more)
      if (preferenceMatches.length < 4 && irlCity) {
        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowNames.has(showKey)) continue;
          if (prefKeys.has(showKey)) continue;
          if (preferenceMatches.length >= 6) break;

          const broadcastShow = show as BroadcastShow;

          let djLocation: string | undefined;
          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;

          if (show.dj) {
            const profile = djNameToProfile.get(normalizeForLookup(show.dj));
            if (profile) {
              djLocation = profile.location;
              if (!djUsername) djUsername = profile.username;
              if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
            }
          }

          if (!djUsername || !djPhotoUrl) continue;

          const showLocation = broadcastShow.isIRL ? broadcastShow.irlLocation : djLocation;
          const cityMatch = showLocation ? matchesCity(showLocation, irlCity) : false;

          if (cityMatch) {
            preferenceMatches.push({
              showName: show.name,
              djName: show.dj,
              djUsername,
              djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              isIRL: broadcastShow.isIRL,
              irlLocation: broadcastShow.irlLocation,
              irlTicketUrl: broadcastShow.irlTicketUrl,
              matchLabel: irlCity.toUpperCase(),
            });
            prefKeys.add(showKey);
          }
        }
      }

      // Step 3: If still not enough, add any online shows with profile+photo (no IRL)
      if (preferenceMatches.length < 4) {
        for (const show of allShows) {
          if (preferenceMatches.length >= 6) break;
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          if (!show.dj) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowNames.has(showKey)) continue;
          if (prefKeys.has(showKey)) continue;

          const broadcastShow = show as BroadcastShow;
          if (broadcastShow.isIRL) continue; // No IRL in random fallback

          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;
          if (!djUsername && show.dj) {
            const profile = djNameToProfile.get(normalizeForLookup(show.dj));
            if (profile) { djUsername = profile.username; djPhotoUrl = profile.photoUrl; }
          }

          if (!djUsername || !djPhotoUrl) continue;

          preferenceMatches.push({
            showName: show.name,
            djName: show.dj,
            djUsername,
            djPhotoUrl,
            stationName: show.stationName,
            stationId: show.stationId,
            startTime: showStart,
          });
          prefKeys.add(showKey);
        }
      }

      // Always send if there's content (favorites, recs, or preference matches)
      // When user has no favorites and no preferences, we already filled preferenceMatches
      // with fallback online shows (Step 3 above) so they still get a useful digest
      const hasContent = favoriteShows.length > 0 || userCuratorRecs.length > 0 || preferenceMatches.length > 0;

      if (hasContent) {
        const success = await sendWatchlistDigestEmail({
          to: userData.email as string,
          userTimezone: userData.timezone as string | undefined,
          favoriteShows,
          curatorRecs: userCuratorRecs,
          preferenceShows: preferenceMatches,
          preferredGenres,
        });

        if (success) {
          const updatedDigestShows = { ...lastWatchlistDigestShows };
          for (const match of matches.filter((m) => m.isNewForEmail)) {
            updatedDigestShows[match.showId] = now.toISOString();
          }

          for (const showId of Object.keys(updatedDigestShows)) {
            const parts = showId.split("-");
            const dateStr = parts.slice(-3).join("-");
            const showDate = new Date(dateStr);
            if (showDate < today) {
              delete updatedDigestShows[showId];
            }
          }

          // Track sent curator rec URLs so they're not repeated
          const updatedSentRecs = [...lastSentCuratorRecs, ...userCuratorRecs.map((r) => r.url)];

          await updateUser(user.id, {
            lastWatchlistEmailAt: new Date(),
            lastWatchlistDigestShows: updatedDigestShows,
            lastSentCuratorRecs: updatedSentRecs,
          });
          emailsSent++;
        }
      }

      usersProcessed++;
    }

    console.log(`[watchlist-digest] Done: ${usersProcessed} users, ${emailsSent} emails, ${showsAddedToFavorites} shows added to favorites`);

    return NextResponse.json({
      usersProcessed,
      emailsSent,
      showsAddedToFavorites,
    });
  } catch (error) {
    console.error("Error in watchlist-digest cron:", error);
    return NextResponse.json(
      { error: "Failed to process watchlist digest" },
      { status: 500 }
    );
  }
}
