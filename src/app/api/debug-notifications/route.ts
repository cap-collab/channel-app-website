import { NextResponse } from "next/server";
import {
  queryUsersWhere,
  getUserFavorites,
  queryScheduledNotifications,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Debug endpoint to check notification setup
export async function GET() {
  if (!isRestApiConfigured()) {
    return NextResponse.json({
      error: "Firebase REST API not configured",
      hint: "Set CRON_SERVICE_EMAIL and CRON_SERVICE_PASSWORD in Vercel environment variables",
    }, { status: 500 });
  }

  try {
    // 1. Check users with notifications enabled
    const usersWithNotifications = await queryUsersWhere(
      "emailNotifications.showStarting",
      "EQUAL",
      true
    );

    const usersData = [];
    for (const user of usersWithNotifications.slice(0, 5)) { // Limit to 5 users
      const favorites = await getUserFavorites(user.id);
      usersData.push({
        id: user.id,
        email: user.data.email,
        emailNotifications: user.data.emailNotifications,
        favoritesCount: favorites.length,
        favorites: favorites.slice(0, 10).map(f => ({
          id: f.id,
          term: f.data.term,
          type: f.data.type,
        })),
      });
    }

    // 2. Check scheduled notifications
    const scheduledNotifications = await queryScheduledNotifications([
      { field: "sent", op: "EQUAL", value: false },
    ]);

    // 3. Check current shows in the window
    const now = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);

    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { cache: "no-store" }
    );
    const metadata = await metadataResponse.json();

    const showsInWindow: Array<{
      station: string;
      name: string;
      dj?: string;
      startTime: string;
    }> = [];

    for (const [stationKey, shows] of Object.entries(
      metadata.stations as Record<string, Array<{ n: string; s: string; j?: string }>>
    )) {
      for (const show of shows) {
        const showStart = new Date(show.s);
        if (showStart >= windowStart && showStart <= windowEnd) {
          showsInWindow.push({
            station: stationKey,
            name: show.n,
            dj: show.j || undefined,
            startTime: show.s,
          });
        }
      }
    }

    return NextResponse.json({
      status: "ok",
      currentTime: now.toISOString(),
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      usersWithNotificationsEnabled: usersData,
      pendingNotifications: scheduledNotifications.slice(0, 20).map(n => ({
        id: n.id,
        ...n.data,
      })),
      showsCurrentlyInWindow: showsInWindow,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
