import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  updateUser,
  queryCollection,
  queryCollectionGroup,
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
  // For collective broadcasts: the chatUsernameNormalized of each owner. We
  // expand watchlist matching to cover any of these so a follower of one
  // owner gets notified when the collective is live, and we skip emailing
  // any of them about their own collective's broadcast.
  collectiveOwnerUsernames?: string[];
  collectiveOwnerUserIds?: string[];
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
      // Skip channelbroadcast shows (test broadcasts) — no notifications
      if (data.djUsername === "channelbroadcast") continue;

      // Collective fan-out: when the slot's djUsername matches a collective
      // slug, pull the owners so we can (a) widen watchlist matching to any
      // owner and (b) skip sending owners their own collective's email.
      let collectiveOwnerUsernames: string[] | undefined;
      let collectiveOwnerUserIds: string[] | undefined;
      const slug = (data.djUsername as string | undefined) || undefined;
      if (slug) {
        const collectives = await queryCollection(
          "collectives",
          [{ field: "slug", op: "EQUAL", value: slug }],
          1,
        );
        if (collectives.length > 0) {
          const ownerUids = (collectives[0].data.owners as string[] | undefined) || [];
          if (ownerUids.length > 0) {
            collectiveOwnerUserIds = ownerUids;
            const usernames: string[] = [];
            // queryCollection doesn't support __name__ in; fetch each owner.
            for (const uid of ownerUids) {
              const u = await getUser(uid);
              const cu = (u?.chatUsernameNormalized as string | undefined)
                || (u?.chatUsername as string | undefined);
              if (cu) usernames.push(cu);
            }
            if (usernames.length > 0) collectiveOwnerUsernames = usernames;
          }
        }
      }

      liveShows.push({
        name: data.showName as string,
        dj: data.djName as string | undefined,
        profileUsername: undefined,
        stationId: "broadcast",
        stationName: "Channel Radio",
        showId: `broadcast-${slot.id}`,
        djUsername: data.djUsername as string | undefined,
        djUserId: (data.liveDjUserId as string) || (data.djUserId as string) || undefined,
        collectiveOwnerUsernames,
        collectiveOwnerUserIds,
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
        // Require both a date AND a start time — without a time we can't know
        // when the show actually goes live, so don't notify.
        if (!show.date) continue;
        if (!show.time) continue;

        // Convert local date/time/timezone to UTC (same logic as schedule route)
        const timezone = show.timezone || "America/Los_Angeles";
        const timeStr = show.time;
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

    // 4b. Build affiliated-artist sets per live show.
    // For each live show whose live DJ has uid X, the set is the union of:
    //   - X's own affiliatedWithUid (the artist X is affiliated with)
    //   - every DJ-role user Y where Y.djProfile.affiliatedWithUid === X (X's affiliates)
    //   - every DJ-role user Z where Z.djProfile.affiliatedWithUid === X.djProfile.affiliatedWithUid (siblings under the same artist)
    // Users in this set get the same "show starting" email regardless of their watchlist.
    // Recipients still need emailNotifications.showStarting === true AND
    // emailNotifications.affiliatedGoLive !== false (the per-user opt-out).
    const affiliatedByLiveDjUid = new Map<string, string>(); // liveDjUid → their affiliatedWithUid
    const affiliatesByUid = new Map<string, Set<string>>();  // uid → set of users affiliated TO this uid
    for (const djUser of djUsers) {
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const aff = djProfile?.affiliatedWithUid as string | undefined;
      if (!aff) continue;
      affiliatedByLiveDjUid.set(djUser.id, aff);
      const bucket = affiliatesByUid.get(aff) ?? new Set<string>();
      bucket.add(djUser.id);
      affiliatesByUid.set(aff, bucket);
    }

    const affiliatedRecipientsByShowId = new Map<string, Set<string>>();
    // Per-show crew uid set (used both for DJ-side recipients and to feed
    // related(X) for the listener-side affiliation fan-out below).
    const crewUidsByShowId = new Map<string, Set<string>>();
    for (const show of liveShows) {
      if (!show.djUserId) continue;
      const recipients = new Set<string>();
      // X's own affiliation (the artist X is affiliated with)
      const xAffiliation = affiliatedByLiveDjUid.get(show.djUserId);
      if (xAffiliation) recipients.add(xAffiliation);
      // X's direct affiliates
      const directAffiliates = affiliatesByUid.get(show.djUserId);
      if (directAffiliates) directAffiliates.forEach((uid) => recipients.add(uid));
      // Siblings sharing X's affiliation
      if (xAffiliation) {
        const siblings = affiliatesByUid.get(xAffiliation);
        if (siblings) siblings.forEach((uid) => recipients.add(uid));
      }
      // Don't email the live DJ themselves
      recipients.delete(show.djUserId);
      crewUidsByShowId.set(show.showId, new Set(recipients));
      if (recipients.size > 0) affiliatedRecipientsByShowId.set(show.showId, recipients);
    }

    // 4b'. uid → chatUsernameNormalized map (covers DJ-role users). Used
    // to translate Audience + crew uid sets into username-keyed lookups
    // for the engagement / watchlist fan-out below.
    const uidToUsername = new Map<string, string>();
    for (const djUser of djUsers) {
      const cu =
        (djUser.data.chatUsernameNormalized as string | undefined) ||
        (djUser.data.chatUsername as string | undefined);
      if (cu) uidToUsername.set(djUser.id, normalizeForLookup(cu));
    }

    // 4b''. Build related(X) per Channel Radio show: crew(X) ∪ Audience(X).
    // Keyed by normalized chatUsername so it composes with the existing
    // engagement / watchlist matchers (which also use normalized usernames).
    // Always excludes X itself — the live DJ is handled by the direct paths.
    const audienceUidsByLiveDjUid = new Map<string, string[]>();
    for (const djUser of djUsers) {
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
      const aud = djProfile?.audienceDjUids;
      if (Array.isArray(aud) && aud.length > 0) {
        audienceUidsByLiveDjUid.set(
          djUser.id,
          aud.filter((u): u is string => typeof u === "string" && u.length > 0),
        );
      }
    }

    const relatedUsernamesByShowId = new Map<string, Set<string>>();
    for (const show of liveShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUserId || !show.djUsername) continue;
      const related = new Set<string>();
      // Crew
      const crewUids = crewUidsByShowId.get(show.showId);
      if (crewUids) {
        crewUids.forEach((uid) => {
          const name = uidToUsername.get(uid);
          if (name) related.add(name);
        });
      }
      // Audience (admin-curated)
      const audUids = audienceUidsByLiveDjUid.get(show.djUserId);
      if (audUids) {
        audUids.forEach((uid) => {
          const name = uidToUsername.get(uid);
          if (name) related.add(name);
        });
      }
      // Drop X itself (we want related ≠ X — direct paths handle X)
      related.delete(normalizeForLookup(show.djUsername));
      if (related.size > 0) relatedUsernamesByShowId.set(show.showId, related);
    }

    // 4c. Build engagement recipient sets per Channel Radio live show.
    //   Hearters: collection-group query on `loveHistory` where djUsername
    //     matches the live DJ's username. Parent path yields the user UID.
    //   Locked-in: query the DJ's chats/{slug}/messages for messageType
    //     'lockedin' and resolve each message's `username` to a user UID via
    //     a chatUsernameNormalized lookup map built lazily below.
    // These run only for Channel Radio shows (`stationId === "broadcast"`)
    // per the product decision to keep external station notifications opt-in.
    // Engagement signal sources (Channel Radio only):
    //   - hearted: users/{uid}/loveHistory/{djUsername} doc exists
    //   - streamed: users/{uid}/streamHistory/* doc with djUsernames
    //               array_contains the DJ's username (live shows + archives)
    // We union both into a per-DJ `engagedByDjUsername` set, then derive
    // per-show structures:
    //   - engagedByShowId[showId]: uid set for the live DJ X (direct path)
    //   - engagedByRelatedDjByShowId[showId]: map of relatedUsername → uid set
    //                                        (used by the affiliation path)
    const engagedByShowId = new Map<string, Set<string>>();
    const engagedByRelatedDjByShowId = new Map<string, Map<string, Set<string>>>();

    // Per-username cache so we never query the same DJ twice in one cron.
    const engagedByDjUsername = new Map<string, Set<string>>();

    // Collect the full set of DJ usernames we need to query: live DJ +
    // related DJs for every Channel Radio show.
    const allRelatedUsernames = new Set<string>();
    for (const show of liveShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUsername) continue;
      allRelatedUsernames.add(normalizeForLookup(show.djUsername));
      const related = relatedUsernamesByShowId.get(show.showId);
      if (related) related.forEach((u) => allRelatedUsernames.add(u));
    }

    for (const djUsername of Array.from(allRelatedUsernames)) {
      const engaged = new Set<string>();

      // Hearters (loveHistory subcollection)
      const heartDocs = await queryCollectionGroup(
        "loveHistory",
        [{ field: "djUsername", op: "EQUAL", value: djUsername }],
        5000,
      );
      for (const d of heartDocs) {
        const parts = d.parentPath.split("/");
        if (parts.length >= 2 && parts[0] === "users") engaged.add(parts[1]);
      }

      // Streamers (streamHistory subcollection — flat djUsernames array)
      const streamDocs = await queryCollectionGroup(
        "streamHistory",
        [{ field: "djUsernames", op: "ARRAY_CONTAINS", value: djUsername }],
        5000,
      );
      for (const d of streamDocs) {
        const parts = d.parentPath.split("/");
        if (parts.length >= 2 && parts[0] === "users") engaged.add(parts[1]);
      }

      engagedByDjUsername.set(djUsername, engaged);
    }

    // Materialize the per-show structures: X-direct sets + per-related-DJ
    // sets. Filter out the live DJ + collective owners (they shouldn't get
    // their own show's email).
    for (const show of liveShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUsername) continue;
      const xUsername = normalizeForLookup(show.djUsername);

      // Direct (X only)
      const xEngaged = new Set(engagedByDjUsername.get(xUsername) ?? []);
      if (show.djUserId) xEngaged.delete(show.djUserId);
      if (show.collectiveOwnerUserIds) {
        show.collectiveOwnerUserIds.forEach((uid) => xEngaged.delete(uid));
      }
      engagedByShowId.set(show.showId, xEngaged);

      // Per-related-DJ (used for the affiliation path)
      const related = relatedUsernamesByShowId.get(show.showId);
      if (related && related.size > 0) {
        const eMap = new Map<string, Set<string>>();
        related.forEach((r) => {
          const e = new Set(engagedByDjUsername.get(r) ?? []);
          if (show.djUserId) e.delete(show.djUserId);
          if (show.collectiveOwnerUserIds) {
            show.collectiveOwnerUserIds.forEach((uid) => e.delete(uid));
          }
          if (e.size > 0) eMap.set(r, e);
        });
        if (eMap.size > 0) engagedByRelatedDjByShowId.set(show.showId, eMap);
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

      const goLiveMutes = new Set<string>(
        (userData.goLiveMutes as string[] | undefined) || [],
      );

      // DJ users get a stricter matcher: Channel Radio only, and only via
      // favorite / watchlist / crew. No engagement tier, no listener-side
      // bridge, no audience-list expansion. Keeps the DJ inbox quiet.
      const userRole = (userData.role as string | undefined) || "user";
      const isDjUser = userRole === "dj" || userRole === "broadcaster";

      for (const show of liveShows) {
        let matched = false;
        let matchedViaAffiliation = false;
        let affiliationBridgeDj: string | undefined;  // listener-branch only: the related DJ R that bridged
        let engagementReason: "engaged" | undefined;

        const emailNotificationsData = userData.emailNotifications as Record<string, unknown> | undefined;

        if (isDjUser) {
          // DJ branch: Channel Radio only.
          if (show.stationId !== "broadcast") continue;

          // P1a: "show" type favorites (exact show name + station match)
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

          // P1b: "search" type favorites (watchlist).
          if (!matched) {
            for (const term of searchTerms) {
              if (
                wordBoundaryMatch(show.name, term) ||
                (show.dj && wordBoundaryMatch(show.dj, term)) ||
                (show.collectiveOwnerUsernames && show.collectiveOwnerUsernames.some(u => wordBoundaryMatch(u, term)))
              ) {
                matched = true;
                break;
              }
            }
          }

          // P2: Engagement with X directly (hearted X, or streamed any of X's
          // archives / live broadcasts). Channel Radio only, gated by
          // emailNotifications.engagementGoLive — same rule as listeners.
          if (!matched) {
            const engaged = engagedByShowId.get(show.showId);
            if (engaged?.has(userId)) {
              const optOut = emailNotificationsData?.engagementGoLive === false;
              if (!optOut) {
                matched = true;
                engagementReason = "engaged";
              }
            }
          }

          // P3-crew: DJ-side affiliation only (parent + direct affiliates +
          // siblings via affiliatedWithUid). No listener-side bridge.
          if (!matched) {
            const affOptOut = emailNotificationsData?.affiliatedGoLive === false;
            if (!affOptOut) {
              const affiliatedRecipients = affiliatedRecipientsByShowId.get(show.showId);
              if (affiliatedRecipients?.has(userId)) {
                matched = true;
                matchedViaAffiliation = true;
              }
            }
          }
        } else {
          // Listener branch: unchanged. Match priority: favorite > watchlist >
          // engagement > affiliation. First hit wins; that determines the
          // email's footer/caption copy.

          // P1a: "show" type favorites (exact show name + station match)
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

          // P1b: "search" type favorites (watchlist — direct match on X / show name).
          if (!matched) {
            for (const term of searchTerms) {
              if (
                wordBoundaryMatch(show.name, term) ||
                (show.dj && wordBoundaryMatch(show.dj, term)) ||
                (show.collectiveOwnerUsernames && show.collectiveOwnerUsernames.some(u => wordBoundaryMatch(u, term)))
              ) {
                matched = true;
                break;
              }
            }
          }

          // P2: Engagement with X directly (hearted X, or streamed any of X's
          // archives / live broadcasts). Channel Radio only, gated by
          // emailNotifications.engagementGoLive. Engagement outranks
          // affiliation because it's a direct first-party signal — the user
          // already knows X, no need for a "recommended" framing.
          if (!matched && show.stationId === "broadcast") {
            const engaged = engagedByShowId.get(show.showId);
            if (engaged?.has(userId)) {
              const optOut = emailNotificationsData?.engagementGoLive === false;
              if (!optOut) {
                matched = true;
                engagementReason = "engaged";
              }
            }
          }

          // P3: Affiliation — DJ-side (user IS in the crew) OR listener-side
          // (user has a watchlist or engagement signal for any R in related(X)).
          // Both gated by emailNotifications.affiliatedGoLive (defaults true).
          if (!matched) {
            const affOptOut = emailNotificationsData?.affiliatedGoLive === false;
            if (!affOptOut) {
              const affiliatedRecipients = affiliatedRecipientsByShowId.get(show.showId);
              if (affiliatedRecipients?.has(userId)) {
                matched = true;
                matchedViaAffiliation = true;
              } else if (show.stationId === "broadcast") {
                const related = relatedUsernamesByShowId.get(show.showId);
                const engagedByR = engagedByRelatedDjByShowId.get(show.showId);
                if (related) {
                  for (const r of Array.from(related)) {
                    let bridged = false;
                    for (const term of searchTerms) {
                      if (wordBoundaryMatch(r, term)) {
                        bridged = true;
                        break;
                      }
                    }
                    if (!bridged && engagedByR?.get(r)?.has(userId)) bridged = true;
                    if (bridged) {
                      matched = true;
                      matchedViaAffiliation = true;
                      affiliationBridgeDj = r;
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        if (!matched) continue;

        // Universal per-DJ mute: regardless of how this user matched, if they
        // previously clicked "Unsubscribe from {DJ}" in an email or removed
        // an engagement-added card on /explore, skip.
        if (show.djUsername && goLiveMutes.has(show.djUsername)) {
          skipped++;
          continue;
        }

        // Only notify when the DJ is a Channel user (has a linked account).
        // For collectives, "Channel user" means the collective has at least
        // one owner with a UID — the broadcast itself may not have a single
        // djUserId since any owner can claim the slot.
        if (!show.djUserId && !(show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.length > 0)) continue;

        // Don't email the DJ about their own live show. For collectives,
        // skip every owner of the collective.
        if (show.djUserId === userId) continue;
        if (show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.includes(userId)) continue;

        // Dedup: skip if we already emailed about this exact show occurrence
        if (lastShowStartingEmailAt[show.showId]) {
          skipped++;
          continue;
        }

        // Send email
        const success = await sendShowStartingEmail({
          to: userEmail,
          recipientUserId: userId,
          showName: show.name,
          djName: show.dj,
          djUsername: show.djUsername,
          djPhotoUrl: show.djPhotoUrl,
          djHasEmail: show.djHasEmail,
          stationName: show.stationName,
          stationId: show.stationId,
          streamingUrl: show.streamingUrl,
          isAffiliated: matchedViaAffiliation,
          affiliationBridgeDj,
          engagementReason,
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
