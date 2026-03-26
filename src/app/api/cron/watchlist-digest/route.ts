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
import { matchesCity, getCityFromTimezone } from "@/lib/city-detection";

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
  t?: string | null; // type (weekly, monthly, restream, playlist)
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
  broadcast: "Channel Radio",
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

// Blocked profile matches: prevents enriching external shows with wrong DJ profiles
function isProfileMatchBlocked(blocked: Set<string>, djUsername: string, stationId: string): boolean {
  const normalizedUsername = djUsername.toLowerCase();
  const normalizedStation = stationId.toLowerCase();
  return blocked.has(`${normalizedUsername}:${normalizedStation}`) ||
         blocked.has(`${normalizedUsername}:*`);
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

  // PAUSED: disable automated sends, but allow test emails through
  const testEmail = request.nextUrl.searchParams.get("testEmail");
  if (!testEmail) {
    return NextResponse.json({ paused: true, message: "Watchlist digest is temporarily paused" });
  }

  // Test mode: ?testEmail=user@example.com bypasses schedule/dedup and only sends to that email
  // Optional: ?sendTo=other@example.com redirects the email to a different address (for previewing another user's digest)
  const sendToOverride = request.nextUrl.searchParams.get("sendTo");

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

    // Fetch blocked profile matches (to prevent wrong DJ profile enrichment)
    const blockedProfileMatches = new Set<string>();
    try {
      const blockedDocs = await queryCollection("blocked-profile-matches", [], 500);
      for (const doc of blockedDocs) {
        const username = doc.data.djUsername as string;
        const stationId = doc.data.stationId as string;
        if (username && stationId) {
          blockedProfileMatches.add(`${username.toLowerCase()}:${stationId.toLowerCase()}`);
        }
      }
      if (blockedProfileMatches.size > 0) {
        console.log(`[watchlist-digest] Loaded ${blockedProfileMatches.size} blocked profile matches`);
      }
    } catch {
      console.log("[watchlist-digest] Could not fetch blocked profile matches, continuing without");
    }

    // Get all shows from all stations (external metadata)
    const allShows: BroadcastShow[] = [];
    for (const [stationKey, shows] of Object.entries(metadata.stations)) {
      if (Array.isArray(shows)) {
        for (const show of shows) {
          // Skip playlist and restream shows — don't auto-favorite automated content
          if (show.t === "playlist" || show.t === "restream") continue;
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

    // Also fetch Channel Radio shows from Firebase
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
        stationName: "Channel Radio",
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
            dj: chatUsername || displayName,
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
            dj: chatUsername || displayName,
            startTime,
            stationId: "dj-radio",
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
    const djNameToProfile = new Map<string, { username: string; photoUrl?: string; genres?: string[]; location?: string; isChannelUser: boolean }>();
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
        const profileInfo = { username: displayName, photoUrl, genres, location, isChannelUser: false };
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

    // 2. Add from approved DJ users (overwrite pending profiles — claimed users take priority)
    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const chatUsernameNormalized = djUser.data.chatUsernameNormalized as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        const genres = (djProfile?.genres as string[]) || undefined;
        const location = (djProfile?.location as string) || undefined;
        const profileInfo = { username: displayName, photoUrl, genres, location, isChannelUser: true };
        djNameToProfile.set(chatUsernameNormalized, profileInfo);
        // Also index by our normalized version of chatUsername
        const normalizedChatUsername = normalizeForLookup(displayName);
        if (normalizedChatUsername !== chatUsernameNormalized) {
          djNameToProfile.set(normalizedChatUsername, profileInfo);
        }
        // Also index by normalized version without hyphens
        const withoutHyphens = chatUsernameNormalized.replace(/-/g, "");
        if (withoutHyphens !== chatUsernameNormalized && withoutHyphens !== normalizedChatUsername) {
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
      const recDjName = (djProfile.djName as string) || chatUsername;

      if (Array.isArray(rawRecs)) {
        for (const item of rawRecs as Array<{ type?: string; title?: string; url?: string; imageUrl?: string }>) {
          if (item?.url || item?.title) {
            allCuratorRecs.push({ djUsername, djName: recDjName, djPhotoUrl, url: item.url || "", type: (item.type as "music" | "irl" | "online") || "music", title: item.title, imageUrl: item.imageUrl });
          }
        }
      } else {
        const myRecs = rawRecs as { bandcampLinks?: string[]; eventLinks?: string[] };
        for (const url of myRecs.bandcampLinks || []) {
          if (url) allCuratorRecs.push({ djUsername, djName: recDjName, djPhotoUrl, url, type: "music" });
        }
        for (const url of myRecs.eventLinks || []) {
          if (url) allCuratorRecs.push({ djUsername, djName: recDjName, djPhotoUrl, url, type: "irl" });
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
    let skippedNoWantsEmail = 0;
    let skippedAlreadySent = 0;
    let skippedNoContent = 0;
    let emailFailed = 0;

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
      const dismissedAutoFavorites = (userData.dismissedAutoFavorites as Record<string, string>) || {};

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

          // Use metadata `p` field as primary lookup key (skip if blocked)
          const isBlocked = broadcastShow.profileUsername
            ? isProfileMatchBlocked(blockedProfileMatches, broadcastShow.profileUsername, show.stationId)
            : false;

          if (broadcastShow.profileUsername && !isBlocked) {
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

          // Fallback: fuzzy match on search term or DJ name (skip if blocked)
          if (!djUsername && !isBlocked) {
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

          // Skip if user previously dismissed this auto-favorite
          const dismissKey = `${match.stationId}-${match.showName.toLowerCase()}`;
          const wasDismissed = !!dismissedAutoFavorites[dismissKey];

          if (!alreadyFavorited && !wasDismissed) {
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
      const userTimezone = userData.timezone as string | undefined;
      const irlCity = (userData.irlCity as string | undefined)
        || (userTimezone ? getCityFromTimezone(userTimezone) : undefined);
      const preferredGenres = (userData.preferredGenres as string[]) || [];

      if (!user.wantsEmail && !testEmail) {
        skippedNoWantsEmail++;
        usersProcessed++;
        continue;
      }
      if (alreadySentEmailToday) {
        skippedAlreadySent++;
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
          // Include start date in key so the same show on different days both appear
          const dateStr = showStart.toISOString().split("T")[0];
          const showKey = `${show.name.toLowerCase()}-${show.stationId}-${dateStr}`;
          if (favoriteShowNames.has(showKey)) continue;

          if (show.name.toLowerCase() === favTerm && (!favStation || show.stationId === favStation)) {
            const broadcastShow = show as BroadcastShow;
            let djUsername = broadcastShow.djUsername;
            let djPhotoUrl = broadcastShow.djPhotoUrl;
            // Use metadata `p` field as primary lookup key (same as watchlist section, skip if blocked)
            const isFavBlocked = broadcastShow.profileUsername
              ? isProfileMatchBlocked(blockedProfileMatches, broadcastShow.profileUsername, show.stationId)
              : false;
            if (broadcastShow.profileUsername && !isFavBlocked) {
              const lookupKey = normalizeForLookup(broadcastShow.profileUsername);
              const djProfile = djNameToProfile.get(lookupKey);
              if (djProfile) {
                djUsername = djProfile.username;
                djPhotoUrl = djProfile.photoUrl;
              } else {
                djUsername = djUsername || broadcastShow.profileUsername;
              }
            }
            // Fallback: fuzzy match on DJ name (skip if blocked)
            if (!djUsername && !isFavBlocked && show.dj) {
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

      // Match watchlist (search) favorites
      for (const watchlistDoc of watchlistDocs) {
        const term = watchlistDoc.term.toLowerCase();
        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now) continue;
          const dateStr = showStart.toISOString().split("T")[0];
          const showKey = `${show.name.toLowerCase()}-${show.stationId}-${dateStr}`;
          if (favoriteShowNames.has(showKey)) continue;

          if (containsMatch(show.name, term) || (show.dj && containsMatch(show.dj, term))) {
            const broadcastShow = show as BroadcastShow;
            let djUsername = broadcastShow.djUsername;
            let djPhotoUrl = broadcastShow.djPhotoUrl;
            // Use metadata `p` field as primary lookup key (skip if blocked)
            const isTermBlocked = broadcastShow.profileUsername
              ? isProfileMatchBlocked(blockedProfileMatches, broadcastShow.profileUsername, show.stationId)
              : false;
            if (broadcastShow.profileUsername && !isTermBlocked) {
              const lookupKey = normalizeForLookup(broadcastShow.profileUsername);
              const djProfile = djNameToProfile.get(lookupKey);
              if (djProfile) {
                djUsername = djProfile.username;
                djPhotoUrl = djProfile.photoUrl;
              } else {
                djUsername = djUsername || broadcastShow.profileUsername;
              }
            }
            if (!djUsername && !isTermBlocked && show.dj) {
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
          const dateStr = showStart.toISOString().split("T")[0];
          const showKey = `${show.name.toLowerCase()}-irl-${dateStr}`;
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
          }
        }
      }

      favoriteShows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      // Build a dateless version of favoriteShowNames for preference dedup
      // (favorites use "name-station-date" keys, but preferences use "name-station" keys)
      const favoriteShowKeys = new Set(
        Array.from(favoriteShowNames).map((k) => k.replace(/-\d{4}-\d{2}-\d{2}$/, ""))
      );

      // Build Section 2: curator recs from followed DJs (exclude already-sent ones)
      const followedDJNames = watchlistDocs.map((w) => w.term.toLowerCase());
      const userCuratorRecs = allCuratorRecs.filter((rec) =>
        (followedDJNames.includes(rec.djUsername.toLowerCase()) ||
        followedDJNames.includes(rec.djName.toLowerCase())) &&
        !sentRecUrls.has(rec.url)
      ).slice(0, 4);

      // Build Section 3: picked-for-you shows (day-aware)
      // Ensures at least one show per day in the 4-day window before filling extras
      // Priority per day: 1) genre match, 2) city match, 3) random online with profile+photo
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

      // Build 4-day window keys in user's timezone
      const userTz = userTimezone || "America/New_York";
      const getDateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: userTz });

      const dayKeys: string[] = [];
      for (let i = 0; i < 4; i++) {
        const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        dayKeys.push(getDateKey(d));
      }

      // Find which days already have favorites
      const daysWithFavorites = new Set(
        favoriteShows.map((s) => getDateKey(s.startTime))
      );

      // Only pick preference shows within the 4-day window
      const windowEnd = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

      // Helper: enrich a show with DJ profile info and return a preference match (or null)
      type PrefMatch = typeof preferenceMatches[number];
      const enrichShow = (show: BroadcastShow): { djUsername?: string; djPhotoUrl?: string; djGenres?: string[]; djLocation?: string; isChannelUser: boolean } | null => {
        let djGenres: string[] | undefined;
        let djLocation: string | undefined;
        let djUsername = show.djUsername;
        let djPhotoUrl = show.djPhotoUrl;
        let isChannelUser = false;

        // Priority 1: Use metadata `p` field (profileUsername) for lookup
        if (show.profileUsername) {
          const profile = djNameToProfile.get(normalizeForLookup(show.profileUsername));
          if (profile) {
            djGenres = profile.genres;
            djLocation = profile.location;
            isChannelUser = profile.isChannelUser;
            if (!djUsername) djUsername = profile.username;
            if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
          } else {
            // Even without a Firebase profile, use `p` as the username for links
            if (!djUsername) djUsername = show.profileUsername;
          }
        }

        // Priority 2: Fallback to DJ name lookup
        if (show.dj) {
          const profile = djNameToProfile.get(normalizeForLookup(show.dj));
          if (profile) {
            if (!djGenres) djGenres = profile.genres;
            if (!djLocation) djLocation = profile.location;
            if (!isChannelUser) isChannelUser = profile.isChannelUser;
            if (!djUsername) djUsername = profile.username;
            if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
          }
        }

        if (!djUsername || !djPhotoUrl) return null;
        return { djUsername, djPhotoUrl, djGenres, djLocation, isChannelUser };
      };

      // Helper: try to find a preference show for a specific day
      // Within each priority tier, Channel users are preferred
      const findShowForDay = (dayKey: string): PrefMatch | null => {
        const dayShows = allShows.filter((s) => {
          const start = new Date(s.startTime);
          return start >= now && start <= windowEnd && getDateKey(start) === dayKey;
        });

        // Priority 1: Genre match (Channel users first)
        if (preferredGenres.length > 0) {
          const genreCandidates: { match: PrefMatch; showKey: string; isChannelUser: boolean }[] = [];
          for (const show of dayShows) {
            const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
            if (favoriteShowKeys.has(showKey) || prefKeys.has(showKey)) continue;
            const broadcastShow = show as BroadcastShow;
            if (broadcastShow.isIRL && !irlCity) continue;

            const enriched = enrichShow(broadcastShow);
            if (!enriched) continue;

            const genreMatch = enriched.djGenres
              ? preferredGenres.some((g) => matchesGenre(enriched.djGenres!, g))
              : false;

            if (genreMatch) {
              const showLocation = broadcastShow.isIRL ? broadcastShow.irlLocation : enriched.djLocation;
              const cityMatch = irlCity && showLocation ? matchesCity(showLocation, irlCity) : false;
              const matchParts: string[] = [];
              if (cityMatch && irlCity) matchParts.push(irlCity.toUpperCase());
              const matchingGenres = preferredGenres.filter((g) => enriched.djGenres && matchesGenre(enriched.djGenres, g));
              matchParts.push(matchingGenres.map((g) => g.toUpperCase()).join(" + "));

              genreCandidates.push({
                match: {
                  showName: show.name,
                  djName: show.dj,
                  djUsername: enriched.djUsername,
                  djPhotoUrl: enriched.djPhotoUrl,
                  stationName: show.stationName,
                  stationId: show.stationId,
                  startTime: new Date(show.startTime),
                  isIRL: broadcastShow.isIRL,
                  irlLocation: broadcastShow.irlLocation,
                  irlTicketUrl: broadcastShow.irlTicketUrl,
                  matchLabel: matchParts.join(" + "),
                },
                showKey,
                isChannelUser: enriched.isChannelUser,
              });
            }
          }
          if (genreCandidates.length > 0) {
            genreCandidates.sort((a, b) => (a.isChannelUser === b.isChannelUser ? 0 : a.isChannelUser ? -1 : 1));
            const best = genreCandidates[0];
            prefKeys.add(best.showKey);
            return best.match;
          }
        }

        // Priority 2: City match (Channel users first)
        if (irlCity) {
          const cityCandidates: { match: PrefMatch; showKey: string; isChannelUser: boolean }[] = [];
          for (const show of dayShows) {
            const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
            if (favoriteShowKeys.has(showKey) || prefKeys.has(showKey)) continue;
            const broadcastShow = show as BroadcastShow;

            const enriched = enrichShow(broadcastShow);
            if (!enriched) continue;

            const showLocation = broadcastShow.isIRL ? broadcastShow.irlLocation : enriched.djLocation;
            const cityMatch = showLocation ? matchesCity(showLocation, irlCity) : false;

            if (cityMatch) {
              cityCandidates.push({
                match: {
                  showName: show.name,
                  djName: show.dj,
                  djUsername: enriched.djUsername,
                  djPhotoUrl: enriched.djPhotoUrl,
                  stationName: show.stationName,
                  stationId: show.stationId,
                  startTime: new Date(show.startTime),
                  isIRL: broadcastShow.isIRL,
                  irlLocation: broadcastShow.irlLocation,
                  irlTicketUrl: broadcastShow.irlTicketUrl,
                  matchLabel: irlCity.toUpperCase(),
                },
                showKey,
                isChannelUser: enriched.isChannelUser,
              });
            }
          }
          if (cityCandidates.length > 0) {
            cityCandidates.sort((a, b) => (a.isChannelUser === b.isChannelUser ? 0 : a.isChannelUser ? -1 : 1));
            const best = cityCandidates[0];
            prefKeys.add(best.showKey);
            return best.match;
          }
        }

        // Priority 3: Any online show with profile+photo (Channel users first)
        const onlineCandidates: { match: PrefMatch; showKey: string; isChannelUser: boolean }[] = [];
        for (const show of dayShows) {
          if (!show.dj) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowKeys.has(showKey) || prefKeys.has(showKey)) continue;
          const broadcastShow = show as BroadcastShow;
          if (broadcastShow.isIRL) continue;

          const enriched = enrichShow(broadcastShow);
          if (!enriched) continue;

          onlineCandidates.push({
            match: {
              showName: show.name,
              djName: show.dj,
              djUsername: enriched.djUsername,
              djPhotoUrl: enriched.djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: new Date(show.startTime),
            },
            showKey,
            isChannelUser: enriched.isChannelUser,
          });
        }
        if (onlineCandidates.length > 0) {
          onlineCandidates.sort((a, b) => (a.isChannelUser === b.isChannelUser ? 0 : a.isChannelUser ? -1 : 1));
          const best = onlineCandidates[0];
          prefKeys.add(best.showKey);
          return best.match;
        }

        // Priority 4: Any online show even without profile photo (Channel users first, then any DJ)
        const fallbackCandidates: { match: PrefMatch; showKey: string; hasProfile: boolean; isChannelUser: boolean }[] = [];
        for (const show of dayShows) {
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowKeys.has(showKey) || prefKeys.has(showKey)) continue;
          const broadcastShow = show as BroadcastShow;
          if (broadcastShow.isIRL) continue;

          // Try to get whatever profile info we can, but don't require photo
          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;
          let isChannelUser = false;

          if (broadcastShow.profileUsername) {
            const profile = djNameToProfile.get(normalizeForLookup(broadcastShow.profileUsername));
            if (profile) {
              isChannelUser = profile.isChannelUser;
              if (!djUsername) djUsername = profile.username;
              if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
            } else {
              if (!djUsername) djUsername = broadcastShow.profileUsername;
            }
          }
          if (show.dj) {
            const profile = djNameToProfile.get(normalizeForLookup(show.dj));
            if (profile) {
              if (!isChannelUser) isChannelUser = profile.isChannelUser;
              if (!djUsername) djUsername = profile.username;
              if (!djPhotoUrl) djPhotoUrl = profile.photoUrl;
            }
            if (!djUsername) djUsername = show.dj;
          }

          if (!djUsername) continue;

          fallbackCandidates.push({
            match: {
              showName: show.name,
              djName: show.dj,
              djUsername,
              djPhotoUrl,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: new Date(show.startTime),
            },
            showKey,
            hasProfile: !!djPhotoUrl,
            isChannelUser,
          });
        }
        if (fallbackCandidates.length > 0) {
          // Prefer: has photo > Channel user > any
          fallbackCandidates.sort((a, b) => {
            if (a.hasProfile !== b.hasProfile) return a.hasProfile ? -1 : 1;
            if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
            return 0;
          });
          const best = fallbackCandidates[0];
          prefKeys.add(best.showKey);
          return best.match;
        }

        return null;
      };

      // Pass 1: Fill each empty day with one show
      for (const dayKey of dayKeys) {
        if (daysWithFavorites.has(dayKey)) continue;
        if (preferenceMatches.length >= 6) break;

        const match = findShowForDay(dayKey);
        if (match) preferenceMatches.push(match);
      }

      // Pass 2: Fill remaining slots (up to 6 total) from any day
      // Collect all candidates, sort by relevance then Channel user status, then take what we need
      if (preferenceMatches.length < 6) {
        const bonusCandidates: { match: PrefMatch; showKey: string; hasRelevanceMatch: boolean; hasPhoto: boolean; isChannelUser: boolean }[] = [];
        for (const show of allShows) {
          const showStart = new Date(show.startTime);
          if (showStart < now || showStart > windowEnd) continue;
          const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
          if (favoriteShowKeys.has(showKey)) continue;
          if (prefKeys.has(showKey)) continue;

          const broadcastShow = show as BroadcastShow;
          if (broadcastShow.isIRL && !irlCity) continue;

          // Try enrichShow first, then fallback to basic info
          const enriched = enrichShow(broadcastShow);
          let djUsername = enriched?.djUsername;
          let djPhotoUrl = enriched?.djPhotoUrl;
          let djGenres = enriched?.djGenres;
          let djLocation = enriched?.djLocation;
          let isChannelUser = enriched?.isChannelUser || false;

          if (!enriched) {
            // Fallback: get whatever info we can without requiring photo
            if (broadcastShow.profileUsername) {
              const profile = djNameToProfile.get(normalizeForLookup(broadcastShow.profileUsername));
              if (profile) {
                djUsername = profile.username;
                djPhotoUrl = profile.photoUrl;
                djGenres = profile.genres;
                djLocation = profile.location;
                isChannelUser = profile.isChannelUser;
              } else {
                djUsername = broadcastShow.profileUsername;
              }
            }
            if (show.dj && !djUsername) {
              const profile = djNameToProfile.get(normalizeForLookup(show.dj));
              if (profile) {
                djUsername = profile.username;
                djPhotoUrl = profile.photoUrl;
                djGenres = profile.genres;
                djLocation = profile.location;
                isChannelUser = profile.isChannelUser;
              } else {
                djUsername = show.dj;
              }
            }
            if (!djUsername) continue;
          }

          // Prefer genre or city matches in the bonus pass too
          const genreMatch = djGenres && preferredGenres.length > 0
            ? preferredGenres.some((g) => matchesGenre(djGenres!, g))
            : false;
          const showLocation = broadcastShow.isIRL ? broadcastShow.irlLocation : djLocation;
          const cityMatch = irlCity && showLocation ? matchesCity(showLocation, irlCity) : false;

          if (genreMatch || cityMatch || !broadcastShow.isIRL) {
            const matchParts: string[] = [];
            if (cityMatch && irlCity) matchParts.push(irlCity.toUpperCase());
            if (genreMatch && djGenres) {
              const matchingGenres = preferredGenres.filter((g) => matchesGenre(djGenres!, g));
              matchParts.push(matchingGenres.map((g) => g.toUpperCase()).join(" + "));
            }

            bonusCandidates.push({
              match: {
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
                matchLabel: matchParts.length > 0 ? matchParts.join(" + ") : undefined,
              },
              showKey,
              hasRelevanceMatch: genreMatch || cityMatch,
              hasPhoto: !!djPhotoUrl,
              isChannelUser,
            });
          }
        }
        // Sort: relevance match first, then has photo, then Channel users first
        bonusCandidates.sort((a, b) => {
          if (a.hasRelevanceMatch !== b.hasRelevanceMatch) return a.hasRelevanceMatch ? -1 : 1;
          if (a.hasPhoto !== b.hasPhoto) return a.hasPhoto ? -1 : 1;
          if (a.isChannelUser !== b.isChannelUser) return a.isChannelUser ? -1 : 1;
          return 0;
        });
        for (const candidate of bonusCandidates) {
          if (preferenceMatches.length >= 6) break;
          preferenceMatches.push(candidate.match);
          prefKeys.add(candidate.showKey);
        }
      }

      // Always send if there's content (favorites, recs, or preference matches)
      const hasContent = favoriteShows.length > 0 || userCuratorRecs.length > 0 || preferenceMatches.length > 0;

      if (!hasContent) {
        skippedNoContent++;
      }

      if (hasContent) {
        const success = await sendWatchlistDigestEmail({
          to: (testEmail && sendToOverride) ? sendToOverride : userData.email as string,
          userTimezone: userData.timezone as string | undefined,
          favoriteShows,
          curatorRecs: userCuratorRecs,
          preferenceShows: preferenceMatches,
          preferredGenres,
        });

        if (!success) {
          emailFailed++;
        }

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
      debug: { skippedNoWantsEmail, skippedAlreadySent, skippedNoContent, emailFailed },
    });
  } catch (error) {
    console.error("Error in watchlist-digest cron:", error);
    return NextResponse.json(
      { error: "Failed to process watchlist digest" },
      { status: 500 }
    );
  }
}
