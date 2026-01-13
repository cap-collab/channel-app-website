import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  setScheduledNotification,
  getScheduledNotification,
  queryScheduledNotifications,
  updateDocument,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Metadata uses short keys: n=name, s=startTime, e=endTime, j=dj, t=type
interface MetadataShow {
  n: string;
  s: string;
  e: string;
  j?: string | null;
  t?: string | null; // type: weekly, monthly, restream, playlist
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

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRestApiConfigured()) {
    return NextResponse.json(
      { error: "Firebase REST API not configured" },
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
        { cache: "no-store" }
      );

      if (metadataResponse.ok) {
        const metadata: Metadata = await metadataResponse.json();

        // Find shows starting in the next 62 minutes (cron runs at :55, covers until next run at :55)
        // This ensures emails go out ~5 minutes BEFORE shows start, and each show is only caught once
        const windowStart = now;
        const windowEnd = new Date(now.getTime() + 62 * 60 * 1000);

        const upcomingShows: Array<{
          name: string;
          dj?: string;
          startTime: string;
          stationId: string;
          stationName: string;
        }> = [];

        for (const [stationKey, shows] of Object.entries(metadata.stations)) {
          if (Array.isArray(shows)) {
            for (const show of shows) {
              // Skip playlist shows - don't send notifications for automated playlists
              if (show.t === "playlist") continue;

              const showStart = new Date(show.s);
              if (showStart >= windowStart && showStart <= windowEnd) {
                upcomingShows.push({
                  name: show.n,
                  dj: show.j || undefined,
                  startTime: show.s,
                  stationId: stationKey,
                  stationName: STATION_NAMES[stationKey] || stationKey,
                });
              }
            }
          }
        }

        if (upcomingShows.length > 0) {
          // Get all users with show notifications enabled
          const users = await queryUsersWhere("emailNotifications.showStarting", "EQUAL", true);

          for (const user of users) {
            const userId = user.id;

            // Get user's favorited shows
            const favorites = await getUserFavorites(userId, "show");
            const favoritedTerms = favorites
              .map((f) => (f.data.term as string)?.toLowerCase())
              .filter(Boolean);

            if (favoritedTerms.length === 0) continue;

            // Check which upcoming shows match user's favorites
            for (const show of upcomingShows) {
              const showNameLower = show.name.toLowerCase();
              const djNameLower = show.dj?.toLowerCase();

              const isMatch = favoritedTerms.some(
                (term) => term === showNameLower || (djNameLower && term === djNameLower)
              );

              if (isMatch) {
                // Use deterministic document ID to prevent duplicates
                // Format: userId_stationId_showName_date
                const dateOnly = show.startTime.split("T")[0]; // "2026-01-10"
                const sanitizedShowName = show.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
                const docId = `${userId}_${show.stationId}_${sanitizedShowName}_${dateOnly}`;

                // setScheduledNotification won't overwrite if already sent=true
                const created = await setScheduledNotification(docId, {
                  userId,
                  showName: show.name,
                  djName: show.dj || null,
                  stationName: show.stationName,
                  stationId: show.stationId,
                  notifyAt: new Date(show.startTime),
                  sent: false,
                  createdAt: new Date(),
                });
                if (created) {
                  notificationsCreated++;
                }
              }
            }
          }
        }
      }
    } catch (scheduleError) {
      console.error("Error scanning schedule:", scheduleError);
    }

    // Step 2: Send pending notifications
    const pendingNotifications = await queryScheduledNotifications([
      { field: "sent", op: "EQUAL", value: false },
    ]);

    // Filter to only those where notifyAt <= now
    const readyToSend = pendingNotifications.filter((n) => {
      const notifyAt = n.data.notifyAt as Date | string;
      return new Date(notifyAt) <= now;
    });

    let sentCount = 0;
    let errorCount = 0;

    for (const notification of readyToSend) {
      try {
        const userData = await getUser(notification.data.userId as string);

        if (!userData) {
          await updateDocument("scheduledNotifications", notification.id, {
            sent: true,
            error: "user_not_found",
          });
          continue;
        }

        // Check if user has show notifications enabled
        const emailNotifications = userData.emailNotifications as Record<string, boolean> | undefined;
        if (!emailNotifications?.showStarting) {
          await updateDocument("scheduledNotifications", notification.id, {
            sent: true,
            skipped: true,
          });
          continue;
        }

        // Re-fetch the notification to check if it was already sent (race condition safeguard)
        // This is more reliable than the query-based approach since it uses the deterministic document ID
        const freshNotification = await getScheduledNotification(notification.id);
        if (freshNotification?.data.sent === true) {
          // Already sent by another cron run, skip
          continue;
        }

        // Send email
        const success = await sendShowStartingEmail({
          to: userData.email as string,
          showName: notification.data.showName as string,
          djName: notification.data.djName as string | undefined,
          stationName: notification.data.stationName as string,
          stationId: notification.data.stationId as string,
        });

        if (success) {
          await updateDocument("scheduledNotifications", notification.id, {
            sent: true,
            sentAt: new Date(),
          });
          sentCount++;
        } else {
          await updateDocument("scheduledNotifications", notification.id, {
            error: "send_failed",
          });
          errorCount++;
        }
      } catch (error) {
        console.error("Error processing notification:", notification.id, error);
        await updateDocument("scheduledNotifications", notification.id, {
          error: String(error),
        });
        errorCount++;
      }
    }

    return NextResponse.json({
      notificationsCreated,
      processed: readyToSend.length,
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
