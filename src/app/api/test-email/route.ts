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
  const djCapProfile = await getDJProfile("dj cap");
  const dorWandProfile = await getDJProfile("dor wand");

  console.log("[test-email] DJ Cap profile:", djCapProfile);
  console.log("[test-email] Dor Wand profile:", dorWandProfile);

  // Sample data matching the original email from Feb 1
  const sampleMatches = [
    {
      showName: "Snack Time",
      djName: "dj cap",
      djUsername: djCapProfile?.username, // Only set if profile exists
      djPhotoUrl: djCapProfile?.photoUrl,
      stationName: "Channel Broadcast",
      stationId: "broadcast",
      startTime: new Date("2026-02-02T16:00:00"), // Mon, Feb 2 at 4:00 PM
      searchTerm: "dj cap",
      isIRL: false,
    },
    {
      showName: "Dor Wand – Open Heart Social Club",
      djName: "dor wand",
      djUsername: dorWandProfile?.username, // Only set if profile exists
      djPhotoUrl: dorWandProfile?.photoUrl,
      stationName: "dublab",
      stationId: "dublab",
      startTime: new Date("2026-02-07T00:00:00"), // Sat, Feb 7 at 12:00 AM
      searchTerm: "dor wand",
      isIRL: false,
    },
  ];

  try {
    const success = await sendWatchlistDigestEmail({
      to,
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
