import { NextRequest, NextResponse } from "next/server";
import { getTokensFromCode, createChannelCalendar } from "@/lib/google-calendar";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state"); // This is the userId
    const error = searchParams.get("error");

    if (error) {
      // User cancelled or error occurred
      return NextResponse.redirect(
        new URL("/djshows?calendar_error=cancelled", request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/djshows?calendar_error=missing_params", request.url)
      );
    }

    const adminDb = getAdminDb();
    if (!adminDb) {
      return NextResponse.redirect(
        new URL("/djshows?calendar_error=server_error", request.url)
      );
    }

    // Exchange code for tokens
    const { accessToken, refreshToken, expiresAt } =
      await getTokensFromCode(code);

    // Create or get Channel Shows calendar
    const calendarId = await createChannelCalendar(accessToken);

    // Store tokens in Firestore (in production, encrypt these)
    const userRef = adminDb.collection("users").doc(state);
    await userRef.set(
      {
        googleCalendar: {
          accessToken, // TODO: Encrypt in production
          refreshToken, // TODO: Encrypt in production
          expiresAt,
          calendarId,
          connectedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    // Redirect back to the app
    return NextResponse.redirect(
      new URL("/djshows?calendar_connected=true", request.url)
    );
  } catch (error) {
    console.error("Error in Google callback:", error);
    return NextResponse.redirect(
      new URL("/djshows?calendar_error=auth_failed", request.url)
    );
  }
}
