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

async function sendTestEmail(to: string) {
  // Look up real DJ profiles - only set username if profile exists
  const pariahProfile = await getDJProfile("pariah");
  const dorWandProfile = await getDJProfile("dor wand");
  const klsRdrProfile = await getDJProfile("copypastewklsrdr");

  console.log("[test-email] Pariah profile:", pariahProfile);
  console.log("[test-email] Dor Wand profile:", dorWandProfile);
  console.log("[test-email] KLS.RDR profile:", klsRdrProfile);

  // Sample data matching the original email from Feb 4
  const sampleMatches = [
    {
      showName: "COPYPASTE w/ KLS.RDR",
      djName: "KLS.RDR",
      djUsername: klsRdrProfile?.username || "copypastewklsrdr",
      djPhotoUrl: klsRdrProfile?.photoUrl,
      stationName: "Subtle Radio",
      stationId: "subtle",
      startTime: new Date("2026-02-08T04:00:00Z"),
      searchTerm: "copypaste",
      isIRL: false,
    },
    {
      showName: "Pariah presents Voam",
      djName: "pariah",
      djUsername: pariahProfile?.username, // Only set if profile exists
      djPhotoUrl: pariahProfile?.photoUrl,
      stationName: "Rinse FM",
      stationId: "rinse",
      startTime: new Date("2026-02-05T22:00:00Z"), // Thu, Feb 5 at 10:00 PM UTC
      searchTerm: "pariah",
      isIRL: false,
    },
    {
      showName: "Dor Wand – Open Heart Social Club",
      djName: "dor wand",
      djUsername: dorWandProfile?.username, // Only set if profile exists
      djPhotoUrl: dorWandProfile?.photoUrl,
      stationName: "dublab",
      stationId: "dublab",
      startTime: new Date("2026-02-07T00:00:00Z"), // Feb 7 midnight UTC = Feb 6 4pm PST
      searchTerm: "dor wand",
      isIRL: false,
    },
  ];

  try {
    const success = await sendWatchlistDigestEmail({
      to,
      userTimezone: "America/Los_Angeles", // Test with Pacific timezone
      matches: sampleMatches,
    });

    if (success) {
      return NextResponse.json({
        success: true,
        message: `Test email sent to ${to}`,
        matchCount: sampleMatches.length,
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

// Test endpoint to preview the new watchlist digest email template
// Only works with a secret to prevent abuse
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";
  return sendTestEmail(to);
}

export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";
  return sendTestEmail(to);
}
