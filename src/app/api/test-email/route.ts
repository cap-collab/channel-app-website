import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";

// Test endpoint to preview the new watchlist digest email template
// Only works with a secret to prevent abuse
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = request.nextUrl.searchParams.get("to") || "cap@channel-app.com";

  // Sample data matching real watchlist digest format
  const sampleMatches = [
    {
      showName: "Snack Time",
      djName: "dj cap",
      djUsername: "djcap",
      djPhotoUrl: undefined,
      stationName: "Channel Broadcast",
      stationId: "broadcast",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      searchTerm: "dj cap",
      isIRL: false,
    },
    {
      showName: "Dor Wand – Open Heart Social Club",
      djName: "dor wand",
      djUsername: "dorwand",
      djPhotoUrl: undefined,
      stationName: "dublab",
      stationId: "dublab",
      startTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
      searchTerm: "dor wand",
      isIRL: false,
    },
    {
      showName: "Skee Mask Live at Berghain",
      djName: "Skee Mask",
      djUsername: undefined, // No profile - will show fallback
      djPhotoUrl: undefined,
      stationName: "IRL Event",
      stationId: "irl",
      startTime: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks
      searchTerm: "skee mask",
      isIRL: true,
      irlLocation: "Berlin",
      irlTicketUrl: "https://ra.co/events/example",
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
