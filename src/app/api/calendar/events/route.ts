import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  addShowToCalendar,
  removeShowFromCalendar,
  refreshAccessToken,
  ShowEvent,
} from "@/lib/google-calendar";

async function getValidAccessToken(
  userId: string
): Promise<{ accessToken: string; calendarId: string } | null> {
  const adminDb = getAdminDb();
  if (!adminDb) return null;

  const userDoc = await adminDb.collection("users").doc(userId).get();
  const userData = userDoc.data();

  if (!userData?.googleCalendar) {
    return null;
  }

  const { accessToken, refreshToken, expiresAt, calendarId } =
    userData.googleCalendar;

  // Check if token is expired (with 5 minute buffer)
  const isExpired = new Date(expiresAt.toDate()) < new Date(Date.now() + 300000);

  if (isExpired && refreshToken) {
    try {
      const { accessToken: newToken, expiresAt: newExpiry } =
        await refreshAccessToken(refreshToken);

      // Update stored token
      await adminDb
        .collection("users")
        .doc(userId)
        .update({
          "googleCalendar.accessToken": newToken,
          "googleCalendar.expiresAt": newExpiry,
        });

      return { accessToken: newToken, calendarId };
    } catch (error) {
      console.error("Error refreshing token:", error);
      return null;
    }
  }

  return { accessToken, calendarId };
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const adminAuth = getAdminAuth();

    if (!adminAuth) {
      return NextResponse.json(
        { error: "Server not configured" },
        { status: 500 }
      );
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const body = await request.json();
    const show: ShowEvent = body.show;

    if (!show) {
      return NextResponse.json({ error: "Show data required" }, { status: 400 });
    }

    const tokens = await getValidAccessToken(userId);
    if (!tokens) {
      return NextResponse.json(
        { error: "Calendar not connected" },
        { status: 400 }
      );
    }

    const eventId = await addShowToCalendar(
      tokens.accessToken,
      tokens.calendarId,
      {
        ...show,
        startTime: new Date(show.startTime),
        endTime: new Date(show.endTime),
      }
    );

    return NextResponse.json({ eventId });
  } catch (error) {
    console.error("Error adding show to calendar:", error);
    return NextResponse.json(
      { error: "Failed to add show to calendar" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const adminAuth = getAdminAuth();

    if (!adminAuth) {
      return NextResponse.json(
        { error: "Server not configured" },
        { status: 500 }
      );
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const { searchParams } = new URL(request.url);
    const showId = searchParams.get("showId");

    if (!showId) {
      return NextResponse.json({ error: "Show ID required" }, { status: 400 });
    }

    const tokens = await getValidAccessToken(userId);
    if (!tokens) {
      return NextResponse.json(
        { error: "Calendar not connected" },
        { status: 400 }
      );
    }

    await removeShowFromCalendar(tokens.accessToken, tokens.calendarId, showId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing show from calendar:", error);
    return NextResponse.json(
      { error: "Failed to remove show from calendar" },
      { status: 500 }
    );
  }
}
