import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";

// Sample data matching the original email from Feb 1
const sampleMatches = [
  {
    showName: "Snack Time",
    djName: "dj cap",
    djUsername: "djcap",
    djPhotoUrl: undefined,
    stationName: "Channel Broadcast",
    stationId: "broadcast",
    startTime: new Date("2026-02-02T16:00:00"), // Mon, Feb 2 at 4:00 PM
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
    startTime: new Date("2026-02-07T00:00:00"), // Sat, Feb 7 at 12:00 AM
    searchTerm: "dor wand",
    isIRL: false,
  },
];

async function sendTestEmail(to: string) {
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
