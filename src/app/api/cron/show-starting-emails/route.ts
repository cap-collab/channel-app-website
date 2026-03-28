import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  updateUser,
  queryCollection,
  isRestApiConfigured,
} from "@/lib/firebase-rest";
import { wordBoundaryMatch } from "@/lib/dj-matching";

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Metadata V2 compressed format
interface MetadataShow {
  n: string; // name
  s: string; // start time (ISO 8601)
  e: string; // end time (ISO 8601)
  j?: string | null; // dj/host
  p?: string | null; // profile username
  ap?: string[] | null; // additional profile usernames
  t?: string | null; // type (weekly, monthly, restream, playlist)
}

interface Metadata {
  v: number;
  updated: string;
  stations: {
    [stationKey: string]: MetadataShow[];
  };
}

interface LiveShow {
  name: string;
  dj?: string;
  profileUsername?: string;
  stationId: string;
  stationName: string;
  showId: string; // Unique ID for dedup: "stationId-startTime"
  additionalProfileUsernames?: string[];
  // Resolved DJ profile info
  djUsername?: string;
  djPhotoUrl?: string;
  djHasEmail?: boolean;
  djUserId?: string; // Firebase UID of the DJ — used to skip sending them their own "go live" email
  streamingUrl?: string;
}

const STATION_NAMES: Record<string, string> = {
  nts1: "NTS 1",
  nts2: "NTS 2",
  rinse: "Rinse FM",
  rinsefr: "Rinse FR",
  dublab: "dublab",
  subtle: "Subtle Radio",
  newtown: "Newtown Radio",
};

