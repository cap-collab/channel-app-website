import { NextRequest, NextResponse } from "next/server";
import { getTokensFromCode, createChannelCalendar } from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state"); // This is the userId
    const error = searchParams.get("error");

    if (error) {
      // User cancelled or error occurred
      return NextResponse.redirect(
        new URL("/settings?calendar_error=cancelled", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/settings?calendar_error=missing_params", request.url)
      );
    }

    // Exchange code for tokens
    const { accessToken, refreshToken, expiresAt } =
      await getTokensFromCode(code);

    // Create or get Channel Shows calendar
    const calendarId = await createChannelCalendar(accessToken);

    // Redirect to a page that will store the tokens client-side
    // Pass tokens via URL fragment (not query params) for security - fragments aren't sent to server
    const redirectUrl = new URL("/settings", request.url);
    redirectUrl.hash = `calendar_data=${encodeURIComponent(
      JSON.stringify({
        userId: state,
        accessToken,
        refreshToken,
        expiresAt: expiresAt.toISOString(),
        calendarId,
      })
    )}`;

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("Error in Google callback:", error);
    return NextResponse.redirect(
      new URL("/settings?calendar_error=auth_failed", request.url)
    );
  }
}
