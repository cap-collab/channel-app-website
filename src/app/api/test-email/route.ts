import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import { queryUsersWhere, queryCollection } from "@/lib/firebase-rest";

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

// Normalize a name for lookup (same as chatUsernameNormalized in DB)
function normalizeUsername(name: string): string {
  return name.replace(/[\s-]+/g, "").toLowerCase();
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

  // ── Fetch REAL upcoming shows from metadata ──────────────────────
  const allShows: Array<{
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
  }> = [];

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

  // Also fetch broadcast slots from Firebase
  try {
    const broadcastSlots = await queryCollection(
      "broadcast-slots",
      [{ field: "endTime", op: "GREATER_THAN", value: now }],
      500
    );
    for (const slot of broadcastSlots) {
      const data = slot.data;
      const status = data.status as string;
      if (status === "cancelled") continue;
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

  // Also fetch IRL events from DJ profiles
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

  // Filter to only future shows
  const futureShows = allShows.filter((s) => new Date(s.startTime) > now);
  futureShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  console.log(`[test-email] Found ${futureShows.length} upcoming shows`);

  // Build DJ profile map for photo lookups
  const djProfileMap = new Map<string, { username: string; photoUrl?: string }>();
  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const chatUsername = djUser.data.chatUsername as string | undefined;
    if (!chatUsername) continue;
    const normalized = normalizeUsername(chatUsername);
    djProfileMap.set(normalized, {
      username: chatUsername,
      photoUrl: (djProfile?.photoUrl as string) || undefined,
    });
  }

  // Resolve DJ photos for shows (using profileUsername or dj name)
  for (const show of futureShows) {
    if (show.profileUsername) {
      const profile = djProfileMap.get(normalizeUsername(show.profileUsername));
      if (profile) {
        show.djUsername = profile.username;
        show.djPhotoUrl = profile.photoUrl;
      }
    }
    if (!show.djUsername && show.dj) {
      const profile = djProfileMap.get(normalizeUsername(show.dj));
      if (profile) {
        show.djUsername = profile.username;
        show.djPhotoUrl = profile.photoUrl;
      }
    }
  }

  // ── Section 1: Pick real upcoming shows as "favorites" ───────────
  // Take up to 4 shows spread across different days
  const fourDayEnd = new Date(now);
  fourDayEnd.setDate(fourDayEnd.getDate() + 4);
  fourDayEnd.setHours(23, 59, 59, 999);

  const showsInRange = futureShows.filter((s) => new Date(s.startTime) <= fourDayEnd);
  // Pick shows that have a DJ name (more interesting for the email)
  const showsWithDJ = showsInRange.filter((s) => s.dj);
  const favoritePool = showsWithDJ.length >= 3 ? showsWithDJ : showsInRange;

  // Spread across days: pick 1 per day, up to 4
  const dayBuckets = new Map<string, typeof favoritePool>();
  for (const show of favoritePool) {
    const dayKey = new Date(show.startTime).toISOString().split("T")[0];
    if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, []);
    dayBuckets.get(dayKey)!.push(show);
  }

  const sampleFavoriteShows: Array<{
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

  // Take first show from each day, max 4 days
  let daysUsed = 0;
  dayBuckets.forEach((shows) => {
    if (daysUsed >= 4) return;
    const show = shows[0];
    sampleFavoriteShows.push({
      showName: show.name,
      djName: show.dj,
      djUsername: show.djUsername,
      djPhotoUrl: show.djPhotoUrl,
      stationName: show.stationName,
      stationId: show.stationId,
      startTime: new Date(show.startTime),
      isIRL: show.isIRL,
      irlLocation: show.irlLocation,
      irlTicketUrl: show.irlTicketUrl,
    });
    daysUsed++;
  });

  console.log(`[test-email] Selected ${sampleFavoriteShows.length} real favorite shows`);

  // ── Section 2: Fetch REAL curator recs from DJ profiles ──────────
  interface CuratorRecData {
    djName: string;
    djUsername: string;
    djPhotoUrl?: string;
    url: string;
    type: "bandcamp" | "event";
    ogTitle?: string;
    ogImage?: string;
  }
  const sampleCuratorRecs: CuratorRecData[] = [];

  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const chatUsername = djUser.data.chatUsername as string | undefined;
    if (!chatUsername || !djProfile) continue;

    const myRecs = djProfile.myRecs as { bandcampLinks?: string[]; eventLinks?: string[] } | undefined;
    if (!myRecs) continue;

    const djUsername = chatUsername.replace(/\s+/g, "").toLowerCase();
    const djPhotoUrl = (djProfile.photoUrl as string) || undefined;

    for (const url of myRecs.bandcampLinks || []) {
      if (url && sampleCuratorRecs.length < 3) {
        sampleCuratorRecs.push({ djUsername, djName: chatUsername, djPhotoUrl, url, type: "bandcamp" });
      }
    }
    for (const url of myRecs.eventLinks || []) {
      if (url && sampleCuratorRecs.length < 3) {
        sampleCuratorRecs.push({ djUsername, djName: chatUsername, djPhotoUrl, url, type: "event" });
      }
    }
    if (sampleCuratorRecs.length >= 3) break;
  }

  // Enrich curator recs with OG metadata
  if (sampleCuratorRecs.length > 0) {
    const ogResults = await Promise.allSettled(
      sampleCuratorRecs.map((rec) => fetchOgMetadata(rec.url))
    );
    ogResults.forEach((result, i) => {
      if (result.status === "fulfilled") {
        if (result.value.ogTitle) sampleCuratorRecs[i].ogTitle = result.value.ogTitle;
        if (result.value.ogImage) sampleCuratorRecs[i].ogImage = result.value.ogImage;
      }
    });
  }

  console.log(`[test-email] Found ${sampleCuratorRecs.length} real curator recs`);

  // ── Section 3: Pick real preference-matched shows ────────────────
  // Use shows not already picked as favorites, label with station/genre info
  const favoriteShowKeys = new Set(sampleFavoriteShows.map((s) => `${s.showName.toLowerCase()}-${s.stationId}`));
  const samplePreferenceShows: Array<{
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

  for (const show of showsInRange) {
    const showKey = `${show.name.toLowerCase()}-${show.stationId}`;
    if (favoriteShowKeys.has(showKey)) continue;
    if (samplePreferenceShows.length >= 3) break;

    // Build a match label from station name
    const matchLabel = show.stationName.toUpperCase();

    samplePreferenceShows.push({
      showName: show.name,
      djName: show.dj,
      djUsername: show.djUsername,
      djPhotoUrl: show.djPhotoUrl,
      stationName: show.stationName,
      stationId: show.stationId,
      startTime: new Date(show.startTime),
      isIRL: show.isIRL,
      irlLocation: show.irlLocation,
      irlTicketUrl: show.irlTicketUrl,
      matchLabel,
    });
  }

  console.log(`[test-email] Selected ${samplePreferenceShows.length} real preference shows`);

  // Filter by section if specified
  const favoriteShows = section === "2" || section === "3" ? [] : sampleFavoriteShows;
  const curatorRecs = section === "1" || section === "3" ? [] : sampleCuratorRecs;
  const preferenceShows = section === "1" || section === "2" ? [] : samplePreferenceShows;

  try {
    const success = await sendWatchlistDigestEmail({
      to,
      userTimezone: "America/Los_Angeles",
      favoriteShows,
      curatorRecs,
      preferenceShows,
    });

    if (success) {
      return NextResponse.json({
        success: true,
        message: `Test email sent to ${to}`,
        section: section || "all",
        favoriteShowCount: favoriteShows.length,
        curatorRecCount: curatorRecs.length,
        preferenceShowCount: preferenceShows.length,
        favoriteShowNames: favoriteShows.map((s) => s.showName),
        curatorRecDJs: curatorRecs.map((r) => r.djName),
        preferenceShowNames: preferenceShows.map((s) => s.showName),
      });
    } else {
      return NextResponse.json({
        success: false,
        error: "Failed to send email - check server logs"
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Test email error:", error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}

// Test endpoint to preview the watchlist digest email template
// Only works with a secret to prevent abuse
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
