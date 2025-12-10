import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendShowStartingEmail } from "@/lib/email";
import { FieldValue } from "firebase-admin/firestore";

// Verify cron secret for security
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

// Metadata uses short keys: n=name, s=startTime, e=endTime, j=dj, d=description
interface MetadataShow {
  n: string;      // name
  s: string;      // startTime (ISO string)
  e: string;      // endTime (ISO string)
  j?: string | null;  // dj name
  d?: string | null;  // description
  u?: string | null;  // episode url
}

interface Metadata {
  v: number;
  updated: string;
  stations: {
    [stationKey: string]: MetadataShow[];
  };
}

const STATION_NAMES: Record<string, string> = {
  nts1: "NTS 1",
  nts2: "NTS 2",
  rinse: "Rinse FM",
  rinsefr: "Rinse FR",
  dublab: "dublab",
  subtle: "Subtle Radio",
};

const STATION_URLS: Record<string, string> = {
  nts1: "https://www.nts.live/1",
  nts2: "https://www.nts.live/2",
  rinse: "https://rinse.fm/player",
  rinsefr: "https://rinse.fm/player",
  dublab: "https://dublab.com/listen",
  subtle: "https://subtleradio.com",
};

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminDb = getAdminDb();
  if (!adminDb) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  try {
    const now = new Date();
    let notificationsCreated = 0;

    // Step 1: Scan schedule and create notifications for shows starting soon
    try {
      const metadataResponse = await fetch(
        "https://cap-collab.github.io/channel-metadata/metadata.json",
        { next: { revalidate: 0 } }
      );

      if (metadataResponse.ok) {
        const metadata: Metadata = await metadataResponse.json();

        // Find shows that started in the last 5 minutes (to catch shows starting NOW)
        const windowStart = new Date(now.getTime() - 5 * 60 * 1000);
        const windowEnd = new Date(now.getTime() + 5 * 60 * 1000);

        const upcomingShows: Array<{ name: string; dj?: string; startTime: string; stationId: string; stationName: string; stationUrl: string }> = [];
        for (const [stationKey, shows] of Object.entries(metadata.stations)) {
          if (Array.isArray(shows)) {
            for (const show of shows) {
              const showStart = new Date(show.s);
              if (showStart >= windowStart && showStart <= windowEnd) {
                upcomingShows.push({
                  name: show.n,
                  dj: show.j || undefined,
                  startTime: show.s,
                  stationId: stationKey,
                  stationName: STATION_NAMES[stationKey] || stationKey,
                  stationUrl: STATION_URLS[stationKey] || `${process.env.NEXT_PUBLIC_APP_URL}/djshows`,
                });
              }
            }
          }
        }

        if (upcomingShows.length > 0) {
          // Get all users with show notifications enabled
          const usersSnapshot = await adminDb
            .collection("users")
            .where("emailNotifications.showStarting", "==", true)
            .get();

          for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;

            // Get user's favorited shows
            const favoritesSnapshot = await adminDb
              .collection("users")
              .doc(userId)
              .collection("favorites")
              .where("type", "==", "show")
              .get();

            const favoritedTerms = favoritesSnapshot.docs.map(
              (doc) => doc.data().term?.toLowerCase()
            ).filter(Boolean);

            if (favoritedTerms.length === 0) continue;

            // Check which upcoming shows match user's favorites
            for (const show of upcomingShows) {
              const showNameLower = show.name.toLowerCase();
              const djNameLower = show.dj?.toLowerCase();

              const isMatch = favoritedTerms.some(
                (term) => term === showNameLower || (djNameLower && term === djNameLower)
              );

              if (isMatch) {
                // Check if notification already exists for this user/show/time
                const existingNotification = await adminDb
                  .collection("scheduledNotifications")
                  .where("userId", "==", userId)
                  .where("showName", "==", show.name)
                  .where("notifyAt", "==", new Date(show.startTime))
                  .limit(1)
                  .get();

                if (existingNotification.empty) {
                  await adminDb.collection("scheduledNotifications").add({
                    userId,
                    showName: show.name,
                    djName: show.dj || null,
                    stationName: show.stationName,
                    stationUrl: show.stationUrl,
                    notifyAt: new Date(show.startTime),
                    sent: false,
                    createdAt: FieldValue.serverTimestamp(),
                  });
                  notificationsCreated++;
                }
              }
            }
          }
        }
      }
    } catch (scheduleError) {
      console.error("Error scanning schedule:", scheduleError);
      // Continue to process existing notifications even if schedule scan fails
    }

    // Step 2: Send pending notifications
    const pendingNotifications = await adminDb
      .collection("scheduledNotifications")
      .where("sent", "==", false)
      .where("notifyAt", "<=", now)
      .limit(100)
      .get();

    let sentCount = 0;
    let errorCount = 0;

    for (const doc of pendingNotifications.docs) {
      const notification = doc.data();

      try {
        // Get user data
        const userDoc = await adminDb
          .collection("users")
          .doc(notification.userId)
          .get();
        const userData = userDoc.data();

        if (!userData) {
          await doc.ref.update({ sent: true, error: "user_not_found" });
          continue;
        }

        // Check if user has show notifications enabled
        if (!userData.emailNotifications?.showStarting) {
          await doc.ref.update({ sent: true, skipped: true });
          continue;
        }

        // Send email
        const success = await sendShowStartingEmail({
          to: userData.email,
          showName: notification.showName,
          djName: notification.djName,
          stationName: notification.stationName,
          listenUrl: notification.stationUrl || `${process.env.NEXT_PUBLIC_APP_URL}/djshows`,
        });

        if (success) {
          await doc.ref.update({
            sent: true,
            sentAt: FieldValue.serverTimestamp(),
          });
          sentCount++;
        } else {
          await doc.ref.update({ error: "send_failed", retryCount: FieldValue.increment(1) });
          errorCount++;
        }
      } catch (error) {
        console.error("Error processing notification:", doc.id, error);
        await doc.ref.update({ error: String(error) });
        errorCount++;
      }
    }

    return NextResponse.json({
      notificationsCreated,
      processed: pendingNotifications.size,
      sent: sentCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error("Error in show-reminders cron:", error);
    return NextResponse.json(
      { error: "Failed to process notifications" },
      { status: 500 }
    );
  }
}
