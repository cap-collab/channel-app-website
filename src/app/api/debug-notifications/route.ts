import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Debug endpoint to check notification setup - remove in production
export async function GET() {
  const adminDb = getAdminDb();
  if (!adminDb) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    // 1. Check users with notifications enabled
    const usersSnapshot = await adminDb
      .collection("users")
      .where("emailNotifications.showStarting", "==", true)
      .get();

    const usersWithNotifications = [];

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();

      // Get their favorites
      const favoritesSnapshot = await adminDb
        .collection("users")
        .doc(userDoc.id)
        .collection("favorites")
        .get();

      const favorites = favoritesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      usersWithNotifications.push({
        id: userDoc.id,
        email: userData.email,
        emailNotifications: userData.emailNotifications,
        favoritesCount: favorites.length,
        favorites: favorites.slice(0, 10), // First 10
      });
    }

    // 2. Check scheduled notifications
    const notificationsSnapshot = await adminDb
      .collection("scheduledNotifications")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const scheduledNotifications = notificationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      notifyAt: doc.data().notifyAt?.toDate?.()?.toISOString(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
      sentAt: doc.data().sentAt?.toDate?.()?.toISOString(),
    }));

    // 3. Check current shows in the window
    const now = new Date();
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);

    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { cache: "no-store" }
    );
    const metadata = await metadataResponse.json();

    const showsInWindow = [];
    for (const [stationKey, shows] of Object.entries(metadata.stations as Record<string, Array<{n: string; s: string; j?: string}>>)) {
      for (const show of shows) {
        const showStart = new Date(show.s);
        if (showStart >= windowStart && showStart <= windowEnd) {
          showsInWindow.push({
            station: stationKey,
            name: show.n,
            dj: show.j,
            startTime: show.s,
          });
        }
      }
    }

    return NextResponse.json({
      currentTime: now.toISOString(),
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      usersWithNotificationsEnabled: usersWithNotifications,
      scheduledNotifications,
      showsCurrentlyInWindow: showsInWindow,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
