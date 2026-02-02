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
  isIRL?: boolean;
  irlLocation?: string;
  irlTicketUrl?: string;
}

// Contains matching for DJ/show names (unidirectional - text must contain term)
// e.g. watchlist "skee mask" matches show "Skee Mask Live" but NOT show "Skee"
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower);
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      }> | undefined;

      if (radioShows && Array.isArray(radioShows)) {
        for (const radioShow of radioShows) {
          if (!radioShow.date || radioShow.date < todayStr) continue;

          const startTime = radioShow.time
            ? `${radioShow.date}T${radioShow.time}:00.000Z`
            : `${radioShow.date}T12:00:00.000Z`;

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
    const djNameToProfile = new Map<string, { username: string; photoUrl?: string }>();
    const normalizeForLookup = (str: string): string => {
      return str.replace(/[\s-]+/g, "").toLowerCase();
    };

    // 1. Add from pending-dj-profiles (these take priority)
    const pendingProfiles = await queryCollection("pending-dj-profiles", [], 500);
    for (const pending of pendingProfiles) {
      const chatUsername = pending.data.chatUsername as string | undefined;
      const chatUsernameNormalized = pending.data.chatUsernameNormalized as string | undefined;
      const djProfile = pending.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      if (chatUsername && chatUsernameNormalized) {
        djNameToProfile.set(chatUsernameNormalized, { username: chatUsername, photoUrl });
      }
    }
    console.log(`[watchlist-digest] Added ${pendingProfiles.length} pending DJ profiles to map`);

    // 2. Add from approved DJ users (don't overwrite pending profiles)
    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const chatUsernameNormalized = djUser.data.chatUsernameNormalized as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      if (chatUsername && chatUsernameNormalized && !djNameToProfile.has(chatUsernameNormalized)) {
        djNameToProfile.set(chatUsernameNormalized, { username: chatUsername, photoUrl });
      }
    }

    console.log(`[watchlist-digest] Built DJ profile map with ${djNameToProfile.size} total entries`);

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

      // Check if we already processed this user today (for email)
      const lastEmailAt = userData.lastWatchlistEmailAt as Date | string | undefined;
      const alreadySentEmailToday = lastEmailAt && new Date(lastEmailAt) >= today;

      // Get user's watchlist (search type favorites)
      const favorites = await getUserFavorites(user.id, "search");
      const watchlistDocs = favorites.map((doc) => ({
        id: doc.id,
        term: doc.data.term as string,
      }));

      if (watchlistDocs.length === 0) {
        continue;
      }

      // Find matching shows
      // For auto-favoriting, we check all future shows
      // For emails, we check since last email
      const since = lastEmailAt ? new Date(lastEmailAt) : new Date(0);
      const matches: Array<{
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
          // Look up DJ profile info if not already set
          // Try multiple sources: matched search term, show DJ name
          let djUsername = broadcastShow.djUsername;
          let djPhotoUrl = broadcastShow.djPhotoUrl;
          if (!djUsername) {
            // Try matched search term first (e.g. watchlist "dor wand")
            let djProfile = matchedTerm ? djNameToProfile.get(normalizeForLookup(matchedTerm)) : undefined;
            // Also try the show's DJ name if different
            if (!djProfile && show.dj) {
              djProfile = djNameToProfile.get(normalizeForLookup(show.dj));
            }
            if (djProfile) {
              djUsername = djProfile.username;
              djPhotoUrl = djProfile.photoUrl;
            }
          }

          matches.push({
            showName: show.name,
            djName: show.dj,
            djUsername,
            djPhotoUrl,
            stationName: show.stationName,
            stationId: show.stationId,
            startTime: showStart,
            searchTerm: matchedTerm,
            watchlistDocId: "",
            isNewForEmail: showStart >= since,
            isIRL: broadcastShow.isIRL,
            irlLocation: broadcastShow.irlLocation,
            irlTicketUrl: broadcastShow.irlTicketUrl,
          });
        }
      }

      if (matches.length > 0) {
        // Sort by start time
        matches.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        // Deduplicate shows by name + station (keep first occurrence)
        const uniqueMatches = matches.filter(
          (match, index, self) =>
            index === self.findIndex(
              (m) => m.showName.toLowerCase() === match.showName.toLowerCase() && m.stationId === match.stationId
            )
        );

        // Add matched shows to favorites (as type "show")
        for (const match of uniqueMatches) {
          // Check if show already favorited (same name + station)
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

        // Only send email if user wants notifications and hasn't received one today
        const newMatchesForEmail = uniqueMatches.filter((m) => m.isNewForEmail);
        if (user.wantsEmail && !alreadySentEmailToday && newMatchesForEmail.length > 0) {
          // Send digest email (max 10 matches)
          const success = await sendWatchlistDigestEmail({
            to: userData.email as string,
            matches: newMatchesForEmail.slice(0, 10),
          });

          if (success) {
            await updateUser(user.id, {
              lastWatchlistEmailAt: new Date(),
            });
            emailsSent++;
          }
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
