import { NextRequest, NextResponse } from "next/server";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  createDocument,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

interface DjOnlineRequest {
  djUsername: string;
  chatUsernameNormalized: string;
}

/**
 * POST /api/notifications/dj-online
 *
 * Called when a DJ posts a message in their own chat.
 * Queues email notifications for users who follow this DJ (have them in their watchlist).
 * Rate limited to once per day per DJ per follower.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isRestApiConfigured()) {
      console.log("[dj-online] Firebase REST API not configured, skipping");
      return NextResponse.json({ success: true, skipped: true });
    }

    const body: DjOnlineRequest = await request.json();
    const { djUsername, chatUsernameNormalized } = body;

    if (!djUsername || !chatUsernameNormalized) {
      return NextResponse.json(
        { error: "Missing required fields: djUsername, chatUsernameNormalized" },
        { status: 400 }
      );
    }

    console.log(`[dj-online] DJ ${djUsername} is active in chat`);

    // Normalize DJ username for matching
    const normalizedDjUsername = djUsername.replace(/[\s-]+/g, "").toLowerCase();
    const djUsernameLower = djUsername.toLowerCase();

    // Get all users with djOnline notifications enabled
    const usersWithDjOnline = await queryUsersWhere(
      "emailNotifications.djOnline",
      "EQUAL",
      true
    );

    console.log(`[dj-online] Found ${usersWithDjOnline.length} users with djOnline enabled`);

    let notificationsQueued = 0;
    let skippedRateLimit = 0;
    let skippedNotFollowing = 0;

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    for (const user of usersWithDjOnline) {
      try {
        // Check if user follows this DJ (has them in watchlist)
        const watchlist = await getUserFavorites(user.id, "search");

        if (watchlist.length === 0) {
          skippedNotFollowing++;
          continue;
        }

        const followsDJ = watchlist.some((w) => {
          const term = ((w.data.term as string) || "").toLowerCase();
          const normalizedTerm = term.replace(/[\s-]+/g, "");

          // Match by normalized username
          if (normalizedTerm === normalizedDjUsername) return true;

          // Match by DJ username (contains)
          if (djUsernameLower.includes(term) || term.includes(djUsernameLower))
            return true;

          return false;
        });

        if (!followsDJ) {
          skippedNotFollowing++;
          continue;
        }

        // Check rate limit - has user been emailed about this DJ in last 24h?
        const userData = await getUser(user.id);
        const lastDjOnlineEmailAt = userData?.lastDjOnlineEmailAt as
          | Record<string, number>
          | undefined;
        const lastEmailTime = lastDjOnlineEmailAt?.[chatUsernameNormalized] || 0;

        if (lastEmailTime > oneDayAgo) {
          skippedRateLimit++;
          continue;
        }

        // Queue the notification
        const notificationId = await createDocument("pendingDjOnlineEmails", {
          recipientUserId: user.id,
          djUsername,
          chatUsernameNormalized,
          createdAt: new Date(),
          sent: false,
        });

        if (notificationId) {
          notificationsQueued++;
          console.log(
            `[dj-online] Queued notification for user ${user.id}: ${notificationId}`
          );
        }
      } catch (error) {
        console.error(`[dj-online] Error processing user ${user.id}:`, error);
      }
    }

    console.log(
      `[dj-online] Done: ${notificationsQueued} queued, ${skippedRateLimit} rate limited, ${skippedNotFollowing} not following`
    );

    return NextResponse.json({
      success: true,
      notificationsQueued,
      skippedRateLimit,
      skippedNotFollowing,
    });
  } catch (error) {
    console.error("[dj-online] Error:", error);
    return NextResponse.json(
      { error: "Failed to process DJ online notification" },
      { status: 500 }
    );
  }
}
