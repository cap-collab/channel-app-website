import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import { queryUsersWhere } from "@/lib/firebase-rest";

// Look up DJ profile info from Firebase (username + photo)
// Uses the same normalization as everywhere else in the app
async function getDJProfile(searchTerm: string): Promise<{ username: string; photoUrl?: string } | null> {
  try {
    const djUsers = await queryUsersWhere("role", "EQUAL", "dj");
    const normalized = searchTerm.replace(/[\s-]+/g, "").toLowerCase();

    for (const djUser of djUsers) {
      const chatUsername = djUser.data.chatUsername as string | undefined;
      const chatUsernameNormalized = djUser.data.chatUsernameNormalized as string | undefined;
      const displayName = djUser.data.displayName as string | undefined;
      const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;

      // Match against:
      // 1. chatUsernameNormalized from DB (authoritative)
      // 2. displayName normalized
      // 3. chatUsername normalized
      const djNormalized = chatUsername?.replace(/[\s-]+/g, "").toLowerCase();
      const displayNormalized = displayName?.replace(/[\s-]+/g, "").toLowerCase();

      if (
        chatUsernameNormalized === normalized ||
        djNormalized === normalized ||
        displayNormalized === normalized
      ) {
        console.log(`[getDJProfile] Found match for "${searchTerm}":`, {
          chatUsername,
          chatUsernameNormalized,
          displayName,
          photoUrl: djProfile?.photoUrl,
        });
        return {
          username: chatUsername || normalized,
          photoUrl: djProfile?.photoUrl as string | undefined,
        };
      }
    }
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