// Normalize for DJ profile lookup - strip ALL non-alphanumeric and lowercase
// This matches how pending-dj-profiles stores chatUsernameNormalized
function normalizeForLookup(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    // 1. Fetch current metadata
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

    // 2. Find shows starting within ±5 minutes of now (same window as Cloud Function)
    const now = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);
    const liveShows: LiveShow[] = [];

    // Fetch DJ users early — reused for DJ radio show extraction and profile lookup
    const djUsers = await queryUsersWhere("role", "EQUAL", "dj");

    for (const [stationKey, shows] of Object.entries(metadata.stations)) {
      if (!Array.isArray(shows)) continue;
      for (const show of shows) {
        // Skip playlist and restream shows - don't notify for automated/replayed content
        if (show.t === "playlist" || show.t === "restream") continue;

        const start = new Date(show.s);
        if (start >= windowStart && start <= windowEnd) {
          liveShows.push({
            name: show.n,
            dj: show.j || undefined,
            profileUsername: show.p || undefined,
            additionalProfileUsernames: show.ap || undefined,
            stationId: stationKey,
            stationName: STATION_NAMES[stationKey] || stationKey,
            showId: `${stationKey}-${show.s}`,
          });
        }
      }
    }

    // Also check Channel Radio shows that are live
    const broadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "status", op: "EQUAL", value: "live" }],
      100
    );

    for (const slot of broadcastSlots) {
      const data = slot.data;
      if (data.broadcastType === "restream") continue;
      liveShows.push({
        name: data.showName as string,
        dj: data.djName as string | undefined,
        profileUsername: undefined,
        stationId: "broadcast",
        stationName: "Channel Radio",
        showId: `broadcast-${slot.id}`,
        djUsername: data.djUsername as string | undefined,
        djUserId: (data.liveDjUserId as string) || (data.djUserId as string) || undefined,
      });
    }

    // Also check DJ radio shows (manually added via /studio) starting within the window
    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const radioShows = djProfile?.radioShows as Array<Record<string, string>> | undefined;

      if (!radioShows || !Array.isArray(radioShows)) continue;

      for (const show of radioShows) {
        // Only include online shows with a streaming URL
        if (!show.url) continue;
        if (!show.date) continue;

        // Convert local date/time/timezone to UTC (same logic as schedule route)
        const timezone = show.timezone || "America/Los_Angeles";
        const timeStr = show.time || "12:00";
        const [hours, minutes] = timeStr.split(":").map(Number);

        const localDateTime = `${show.date}T${String(hours || 0).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}:00`;
        const testDate = new Date(localDateTime + "Z");
        const localStr = testDate.toLocaleString("en-US", { timeZone: timezone, hour12: false });
        const localMatch = localStr.match(/(\d+):(\d+):(\d+)/);
        const localHour = localMatch ? parseInt(localMatch[1]) : hours || 0;

        let offsetHours = (hours || 0) - localHour;
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        const startTimeMs = testDate.getTime() + offsetHours * 60 * 60 * 1000;
        const startTime = new Date(startTimeMs);

        if (startTime >= windowStart && startTime <= windowEnd) {
          const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
          const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
          const normalizedUsername = chatUsername?.replace(/\s+/g, "").toLowerCase();
          const showId = `dj-radio-${normalizedUsername}-${show.date}-${radioNameSlug}-${showNameSlug}`;
          const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

          liveShows.push({
            name: showName,
            dj: chatUsername || undefined,
            stationId: "dj-radio",
            stationName: show.radioName || "Radio",
            showId,
            djUsername: normalizedUsername,
            djPhotoUrl: (djProfile?.photoUrl as string) || undefined,
            djHasEmail: !!(djUser.data.email),
            djUserId: djUser.id,
            streamingUrl: show.url,
          });
        }
      }
    }

    if (liveShows.length === 0) {
      return NextResponse.json({ liveShows: 0, emailsSent: 0 });
    }

    console.log(`[show-starting] Found ${liveShows.length} live shows`);

    // 3. Build DJ profile lookup map (same approach as watchlist-digest)
    // Maps normalized name to { chatUsername, photoUrl, hasEmail, userId }
    const djNameToProfile = new Map<string, { username: string; photoUrl?: string; hasEmail: boolean; userId?: string }>();

    // From pending-dj-profiles
    const pendingProfiles = await queryCollection("pending-dj-profiles", [], 10000);
    for (const pending of pendingProfiles) {
      const chatUsername = pending.data.chatUsername as string | undefined;
      const chatUsernameNormalized = pending.data.chatUsernameNormalized as string | undefined;
      const djProfile = pending.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;
      const email = pending.data.email as string | undefined;
      const userId = pending.data.userId as string | undefined;

      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        const profileData = { username: displayName, photoUrl, hasEmail: !!email, userId };
        djNameToProfile.set(chatUsernameNormalized, profileData);
        // Also index by normalized chatUsername and without hyphens
        const normalizedChatUsername = normalizeForLookup(displayName);
        if (normalizedChatUsername !== chatUsernameNormalized) {
          djNameToProfile.set(normalizedChatUsername, profileData);
        }
        const withoutHyphens = chatUsernameNormalized.replace(/-/g, "");
        if (withoutHyphens !== chatUsernameNormalized && withoutHyphens !== normalizedChatUsername) {
          djNameToProfile.set(withoutHyphens, profileData);
        }
      }
    }

    // From DJ users (already fetched above)
    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const chatUsernameNormalized = djUser.data.chatUsernameNormalized as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;
      const email = djUser.data.email as string | undefined;

      if (chatUsernameNormalized) {
        const displayName = chatUsername || chatUsernameNormalized;
        if (!djNameToProfile.has(chatUsernameNormalized)) {
          const profileData = { username: displayName, photoUrl, hasEmail: !!email, userId: djUser.id };
          djNameToProfile.set(chatUsernameNormalized, profileData);
        }
        const normalizedChatUsername = normalizeForLookup(displayName);
        if (normalizedChatUsername !== chatUsernameNormalized && !djNameToProfile.has(normalizedChatUsername)) {
          const profileData = { username: displayName, photoUrl, hasEmail: !!email, userId: djUser.id };
          djNameToProfile.set(normalizedChatUsername, profileData);
        }
        const withoutHyphens = chatUsernameNormalized.replace(/-/g, "");
        if (withoutHyphens !== chatUsernameNormalized && withoutHyphens !== normalizedChatUsername && !djNameToProfile.has(withoutHyphens)) {
          const profileData = { username: displayName, photoUrl, hasEmail: !!email, userId: djUser.id };
          djNameToProfile.set(withoutHyphens, profileData);
        }
      }
    }

    // Generic words that should never resolve to a DJ profile
    const ignoredProfileUsernames = new Set(["guests"]);

    // 4. Resolve DJ profiles for live shows using `p` field, falling back to `ap`
    for (const show of liveShows) {
      if (show.djUsername) continue; // Already resolved (broadcast)

      const effectiveProfileUsername = show.profileUsername && !ignoredProfileUsernames.has(show.profileUsername)
        ? show.profileUsername
        : undefined;

      // Try p field first, then ap entries, then dj name
      const candidates: string[] = [];
      if (effectiveProfileUsername) candidates.push(effectiveProfileUsername);
      if (show.additionalProfileUsernames) candidates.push(...show.additionalProfileUsernames);
      if (show.dj) candidates.push(show.dj);

      for (const candidate of candidates) {
        const profile = djNameToProfile.get(normalizeForLookup(candidate));
        if (profile) {
          show.djUsername = profile.username;
          show.djPhotoUrl = profile.photoUrl;
          show.djHasEmail = profile.hasEmail;
          show.djUserId = profile.userId;
          break;
        }
      }
      // If no profile matched but we had a p or ap value, use the first as username
      if (!show.djUsername && (effectiveProfileUsername || show.additionalProfileUsernames?.length)) {
        show.djUsername = effectiveProfileUsername || show.additionalProfileUsernames![0];
      }
    }

    // 5. Get all users with showStarting email notifications enabled
    const usersWithNotifications = await queryUsersWhere(
      "emailNotifications.showStarting",
      "EQUAL",
      true
    );

    console.log(`[show-starting] ${usersWithNotifications.length} users have showStarting enabled`);

    let emailsSent = 0;
    let skipped = 0;

    for (const userDoc of usersWithNotifications) {
      const userId = userDoc.id;
      const userData = await getUser(userId);
      if (!userData) continue;

      const userEmail = userData.email as string;
      if (!userEmail) continue;

      // Dedup: track which show occurrences we've already emailed about
      // Key: showId (e.g. "nts1-2026-02-05T22:00:00Z") → timestamp
      // Using showId (stationId + startTime) ensures:
      // - Same show next week gets a new notification (different startTime)
      // - 1-hour show doesn't trigger twice (same startTime, cron runs hourly)
      const lastShowStartingEmailAt = (userData.lastShowStartingEmailAt as Record<string, string>) || {};

      // Get user's favorites (both "show" type and "search" type)
      const [showFavorites, searchFavorites] = await Promise.all([
        getUserFavorites(userId, "show"),
        getUserFavorites(userId, "search"),
      ]);

      const searchTerms = searchFavorites.map((f) => (f.data.term as string) || "");

      for (const show of liveShows) {
        // Check if user has this show favorited
        let matched = false;

        // Check "show" type favorites (exact show name + station match)
        for (const fav of showFavorites) {
          const favTerm = ((fav.data.term as string) || "").toLowerCase();
          const favStation = (fav.data.stationId as string) || "";
          const favShowName = ((fav.data.showName as string) || "").toLowerCase();
          if (
            (favStation === show.stationId || !favStation) &&
            (favTerm === show.name.toLowerCase() || favShowName === show.name.toLowerCase())
          ) {
            matched = true;
            break;
          }
        }

        // Check "search" type favorites (watchlist - word boundary match)
        if (!matched) {
          for (const term of searchTerms) {
            if (
              wordBoundaryMatch(show.name, term) ||
              (show.dj && wordBoundaryMatch(show.dj, term))
            ) {
              matched = true;
              break;
            }
          }
        }

        if (!matched) continue;

        // Don't email the DJ about their own live show
        if (show.djUserId && show.djUserId === userId) continue;

        // Dedup: skip if we already emailed about this exact show occurrence
        if (lastShowStartingEmailAt[show.showId]) {
          skipped++;
          continue;
        }

        // Send email
        const success = await sendShowStartingEmail({
          to: userEmail,
          showName: show.name,
          djName: show.dj,
          djUsername: show.djUsername,
          djPhotoUrl: show.djPhotoUrl,
          djHasEmail: show.djHasEmail,
          stationName: show.stationName,
          stationId: show.stationId,
        });

        if (success) {
          // Mark this show occurrence as emailed
          lastShowStartingEmailAt[show.showId] = now.toISOString();
          await updateUser(userId, { lastShowStartingEmailAt });
          emailsSent++;
          console.log(`[show-starting] Sent email to ${userId} for "${show.name}" on ${show.stationName}`);
        }
      }
    }

    console.log(`[show-starting] Done: ${emailsSent} emails sent, ${skipped} skipped (rate limited)`);

    return NextResponse.json({
      liveShows: liveShows.length,
      usersChecked: usersWithNotifications.length,
      emailsSent,
      skipped,
    });
  } catch (error) {
    console.error("[show-starting] Error:", error);
    return NextResponse.json(
      { error: "Failed to process show starting emails" },
      { status: 500 }
    );
  }
}
