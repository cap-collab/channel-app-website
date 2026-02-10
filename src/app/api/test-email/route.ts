import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import { queryUsersWhere, queryCollection } from "@/lib/firebase-rest";

// Normalize a name for lookup (same as chatUsernameNormalized in DB)
function normalizeUsername(name: string): string {
  return name.replace(/[\s-]+/g, "").toLowerCase();
}

// Look up DJ profile by normalized username
// Checks BOTH pending-dj-profiles AND users collections (same as /my-shows client)
// Returns chatUsername (for URL) and photoUrl (for picture) if profile exists
async function getDJProfile(searchTerm: string): Promise<{ username: string; photoUrl?: string } | null> {
  try {
    const normalized = normalizeUsername(searchTerm);
    console.log(`[getDJProfile] Looking up "${searchTerm}" → normalized: "${normalized}"`);

    // 1. Check pending-dj-profiles FIRST (like the client does)
    const pendingProfiles = await queryCollection(
      "pending-dj-profiles",
      [{ field: "chatUsernameNormalized", op: "EQUAL", value: normalized }],
      1
    );

    if (pendingProfiles.length > 0) {
      const data = pendingProfiles[0].data;
      const chatUsername = data.chatUsername as string | undefined;
      const djProfile = data.djProfile as Record<string, unknown> | undefined;
      const photoUrl = djProfile?.photoUrl as string | undefined;

      console.log(`[getDJProfile] Found PENDING DJ profile:`, { chatUsername, photoUrl });

      if (chatUsername) {
        return { username: chatUsername, photoUrl };
      }
    }

    // 2. Fall back to users collection (approved DJs)
    const users = await queryUsersWhere("chatUsernameNormalized", "EQUAL", normalized);

    for (const user of users) {
      const role = user.data.role as string | undefined;
      // Only match DJ/broadcaster/admin profiles
      if (role === "dj" || role === "broadcaster" || role === "admin") {
        const chatUsername = user.data.chatUsername as string | undefined;
        const djProfile = user.data.djProfile as Record<string, unknown> | undefined;
        const photoUrl = djProfile?.photoUrl as string | undefined;

        console.log(`[getDJProfile] Found USER DJ profile:`, { chatUsername, role, photoUrl });

        if (chatUsername) {
          return { username: chatUsername, photoUrl };
        }
      }
    }

    console.log(`[getDJProfile] No DJ profile found for "${searchTerm}"`);
  } catch (error) {
    console.error("Error looking up DJ profile:", error);
  }
  return null;
}

async function sendTestEmail(to: string, section?: string) {
  // Look up real DJ profiles - only set username if profile exists
  const pariahProfile = await getDJProfile("pariah");
  const dorWandProfile = await getDJProfile("dor wand");
  const klsRdrProfile = await getDJProfile("copypastewklsrdr");

  console.log("[test-email] Pariah profile:", pariahProfile);
  console.log("[test-email] Dor Wand profile:", dorWandProfile);
  console.log("[test-email] KLS.RDR profile:", klsRdrProfile);

  // Generate dates for today + next 3 days to always produce a relevant timeline
  const now = new Date();
  const day = (offset: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  // Section 1: Favorite shows (spread across days 0, 1, 3)
  const sampleFavoriteShows = [
    {
      showName: "COPYPASTE w/ KLS.RDR",
      djName: "KLS.RDR",
      djUsername: klsRdrProfile?.username || "copypastewklsrdr",
      djPhotoUrl: klsRdrProfile?.photoUrl,
      stationName: "Subtle Radio",
      stationId: "subtle",
      startTime: day(0, 22), // Today at 10 PM
    },
    {
      showName: "Pariah presents Voam",
      djName: "pariah",
      djUsername: pariahProfile?.username,
      djPhotoUrl: pariahProfile?.photoUrl,
      stationName: "Rinse FM",
      stationId: "rinse",
      startTime: day(1, 19), // Tomorrow at 7 PM
    },
    {
      showName: "Dor Wand – Open Heart Social Club",
      djName: "dor wand",
      djUsername: dorWandProfile?.username,
      djPhotoUrl: dorWandProfile?.photoUrl,
      stationName: "dublab",
      stationId: "dublab",
      startTime: day(3, 16), // Day 3 at 4 PM
    },
    {
      showName: "DJ Heartbreak Live",
      djName: "DJ Heartbreak",
      stationName: "IRL Event",
      stationId: "irl",
      startTime: day(3, 21), // Day 3 at 9 PM
      isIRL: true as const,
      irlLocation: "Peckham, London",
      irlTicketUrl: "https://ra.co/events/example",
    },
  ];

  // Section 2: Curator recs (dateless, used to fill empty days)
  const sampleCuratorRecs = [
    {
      djName: "pariah",
      djUsername: pariahProfile?.username || "pariah",
      djPhotoUrl: pariahProfile?.photoUrl,
      url: "https://voam.bandcamp.com/album/new-release",
      type: "bandcamp" as const,
      ogTitle: "New Release - Voam",
      ogImage: undefined,
    },
    {
      djName: "Dor Wand",
      djUsername: dorWandProfile?.username || "dorwand",
      djPhotoUrl: dorWandProfile?.photoUrl,
      url: "https://ra.co/events/warehouse-party-berlin",
      type: "event" as const,
      ogTitle: "Warehouse Party - Berlin",
      ogImage: undefined,
    },
  ];

  // Section 3: Preference-matched shows
  const samplePreferenceShows = [
    {
      showName: "House Music Hour",
      djName: "DJ Example",
      stationName: "NTS 1",
      stationId: "nts1",
      startTime: day(2, 20), // Day 2 at 8 PM
      matchLabel: "LOS ANGELES + HOUSE",
    },
    {
      showName: "Deep Cuts w/ Selector",
      djName: "Selector",
      stationName: "Rinse FM",
      stationId: "rinse",
      startTime: day(1, 22), // Tomorrow at 10 PM (backup)
      matchLabel: "LOS ANGELES + TECHNO",
    },
  ];

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
