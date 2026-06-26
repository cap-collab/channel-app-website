import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  updateUser,
  updateDocument,
  queryCollection,
  queryCollectionGroup,
  isRestApiConfigured,
} from "@/lib/firebase-rest";
import { wordBoundaryMatch } from "@/lib/dj-matching";

// Discovery now also scans up to 36h ahead to bundle "later today" shows
// per user. Bumped from the default 60s so the matcher state pre-build
// over (live ∪ upcoming) has headroom.
export const maxDuration = 300;

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
  // Per-show cover art stored on the broadcast slot. Preferred over the
  // proxy/profile photo in emails — and the ONLY image that resolves for a
  // collective slot, whose djUsername is a collective slug (no user → the
  // /api/dj-photo proxy 404s, blanking the image).
  showImageUrl?: string;
  djHasEmail?: boolean;
  djUserId?: string; // Firebase UID of the DJ — used to skip sending them their own "go live" email
  streamingUrl?: string;
  // For collective broadcasts: the chatUsernameNormalized of each owner. We
  // expand watchlist matching to cover any of these so a follower of one
  // owner gets notified when the collective is live, and we skip emailing
  // any of them about their own collective's broadcast.
  collectiveOwnerUsernames?: string[];
  collectiveOwnerUserIds?: string[];
  // Normalized usernames of the DJs this show's live entity "borrows from"
  // (audienceDjUids). Z.audienceDjUids = [Y] means "notify fans of Y when Z is
  // live." Spans the live DJ's own audienceDjUids ∪ every collective owner's.
  // Fans of these (love/stream OR watchlist) are notified. Excludes the live
  // DJ / owners themselves.
  borrowedFromUsernames?: string[];
  // ISO start time, populated for upcoming-today shows so the per-user TZ
  // filter and the bundled-row time label can read it. Currently-live shows
  // don't need it.
  startTime?: string;
  // ISO end time — bundle rows render "start – end". Populated on scheduled
  // (bundle) rows from the slot's endTime.
  endTime?: string;
  // Broadcast type for Channel Radio slots. Restreams say "airing" instead
  // of "is live" in the email subject + headline.
  broadcastType?: string;
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

// Resolve a Firestore startTime field to epoch ms across every shape it can
// arrive in. The cron reads slots via the REST helper (firebase-rest.ts),
// which deserializes `timestampValue` to a PLAIN Date — a Date has no
// .toMillis()/.toDate(), so the previous extraction silently yielded
// undefined and every scheduled slot was dropped from the bundle (the Znc
// crew-bundling bug). Handle Date, Firestore Timestamp, and ISO string.
function slotStartMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  const ts = value as { toMillis?: () => number; toDate?: () => Date } | undefined;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  const fromToDate = ts?.toDate?.()?.getTime();
  if (typeof fromToDate === "number") return fromToDate;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

// YYYY-MM-DD in the given timezone. Mirrors the helper in
// broadcast-emails/route.ts so the daily cap rolls over on the user's
// local midnight, not UTC's.
function startDayKey(timestampMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone,
  }).formatToParts(new Date(timestampMs));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

// Walk forward from now until the day key changes — DST-safe, never relies
// on `+24h`. Step coarse first (1h) then fine (1min) to keep the loop
// cheap. Caller passes user's timezone.
function endOfDayMsForUser(nowMs: number, timezone: string): number {
  const todayKey = startDayKey(nowMs, timezone);
  let t = nowMs;
  // Coarse: bump by 1 hour until we cross the day boundary
  while (startDayKey(t, timezone) === todayKey) {
    t += 60 * 60 * 1000;
    if (t > nowMs + 48 * 60 * 60 * 1000) return nowMs + 24 * 60 * 60 * 1000; // safety
  }
  // Fine: back off in 1-minute steps until we're back inside today
  while (startDayKey(t - 60 * 1000, timezone) !== todayKey) {
    t -= 60 * 1000;
    if (t < nowMs) return nowMs + 24 * 60 * 60 * 1000;
  }
  return t - 1; // last millisecond of today in user's TZ
}

// Weekday (0=Sun..6=Sat) of a timestamp in the given timezone.
function weekdayInTz(timestampMs: number, timezone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short", timeZone: timezone,
  }).format(new Date(timestampMs));
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
}

// Last millisecond of the CURRENT week (week ends Sunday) in the user's TZ.
// Walks forward day-by-day from today's end until we reach the end of the
// Sunday on/after today. DST-safe (reuses endOfDayMsForUser per day rather
// than +24h math). If today IS Sunday, returns the end of today.
function endOfWeekMsForUser(nowMs: number, timezone: string): number {
  let endOfDay = endOfDayMsForUser(nowMs, timezone);
  // endOfDay is the last ms of `nowMs`'s local day. Keep advancing one local
  // day until that day is a Sunday.
  let guard = 0;
  while (weekdayInTz(endOfDay, timezone) !== 0 && guard < 8) {
    // Step just past the current day's end, then take that next day's end.
    endOfDay = endOfDayMsForUser(endOfDay + 1, timezone);
    guard++;
  }
  return endOfDay;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Dry-run / simulate-live mode (admin pre-flight) ────────────────────
  // ?dryRun=1 runs the full matcher + bundle logic but sends NOTHING and
  //   stamps NOTHING — it returns a per-recipient trace instead. Safe to run
  //   in prod against the live subscriber base.
  // ?simulateLive=<showId> promotes an upcoming-today show into the live set
  //   so you can pre-flight a DJ's go-live (and crew bundling) before they
  //   actually air. <showId> is the show's showId, e.g. broadcast-<slotId>.
  // ?traceTo=<email> limits the returned trace to one recipient to cut noise.
  // ?traceLimit=<n> caps how many recipient traces come back (default 50).
  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  const simulateLiveId = params.get("simulateLive") || undefined;
  const traceTo = params.get("traceTo")?.toLowerCase() || undefined;
  const traceLimit = Number(params.get("traceLimit")) || 50;
  // ?previewTo=<email> (dry-run only): actually SEND the real email — real
  // primary + real bundle — to this one recipient, while still stamping
  // nothing. Lets an admin see the exact email a given user would receive.
  const previewTo = params.get("previewTo")?.toLowerCase() || undefined;

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

    // 2. Find shows that just started. A show counts as a fresh go-live
    // trigger only if it started within the last 30 minutes (small +5 min
    // future skew so a show starting right at the :01 tick isn't missed).
    // The cron runs hourly, so this floor means a long show (e.g. 2h) is
    // only emailed about on its FIRST tick — on later ticks it's "already
    // live" (>30 min in) and falls out of the live set, so users who only
    // just started streaming/liking the DJ mid-show don't get a late email.
    const now = new Date();
    const LIVE_START_LOOKBACK_MS = 30 * 60 * 1000;
    const windowStart = new Date(now.getTime() - LIVE_START_LOOKBACK_MS);
    const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);
    const liveShows: LiveShow[] = [];
    // Bundling horizon. The "coming up" bundle now lists every scheduled
    // Channel Radio show through the end of the CURRENT week (Sunday) in the
    // recipient's timezone — not just later today. 8 days is wide enough to
    // cover end-of-Sunday in any user TZ from any day of the week; the
    // per-user filter (endOfWeekMsForUser) narrows to the real week boundary.
    const bundleHorizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    // External-station + dj-radio upcoming capture stays at the old 36h. Those
    // paths only fed the legacy per-row "later today" matcher (now removed for
    // them) and pre-building engagement over a full week of external shows
    // would be wasted work — the weekly bundle is Channel-Radio-only.
    const bundleHorizon36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const upcomingTodayShows: LiveShow[] = [];
    // Weekly bundle source: every scheduled Channel Radio (broadcast) slot in
    // the 8-day window AS IT APPEARS IN THE ADMIN SCHEDULE — live shows,
    // restreams, AND anchors. Listed unconditionally for any recipient who
    // gets a primary email; no per-row engagement filter.
    const weeklyBroadcastShows: LiveShow[] = [];

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
            startTime: show.s,
          });
        } else if (start > windowEnd && start <= bundleHorizon36h) {
          upcomingTodayShows.push({
            name: show.n,
            dj: show.j || undefined,
            profileUsername: show.p || undefined,
            additionalProfileUsernames: show.ap || undefined,
            stationId: stationKey,
            stationName: STATION_NAMES[stationKey] || stationKey,
            showId: `${stationKey}-${show.s}`,
            startTime: show.s,
          });
        }
      }
    }

    // Also check Channel Radio shows that are live + scheduled within the
    // bundle horizon. The live set powers the primary card; the scheduled
    // set feeds the "later today" bundle.
    const broadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "status", op: "EQUAL", value: "live" }],
      100,
    );
    const scheduledBroadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "status", op: "EQUAL", value: "scheduled" }],
      200,
    );

    // Batch collective-owner resolution: collect every unique slug used as
    // djUsername across both live + scheduled slots, then resolve owners in
    // a single pass. Avoids the N+1 cost of looking up collectives + owners
    // inline per slot when the schedule has many slots.
    const collectiveOwnerInfoBySlug = new Map<
      string,
      { ownerUids: string[]; ownerUsernames: string[] }
    >();
    const candidateSlugs = new Set<string>();
    for (const s of [...broadcastSlots, ...scheduledBroadcastSlots]) {
      const slug = s.data.djUsername as string | undefined;
      if (slug && slug !== "channelbroadcast") candidateSlugs.add(slug);
    }
    if (candidateSlugs.size > 0) {
      // queryCollection's `in` operator could batch by 10, but the REST
      // helper here doesn't expose that directly. Keep it simple: 1 query
      // per slug, but cache the result so the user-loop pre-build doesn't
      // re-query.
      for (const slug of Array.from(candidateSlugs)) {
        const collectives = await queryCollection(
          "collectives",
          [{ field: "slug", op: "EQUAL", value: slug }],
          1,
        );
        if (collectives.length === 0) continue;
        const ownerUids = (collectives[0].data.owners as string[] | undefined) || [];
        const ownerUsernames: string[] = [];
        for (const uid of ownerUids) {
          const u = await getUser(uid);
          const cu = (u?.chatUsernameNormalized as string | undefined)
            || (u?.chatUsername as string | undefined);
          if (cu) ownerUsernames.push(cu);
        }
        collectiveOwnerInfoBySlug.set(slug, { ownerUids, ownerUsernames });
      }
    }

    const pushBroadcastSlot = (
      slot: { id: string; data: Record<string, unknown> },
      target: LiveShow[],
    ): void => {
      const data = slot.data;
      // Restreams ARE included here. Unlike the follower-blast cron
      // (broadcast-emails), this pipeline only emails engaged/opted-in
      // recipients (favorites, watchlist, love/stream history, crew
      // affiliation) — so a restream going live (as the primary card) or
      // airing later today (bundled into the crew) is a wanted signal, not
      // spam. The "no follower emails for restreams" rule still governs the
      // broadcast-emails blast.
      if (data.djUsername === "channelbroadcast") return;
      // Admin opt-out: a slot flagged from the Marketing tab (e.g. while
      // testing a real DJ/restream go-live) never fans out go-live emails.
      // Anchors reuse this same toggle — set true by default at save time so an
      // anchor sends no go-live emails unless the admin explicitly unchecks it.
      if (data.goLiveEmailsDisabled === true) return;
      const slug = data.djUsername as string | undefined;
      const collectiveInfo = slug ? collectiveOwnerInfoBySlug.get(slug) : undefined;
      const startMs = slotStartMs(data.startTime);
      target.push({
        name: data.showName as string,
        dj: data.djName as string | undefined,
        profileUsername: undefined,
        stationId: "broadcast",
        stationName: "Channel Radio",
        showId: `broadcast-${slot.id}`,
        djUsername: data.djUsername as string | undefined,
        showImageUrl: (data.showImageUrl as string) || undefined,
        djUserId: (data.liveDjUserId as string) || (data.djUserId as string) || undefined,
        collectiveOwnerUsernames: collectiveInfo?.ownerUsernames.length
          ? collectiveInfo.ownerUsernames
          : undefined,
        collectiveOwnerUserIds: collectiveInfo?.ownerUids.length
          ? collectiveInfo.ownerUids
          : undefined,
        startTime: typeof startMs === "number" ? new Date(startMs).toISOString() : undefined,
        broadcastType: data.broadcastType as string | undefined,
      });
    };

    // Schedule-row variant for the weekly "coming up this week" bundle. Unlike
    // pushBroadcastSlot (which gates the matched-recipient go-live), this just
    // mirrors the admin schedule, so it does NOT honor goLiveEmailsDisabled —
    // anchors (which carry that flag by default) still belong in the schedule
    // list. It DOES still skip the hidden channelbroadcast test account.
    const pushScheduleRow = (
      slot: { id: string; data: Record<string, unknown> },
      target: LiveShow[],
    ): void => {
      const data = slot.data;
      if (data.djUsername === "channelbroadcast") return;
      const slug = data.djUsername as string | undefined;
      const collectiveInfo = slug ? collectiveOwnerInfoBySlug.get(slug) : undefined;
      const startMs = slotStartMs(data.startTime);
      const endMs = slotStartMs(data.endTime);
      target.push({
        name: data.showName as string,
        dj: data.djName as string | undefined,
        profileUsername: undefined,
        stationId: "broadcast",
        stationName: "Channel Radio",
        showId: `broadcast-${slot.id}`,
        djUsername: data.djUsername as string | undefined,
        showImageUrl: (data.showImageUrl as string) || undefined,
        djUserId: (data.liveDjUserId as string) || (data.djUserId as string) || undefined,
        collectiveOwnerUsernames: collectiveInfo?.ownerUsernames.length
          ? collectiveInfo.ownerUsernames
          : undefined,
        collectiveOwnerUserIds: collectiveInfo?.ownerUids.length
          ? collectiveInfo.ownerUids
          : undefined,
        startTime: typeof startMs === "number" ? new Date(startMs).toISOString() : undefined,
        endTime: typeof endMs === "number" ? new Date(endMs).toISOString() : undefined,
        broadcastType: data.broadcastType as string | undefined,
      });
    };

    for (const slot of broadcastSlots) {
      // status === 'live' stays true for the whole show, so a long slot would
      // otherwise re-trigger go-live emails every hourly tick for anyone newly
      // engaged mid-show. Gate on start age: only treat a slot as a fresh
      // go-live if it started within the last 30 min (same floor as metadata).
      const startMs = slotStartMs(slot.data.startTime);
      if (typeof startMs === "number" && startMs < windowStart.getTime()) continue;
      pushBroadcastSlot(slot, liveShows);
    }
    for (const slot of scheduledBroadcastSlots) {
      const startMs = slotStartMs(slot.data.startTime);
      if (typeof startMs !== "number") continue;
      const bTypeSched = slot.data.broadcastType as string | undefined;

      // Anchor go-live: an anchor never flips its slot status to 'live' (a
      // passed anchor is completed, not live — see complete-expired-slots), so
      // it can never enter the status=='live' broadcastSlots set above. To
      // still notify when an emails-enabled anchor airs (e.g. a collective
      // anchor → fan out to collective + owner fans), treat an anchor whose
      // start falls in the SAME live window as a fresh primary go-live, pulled
      // from the scheduled set. pushBroadcastSlot honors goLiveEmailsDisabled,
      // so an anchor only fires here if the admin unchecked "disable go-live
      // emails" (anchors default that flag to true).
      if (
        bTypeSched === "anchor" &&
        startMs >= windowStart.getTime() &&
        startMs <= windowEnd.getTime()
      ) {
        pushBroadcastSlot(slot, liveShows);
        continue;
      }

      if (startMs <= windowEnd.getTime()) continue;
      if (startMs > bundleHorizon.getTime()) continue; // 8-day outer bound
      // Weekly "coming up this week" bundle: EVERY scheduled Channel Radio slot
      // exactly as it appears in the admin schedule — live shows, restreams,
      // AND anchors. Listed unconditionally (no per-recipient engagement
      // filter) for anyone who gets a primary email. This is just the schedule,
      // not a personalized list. (channelbroadcast + goLiveEmailsDisabled slots
      // are still filtered inside pushBroadcastSlot.)
      //
      // NOTE: pushBroadcastSlot drops goLiveEmailsDisabled slots, and anchors
      // default that flag to true — so anchors that should appear in the
      // schedule are added directly here, bypassing that filter, while still
      // honoring channelbroadcast + the per-slot disable for non-anchors.
      const bType = slot.data.broadcastType as string | undefined;
      pushScheduleRow(slot, weeklyBroadcastShows);
      // Keep the 36h upcoming set populated for the engagement pre-build below
      // (unchanged behavior for anything still reading upcomingTodayShows).
      // Restreams/anchors never matched the primary tiers anyway.
      if (startMs <= bundleHorizon36h.getTime() && bType !== "restream" && bType !== "anchor") {
        pushBroadcastSlot(slot, upcomingTodayShows);
      }
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

        const inLiveWindow = startTime >= windowStart && startTime <= windowEnd;
        const inBundleWindow = startTime > windowEnd && startTime <= bundleHorizon36h;
        if (inLiveWindow || inBundleWindow) {
          const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
          const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
          const normalizedUsername = chatUsername?.replace(/\s+/g, "").toLowerCase();
          const showId = `dj-radio-${normalizedUsername}-${show.date}-${radioNameSlug}-${showNameSlug}`;
          const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

          const entry: LiveShow = {
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
            startTime: new Date(startTimeMs).toISOString(),
          };
          if (inLiveWindow) liveShows.push(entry);
          else upcomingTodayShows.push(entry);
        }
      }
    }

    // Simulate-live: promote a named upcoming show into the live set so an
    // admin can pre-flight a not-yet-aired DJ's go-live email (including crew
    // bundling) without waiting for the real window. Only meaningful with
    // dryRun — guard against accidental real sends.
    if (simulateLiveId) {
      if (!dryRun) {
        return NextResponse.json(
          { error: "simulateLive requires dryRun=1 (refusing to send a simulated go-live for real)" },
          { status: 400 },
        );
      }
      const idx = upcomingTodayShows.findIndex((s) => s.showId === simulateLiveId);
      if (idx === -1) {
        return NextResponse.json({
          error: `simulateLive show not found in upcoming-today set: ${simulateLiveId}`,
          hint: "Pass the show's showId (e.g. broadcast-<slotId>). It must start within the next 36h and not be a restream.",
          availableUpcoming: upcomingTodayShows.map((s) => ({ showId: s.showId, name: s.name, djUsername: s.djUsername, startTime: s.startTime })),
        }, { status: 404 });
      }
      const [promoted] = upcomingTodayShows.splice(idx, 1);
      liveShows.push(promoted);
      console.log(`[show-starting][dryRun] Simulating live: ${promoted.djUsername || promoted.name} (${promoted.showId})`);
    }

    if (liveShows.length === 0) {
      return NextResponse.json({ liveShows: 0, emailsSent: 0, dryRun });
    }

    console.log(
      `[show-starting] Found ${liveShows.length} live shows, ${upcomingTodayShows.length} upcoming-today shows`,
    );

    // Matcher pre-build (sections 4, 4b, 4b', 4c) runs over the union so
    // that bundled "later today" shows can be matched per user without
    // re-querying engagement / affiliation state.
    const allMatchableShows: LiveShow[] = [...liveShows, ...upcomingTodayShows];

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

    // 4. Resolve DJ profiles for all matchable shows using `p` field, falling back to `ap`
    for (const show of allMatchableShows) {
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
    for (const show of allMatchableShows) {
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
      if (recipients.size > 0) affiliatedRecipientsByShowId.set(show.showId, recipients);
    }

    // 4b'. uid → chatUsernameNormalized map (covers DJ-role users). Used
    // to translate Audience + crew uid sets into username-keyed lookups
    // for the engagement / watchlist fan-out below.
    const uidToUsername = new Map<string, string>();
    // Parallel display map: normalized bridge username -> the DJ's raw
    // chatUsername (e.g. "naomigreen" -> "Naomi Green"). The related-DJ sets
    // and matcher key off the normalized form; this recovers the human-facing
    // casing/spacing for the "From the same world as {R}." caption only.
    const normalizedUsernameToDisplay = new Map<string, string>();
    for (const djUser of djUsers) {
      const rawChatUsername = djUser.data.chatUsername as string | undefined;
      const cu =
        (djUser.data.chatUsernameNormalized as string | undefined) ||
        rawChatUsername;
      if (cu) {
        const normalized = normalizeForLookup(cu);
        uidToUsername.set(djUser.id, normalized);
        if (rawChatUsername) normalizedUsernameToDisplay.set(normalized, rawChatUsername);
      }
    }

    // Listener-side bridge: audience map (direct, not inverse).
    //
    // Semantic: X.audienceDjUids = [Y] means "X borrows from Y" — when X
    // goes live, notify fans of Y. So for a live DJ X, read X's own
    // audienceDjUids and bridge to fans of every DJ in that list.
    //
    // Keyed by normalized chatUsername so it composes with the existing
    // engagement / watchlist matchers (which also use normalized usernames).
    // Always excludes the live DJ themselves — the live DJ is handled by
    // direct paths.
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

    // Per-show "borrows from" audience. Z.audienceDjUids = [Y] means "when Z
    // goes live, notify fans of Y." The live entity Z is the DJ (solo show) OR
    // the collective — and since collectives have no audienceDjUids field of
    // their own, a collective's borrow list is the union of EVERY owner's
    // audienceDjUids. We resolve the borrowed-from uids (Y) to normalized
    // usernames; fans of those (love/stream OR watchlist) are notified.
    // Excludes the live DJ + owners themselves (they're handled by direct
    // paths and must never get their own show's email). This is the ONLY
    // listener-side bridge kept after the 2026-06-25 narrowing — the crew /
    // affiliation bridge stays removed.
    const borrowedFromUsernamesByShowId = new Map<string, Set<string>>();
    for (const show of allMatchableShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUsername) continue;
      // Source uids whose audienceDjUids we read: the live DJ + every owner.
      const sourceUids = new Set<string>();
      if (show.djUserId) sourceUids.add(show.djUserId);
      if (show.collectiveOwnerUserIds) {
        show.collectiveOwnerUserIds.forEach((uid) => sourceUids.add(uid));
      }
      const borrowedFrom = new Set<string>();
      for (const srcUid of Array.from(sourceUids)) {
        const audUids = audienceUidsByLiveDjUid.get(srcUid);
        if (!audUids) continue;
        for (const yUid of audUids) {
          const yName = uidToUsername.get(yUid);
          if (yName) borrowedFrom.add(yName);
        }
      }
      // Never bridge back to the live DJ or an owner.
      borrowedFrom.delete(normalizeForLookup(show.djUsername));
      if (show.collectiveOwnerUsernames) {
        show.collectiveOwnerUsernames.forEach((u) =>
          borrowedFrom.delete(normalizeForLookup(u)),
        );
      }
      if (borrowedFrom.size > 0) {
        borrowedFromUsernamesByShowId.set(show.showId, borrowedFrom);
        show.borrowedFromUsernames = Array.from(borrowedFrom);
      }
    }

    // Build the listener-side "related DJs" map. The listener-side bridge in
    // matchShow() uses this to extend listener engagement (heart / stream / search
    // favorite) from one DJ to a related DJ — i.e. "you've engaged with one
    // member of this crew, you'll hear about the whole crew."
    //
    // Two sources are unioned per show:
    //   1. Audience-lent: live DJ X has audienceDjUids = [Y, …] (X borrows from Y).
    //      Fans of Y get bridged to X's show.
    //   2. Crew/affiliation: X's parent + direct affiliates + siblings under
    //      same parent. Fans of any one crew member get bridged to every crew
    //      member's show.
    //
    // Keyed by normalized chatUsername so it composes with the existing
    // engagement / watchlist matchers. Always excludes the live DJ themselves.
    const relatedUsernamesByShowId = new Map<string, Set<string>>();
    // Subset of related[] that came specifically from the audience-borrow
    // source (live DJ borrows DJ X's fans). Used only to pick the bridge
    // caption: crew bridges read "From the same world as X.", audience-borrow
    // bridges read "If you like X.". A name appearing in both sources is
    // treated as crew (crew wins), so this set is consulted only after the
    // crew set misses.
    const borrowedUsernamesByShowId = new Map<string, Set<string>>();
    for (const show of allMatchableShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUserId || !show.djUsername) continue;
      const related = new Set<string>();
      const borrowed = new Set<string>();
      // 1. Audience-lent
      const audUids = audienceUidsByLiveDjUid.get(show.djUserId);
      if (audUids) {
        audUids.forEach((uid) => {
          const name = uidToUsername.get(uid);
          if (name) {
            related.add(name);
            borrowed.add(name);
          }
        });
      }
      // 2. Crew/affiliation — mirror the DJ-side affiliatedRecipientsByShowId
      // construction, but emit usernames (for the engagement bridge) instead
      // of uids (for direct affiliated-recipients). Crew names also land in
      // `related`; any crew name is removed from `borrowed` below so a DJ who
      // is both crew and audience-lent is captioned as crew (crew wins).
      const addCrew = (name: string) => {
        related.add(name);
        borrowed.delete(name);
      };
      const xAffiliation = affiliatedByLiveDjUid.get(show.djUserId);
      if (xAffiliation) {
        const name = uidToUsername.get(xAffiliation);
        if (name) addCrew(name);
      }
      const directAffiliates = affiliatesByUid.get(show.djUserId);
      if (directAffiliates) {
        directAffiliates.forEach((uid) => {
          const name = uidToUsername.get(uid);
          if (name) addCrew(name);
        });
      }
      if (xAffiliation) {
        const siblings = affiliatesByUid.get(xAffiliation);
        if (siblings) {
          siblings.forEach((uid) => {
            const name = uidToUsername.get(uid);
            if (name) addCrew(name);
          });
        }
      }
      const selfNorm = normalizeForLookup(show.djUsername);
      related.delete(selfNorm);
      borrowed.delete(selfNorm);
      if (related.size > 0) relatedUsernamesByShowId.set(show.showId, related);
      if (borrowed.size > 0) borrowedUsernamesByShowId.set(show.showId, borrowed);
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
    // upcoming-today DJ + collective owners + related DJs for every Channel
    // Radio show. Collective owners are included so that a collective go-live
    // fans out to fans (love/stream history) of each owner — not just fans of
    // the collective slug itself. (Watchlist/favorite of an owner already
    // matches via collectiveOwnerUsernames in the matcher.)
    const allRelatedUsernames = new Set<string>();
    for (const show of allMatchableShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUsername) continue;
      allRelatedUsernames.add(normalizeForLookup(show.djUsername));
      if (show.collectiveOwnerUsernames) {
        show.collectiveOwnerUsernames.forEach((u) =>
          allRelatedUsernames.add(normalizeForLookup(u)),
        );
      }
      // Borrowed-from DJs (audienceDjUids of the live DJ + owners) — their
      // love/stream fans are notified, so query them too. Already normalized.
      const borrowedFrom = borrowedFromUsernamesByShowId.get(show.showId);
      if (borrowedFrom) borrowedFrom.forEach((u) => allRelatedUsernames.add(u));
      const related = relatedUsernamesByShowId.get(show.showId);
      if (related) related.forEach((u) => allRelatedUsernames.add(u));
    }

    for (const djUsername of Array.from(allRelatedUsernames)) {
      const engaged = new Set<string>();

      // Hearters (loveHistory subcollection). djUsernameNormalized is the
      // canonical field; queries match chatUsernameNormalized exactly.
      const heartDocs = await queryCollectionGroup(
        "loveHistory",
        [{ field: "djUsernameNormalized", op: "EQUAL", value: djUsername }],
        5000,
      );
      for (const d of heartDocs) {
        const parts = d.parentPath.split("/");
        if (parts.length >= 2 && parts[0] === "users") engaged.add(parts[1]);
      }

      // Streamers (streamHistory subcollection — flat djUsernamesNormalized array)
      const streamDocs = await queryCollectionGroup(
        "streamHistory",
        [{ field: "djUsernamesNormalized", op: "ARRAY_CONTAINS", value: djUsername }],
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
    for (const show of allMatchableShows) {
      if (show.stationId !== "broadcast") continue;
      if (!show.djUsername) continue;
      const xUsername = normalizeForLookup(show.djUsername);

      // Direct engaged set for this show = fans (love/stream) of the live
      // DJ/collective slug. For a COLLECTIVE show we also union in fans of
      // every owner, so a collective go-live reaches people who engaged an
      // individual owner (e.g. m50) even if they never engaged the "etc radio"
      // collective itself. Owner usernames were queried into engagedByDjUsername
      // above. Owners + the live DJ are then removed so nobody gets their own
      // collective's email.
      const xEngaged = new Set(engagedByDjUsername.get(xUsername) ?? []);
      if (show.collectiveOwnerUsernames) {
        for (const ownerName of show.collectiveOwnerUsernames) {
          const ownerEngaged = engagedByDjUsername.get(normalizeForLookup(ownerName));
          if (ownerEngaged) ownerEngaged.forEach((uid) => xEngaged.add(uid));
        }
      }
      // Borrowed-from audience: fold in love/stream fans of every DJ the live
      // entity borrows from (audienceDjUids of the DJ + owners). "Z borrows
      // from Y → notify fans of Y." Watchlisters of Y are handled separately in
      // the matcher via show.borrowedFromUsernames.
      const borrowedFrom = borrowedFromUsernamesByShowId.get(show.showId);
      if (borrowedFrom) {
        for (const yName of Array.from(borrowedFrom)) {
          const yEngaged = engagedByDjUsername.get(yName);
          if (yEngaged) yEngaged.forEach((uid) => xEngaged.add(uid));
        }
      }
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
    // Track per-slot send counts so we can stamp Channel Radio slot docs at
    // the end. Keyed by broadcast-slot doc id (parsed from showId).
    const perSlotCount = new Map<string, number>();
    // Dry-run trace: one entry per recipient who WOULD be emailed. Populated
    // only when dryRun is set; returned in the JSON response.
    type DryRunEntry = {
      email: string;
      userId: string;
      primary: string;
      // Why this recipient matched the primary show: favorite | watchlist |
      // engaged | affiliated-artist | bridge-crew(<dj>) | bridge-borrow(<dj>).
      reason: string;
      bundled: string[];
      bundleTrace: string[];
    };
    const dryRunTrace: DryRunEntry[] = [];

    for (const userDoc of usersWithNotifications) {
      const userId = userDoc.id;
      const userData = await getUser(userId);
      if (!userData) continue;

      const userEmail = userData.email as string;
      if (!userEmail) continue;

      // Daily cap: at most one go-live email per user per local calendar day.
      // Checked BEFORE per-show matching so a capped user short-circuits the
      // whole loop. Rolls over at user's local midnight, not UTC.
      const userTz = (userData.timezone as string) || "America/Los_Angeles";
      const todayKey = startDayKey(now.getTime(), userTz);
      const lastDate = userData.lastShowStartingEmailDate as string | undefined;
      if (lastDate === todayKey) { skipped++; continue; }
      // End of the CURRENT week (through Sunday) in the user's TZ — the outer
      // bound for the "coming up this week" schedule bundle.
      const endOfWeekMs = endOfWeekMsForUser(now.getTime(), userTz);

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

      // Go-live emails use one unified matcher for every recipient — DJs and
      // listeners alike (product decision 2026-06-10). There used to be a
      // stricter "DJ inbox quiet" path; it silently dropped DJ-role fans, so
      // it was removed. See matchShow below.
      const emailNotificationsData = userData.emailNotifications as Record<string, unknown> | undefined;

      // Run the existing 4-tier matcher against a single show. Returns
      // match metadata if the user matched (and how), or null. Reused for
      // the primary live-show pass AND the "later today" bundle pass — the
      // same matching rules govern both so a bundled row honors the same
      // engagement / affiliation / mute logic.
      const matchShow = (show: LiveShow): {
        engagementReason?: "engaged";
        savedReason?: "favorite" | "watchlist";
        // When the match came through the audience-borrow bridge (the live
        // entity borrows DJ Y's fans), this is Y's display name → the email
        // renders the "If you like Y." caption. Undefined for direct matches.
        borrowBridgeDj?: string;
      } | null => {
        let matched = false;
        let engagementReason: "engaged" | undefined;
        let savedReason: "favorite" | "watchlist" | undefined;
        let borrowBridgeDj: string | undefined;

        // Resolve a borrowed-from username (normalized) to its display name for
        // the "If you like X." caption. Falls back to the normalized form.
        const borrowDisplay = (norm: string) =>
          normalizedUsernameToDisplay.get(norm) || norm;

        // Channel Radio only. Go-live emails never fire for external-station
        // shows (nts, subtle, dublab, rinse, sutro, …), for ANY recipient or
        // match tier — product decision 2026-06-10. This replaces the older
        // "external is opt-in via favorites" nuance; it's now a hard gate.
        if (show.stationId !== "broadcast") return null;

        // Unified matcher — every recipient (listener OR DJ) goes through the
        // same tiers: favorite → watchlist → direct engagement → affiliation/
        // audience bridge. The go-live email used to split into a stricter
        // "DJ inbox quiet" branch that skipped the engagement tier and the
        // borrowed-audience engagement bridge, which silently dropped DJ-role
        // recipients who were genuine fans of a live or borrowed DJ. Product
        // decision (2026-06-10): same email for everyone. Opt-outs
        // (engagementGoLive / affiliatedGoLive / goLiveMutes) still apply.
        for (const fav of showFavorites) {
          const favTerm = ((fav.data.term as string) || "").toLowerCase();
          const favStation = (fav.data.stationId as string) || "";
          const favShowName = ((fav.data.showName as string) || "").toLowerCase();
          if (
            (favStation === show.stationId || !favStation) &&
            (favTerm === show.name.toLowerCase() || favShowName === show.name.toLowerCase())
          ) {
            matched = true;
            savedReason = "favorite";
            break;
          }
        }

        if (!matched) {
          for (const term of searchTerms) {
            if (
              wordBoundaryMatch(show.name, term) ||
              (show.dj && wordBoundaryMatch(show.dj, term)) ||
              (show.collectiveOwnerUsernames && show.collectiveOwnerUsernames.some(u => wordBoundaryMatch(u, term)))
            ) {
              matched = true;
              savedReason = "watchlist";
              break;
            }
          }
        }

        if (!matched && show.stationId === "broadcast") {
          const engaged = engagedByShowId.get(show.showId);
          if (engaged?.has(userId)) {
            const optOut = emailNotificationsData?.engagementGoLive === false;
            if (!optOut) {
              matched = true;
              engagementReason = "engaged";
              // engagedByShowId unions the live DJ/collective/owner fans with
              // fans of every borrowed-from DJ. If this recipient is NOT a
              // direct fan of the live DJ (or an owner), the love/stream match
              // came through the borrow — caption it "If you like Y." Find the
              // first borrowed-from Y they're actually engaged with.
              const directNorms = [
                show.djUsername ? normalizeForLookup(show.djUsername) : null,
                ...(show.collectiveOwnerUsernames || []).map((u) => normalizeForLookup(u)),
              ].filter((n): n is string => !!n);
              const isDirect = directNorms.some((n) => engagedByDjUsername.get(n)?.has(userId));
              if (!isDirect) {
                const y = (show.borrowedFromUsernames || []).find(
                  (n) => engagedByDjUsername.get(n)?.has(userId),
                );
                if (y) borrowBridgeDj = borrowDisplay(y);
              }
            }
          }
        }

        // Borrowed-from audience — WATCHLIST path. The live entity (DJ +/or
        // collective owners) borrows from DJ Y (audienceDjUids); a user who
        // watchlisted/favorited Y is bridged to this show. Y's love/stream fans
        // are already folded into engagedByShowId above (caught by the
        // engagement tier), so only the watchlist-of-Y case needs handling here.
        // A borrow is an engagement-grade fan-out, so it honors the SAME
        // engagementGoLive opt-out — not the watchlist tier (which has none).
        if (!matched && show.stationId === "broadcast" && emailNotificationsData?.engagementGoLive !== false) {
          const borrowedFrom = show.borrowedFromUsernames;
          if (borrowedFrom && borrowedFrom.length > 0) {
            for (const term of searchTerms) {
              const y = borrowedFrom.find((n) => wordBoundaryMatch(n, term));
              if (y) {
                matched = true;
                engagementReason = "engaged";
                borrowBridgeDj = borrowDisplay(y);
                break;
              }
            }
          }
        }

        // NOTE: the crew / affiliation bridge tier (the old tier 4) is
        // intentionally REMOVED. Go-live emails go to recipients with a DIRECT
        // signal on the live artist (favorite / watchlist / love-stream of the
        // DJ, collective, or any collective owner) PLUS the audience-borrow
        // bridge above (fans of a DJ the live entity borrows from via
        // audienceDjUids). No crew / affiliation / sibling fan-out.
        // (Narrowed 2026-06-25; audience-borrow re-added per Cap.)

        return matched ? { engagementReason, savedReason, borrowBridgeDj } : null;
      };

      // Shared universal gates that must hold for ANY show going into the
      // email (primary or bundled). Returns true if the show should be
      // skipped for this user.
      const failsUniversalGates = (show: LiveShow): boolean => {
        if (show.djUsername && goLiveMutes.has(show.djUsername)) return true;
        if (!show.djUserId && !(show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.length > 0)) return true;
        if (show.djUserId === userId) return true;
        if (show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.includes(userId)) return true;
        return false;
      };

      // ── Primary pass: find the first matching currently-live show ────
      let primary: LiveShow | null = null;
      let primaryMatch: NonNullable<ReturnType<typeof matchShow>> | null = null;
      for (const show of liveShows) {
        const m = matchShow(show);
        if (!m) continue;
        if (failsUniversalGates(show)) continue;
        if (lastShowStartingEmailAt[show.showId]) { skipped++; continue; }
        primary = show;
        primaryMatch = m;
        break;
      }

      if (!primary || !primaryMatch) continue;

      // ── Bundle pass: "coming up this week" schedule ──────────────────
      // Unconditional: every scheduled Channel Radio slot (live shows,
      // restreams, anchors) from now through the end of the user's current
      // week. NOT personalized — it mirrors the admin schedule. We only apply
      // structural gates: drop the primary itself, drop slots already stamped
      // for this user, and drop the recipient's own / their collective's slots
      // and muted DJs. No favorite/love/stream match required.
      type BundledRow = {
        showId: string;
        showName: string;
        djName?: string;
        djUsername?: string;
        djPhotoUrl?: string;
        showImageUrl?: string;
        stationName: string;
        stationId: string;
        startTime: string;
        endTime?: string;
        startTimeMs: number;
      };
      const bundled: BundledRow[] = [];
      const bundleTrace: string[] = [];
      for (const show of weeklyBroadcastShows) {
        const reject = (reason: string) => bundleTrace.push(`${show.djUsername || show.name}:${reason}`);
        if (!show.startTime) { reject("no-startTime"); continue; }
        const startMs = Date.parse(show.startTime);
        if (!Number.isFinite(startMs)) { reject("bad-startMs"); continue; }
        if (startMs <= now.getTime()) { reject("past"); continue; }
        if (startMs > endOfWeekMs) { reject("after-week"); continue; }
        if (show.showId === primary.showId) { reject("is-primary"); continue; }
        if (lastShowStartingEmailAt[show.showId]) { reject("already-stamped"); continue; }
        // Lighter gate than the primary's failsUniversalGates: a schedule row
        // is identified by its showName/showImageUrl, so it does NOT require a
        // resolved djUserId (restreams/anchors often lack one until they go
        // live). Still skip muted DJs and the recipient's own / their
        // collective's slots.
        if (show.djUsername && goLiveMutes.has(show.djUsername)) { reject("muted"); continue; }
        if (show.djUserId && show.djUserId === userId) { reject("own-slot"); continue; }
        if (show.collectiveOwnerUserIds?.includes(userId)) { reject("own-collective"); continue; }
        bundleTrace.push(`${show.djUsername || show.name}:MATCHED(schedule)`);
        bundled.push({
          showId: show.showId,
          showName: show.name,
          djName: show.dj,
          djUsername: show.djUsername,
          djPhotoUrl: show.djPhotoUrl,
          showImageUrl: show.showImageUrl,
          stationName: show.stationName,
          stationId: show.stationId,
          startTime: show.startTime,
          endTime: show.endTime,
          startTimeMs: startMs,
        });
      }
      bundled.sort((a, b) => a.startTimeMs - b.startTimeMs);
      const laterToday = bundled.map((b) => ({
        showId: b.showId,
        showName: b.showName,
        djName: b.djName,
        djUsername: b.djUsername,
        djPhotoUrl: b.djPhotoUrl,
        showImageUrl: b.showImageUrl,
        stationName: b.stationName,
        stationId: b.stationId,
        startTime: b.startTime,
        endTime: b.endTime,
      }));

      // ── Dry-run: record what WOULD be sent, then skip send + stamp ──────
      if (dryRun) {
        if (!traceTo || userEmail.toLowerCase() === traceTo) {
          if (dryRunTrace.length < traceLimit) {
            const reason = primaryMatch.borrowBridgeDj
              ? `borrow(${primaryMatch.borrowBridgeDj})`
              : primaryMatch.engagementReason
              ? "engaged"
              : primaryMatch.savedReason ?? "favorite";
            dryRunTrace.push({
              email: userEmail,
              userId,
              primary: `${primary.djUsername || primary.name} (${primary.showId})`,
              reason,
              bundled: laterToday.map((b) => `${b.djUsername || b.showName} @ ${b.startTime}`),
              bundleTrace,
            });
          }
        }
        // Preview: send the real email to one recipient, but still stamp
        // nothing (so it doesn't suppress their real email later).
        if (previewTo && userEmail.toLowerCase() === previewTo) {
          await sendShowStartingEmail({
            to: userEmail,
            recipientUserId: userId,
            showName: primary.name,
            djName: primary.dj,
            djUsername: primary.djUsername,
            djPhotoUrl: primary.djPhotoUrl,
            showImageUrl: primary.showImageUrl,
            djHasEmail: primary.djHasEmail,
            stationName: primary.stationName,
            stationId: primary.stationId,
            streamingUrl: primary.streamingUrl,
            isRestream: primary.broadcastType === "restream",
            engagementReason: primaryMatch.engagementReason,
            savedReason: primaryMatch.savedReason,
            affiliationBridgeDj: primaryMatch.borrowBridgeDj,
            bridgeKind: primaryMatch.borrowBridgeDj ? "borrow" : undefined,
            laterToday: laterToday.length > 0 ? laterToday : undefined,
            userTimezone: userTz,
          });
          console.log(`[show-starting][dryRun] Preview email sent to ${userEmail} (no stamp)`);
        }
        emailsSent++; // count as "would-send" for the summary
        continue;
      }

      // ── Send ──────────────────────────────────────────────────────────
      const success = await sendShowStartingEmail({
        to: userEmail,
        recipientUserId: userId,
        showName: primary.name,
        djName: primary.dj,
        djUsername: primary.djUsername,
        djPhotoUrl: primary.djPhotoUrl,
        showImageUrl: primary.showImageUrl,
        djHasEmail: primary.djHasEmail,
        stationName: primary.stationName,
        stationId: primary.stationId,
        streamingUrl: primary.streamingUrl,
        isRestream: primary.broadcastType === "restream",
        engagementReason: primaryMatch.engagementReason,
        savedReason: primaryMatch.savedReason,
        affiliationBridgeDj: primaryMatch.borrowBridgeDj,
        bridgeKind: primaryMatch.borrowBridgeDj ? "borrow" : undefined,
        laterToday: laterToday.length > 0 ? laterToday : undefined,
        userTimezone: userTz,
      });

      if (success) {
        // Stamp ONLY the primary show. The bundle is now the week's full
        // schedule (not a crew who are also live now), so a bundled row WILL
        // have its own go-live moment later this week — stamping it here would
        // suppress that real go-live email for this user via the per-show
        // dedup check. The daily cap is the only guard the bundle needs.
        lastShowStartingEmailAt[primary.showId] = now.toISOString();
        await updateUser(userId, {
          lastShowStartingEmailAt,
          lastShowStartingEmailDate: todayKey,
        });
        emailsSent++;
        // Only bump perSlotCount for the PRIMARY broadcast slot — bundled
        // scheduled-slot showIds shouldn't inflate goLiveEmailsTotalCount
        // on those slot docs (their go-live moment hasn't fired yet).
        if (primary.showId.startsWith("broadcast-")) {
          const slotId = primary.showId.slice("broadcast-".length);
          perSlotCount.set(slotId, (perSlotCount.get(slotId) ?? 0) + 1);
        }
        console.log(`[show-starting] Sent email to ${userId} for "${primary.name}" on ${primary.stationName}${laterToday.length > 0 ? ` (+${laterToday.length} bundled)` : ""} | bundleTrace=[${bundleTrace.join(", ")}] | upcomingTodayShows=${upcomingTodayShows.length}`);
      }
    }

    console.log(`[show-starting] Done: ${emailsSent} emails sent, ${skipped} skipped (rate limited)`);

    // Stamp Channel Radio slot docs with the cumulative email count + last
    // run timestamp. Powers the Marketing tab readout. Best-effort: never
    // blocks the cron response. Reads the prior count from the in-memory
    // broadcastSlots fetched earlier so we accumulate across runs without
    // an extra Firestore round-trip.
    // Dry-run never touches Firestore — return the trace and bail before any
    // slot-doc stamping.
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        simulateLive: simulateLiveId ?? null,
        liveShows: liveShows.length,
        usersChecked: usersWithNotifications.length,
        wouldSend: emailsSent,
        skipped,
        traceCount: dryRunTrace.length,
        trace: dryRunTrace,
      });
    }

    const runAt = now.toISOString();
    const priorCountBySlotId = new Map<string, number>();
    for (const slot of broadcastSlots) {
      const prior = slot.data.goLiveEmailsTotalCount;
      if (typeof prior === "number") priorCountBySlotId.set(slot.id, prior);
    }
    const perSlotResults: Array<{ slotId: string; emailsSent: number }> = [];
    for (const [slotId, count] of Array.from(perSlotCount.entries())) {
      perSlotResults.push({ slotId, emailsSent: count });
      const newTotal = (priorCountBySlotId.get(slotId) ?? 0) + count;
      try {
        await updateDocument("broadcast-slots", slotId, {
          goLiveEmailsLastRunAt: runAt,
          goLiveEmailsLastRunCount: count,
          goLiveEmailsTotalCount: newTotal,
        });
      } catch (err) {
        console.error(`[show-starting] Failed to stamp slot ${slotId}:`, err);
      }
    }

    return NextResponse.json({
      liveShows: liveShows.length,
      usersChecked: usersWithNotifications.length,
      emailsSent,
      skipped,
      perSlot: perSlotResults,
    });
  } catch (error) {
    console.error("[show-starting] Error:", error);
    return NextResponse.json(
      { error: "Failed to process show starting emails" },
      { status: 500 }
    );
  }
}
