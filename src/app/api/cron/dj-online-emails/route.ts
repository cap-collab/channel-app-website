import { NextRequest, NextResponse } from "next/server";
import { sendDjOnlineEmail } from "@/lib/email";
import {
  queryCollection,
  getUser,
  updateUser,
  deleteDocument,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

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
    // Query pending DJ online emails (sent = false)
    const pendingEmails = await queryCollection("pendingDjOnlineEmails", [
      { field: "sent", op: "EQUAL", value: false },
    ]);

    console.log(`[dj-online-emails] Found ${pendingEmails.length} pending emails`);

    let sentCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    for (const pending of pendingEmails) {
      try {
        const userId = pending.data.recipientUserId as string;
        const djUsername = pending.data.djUsername as string;
        const chatUsernameNormalized = pending.data.chatUsernameNormalized as string;

        const userData = await getUser(userId);

        if (!userData) {
          // User not found - delete the pending notification
          await deleteDocument("pendingDjOnlineEmails", pending.id);
          continue;
        }

        // Check if user still has djOnline emails enabled
        const emailNotifications = userData.emailNotifications as
          | Record<string, boolean>
          | undefined;
        if (!emailNotifications?.djOnline) {
          // User disabled djOnline emails - delete and skip
          await deleteDocument("pendingDjOnlineEmails", pending.id);
          skippedCount++;
          continue;
        }

        // Double-check rate limit - has user been emailed about this DJ in last 24h?
        const lastDjOnlineEmailAt = userData.lastDjOnlineEmailAt as
          | Record<string, number>
          | undefined;
        const lastEmailTime = lastDjOnlineEmailAt?.[chatUsernameNormalized] || 0;

        if (lastEmailTime > oneDayAgo) {
          // Already emailed recently - delete and skip
          await deleteDocument("pendingDjOnlineEmails", pending.id);
          skippedCount++;
          continue;
        }

        // Send email
        const success = await sendDjOnlineEmail({
          to: userData.email as string,
          djUsername,
          djProfileUrl: `https://channel-app.com/dj/${chatUsernameNormalized}`,
        });

        if (success) {
          // Update user's lastDjOnlineEmailAt timestamp for this DJ
          const updatedLastDjOnlineEmailAt = {
            ...(lastDjOnlineEmailAt || {}),
            [chatUsernameNormalized]: now,
          };
          await updateUser(userId, {
            lastDjOnlineEmailAt: updatedLastDjOnlineEmailAt,
          });

          // Delete the pending notification
          await deleteDocument("pendingDjOnlineEmails", pending.id);
          sentCount++;
          console.log(`[dj-online-emails] Sent email to user ${userId} about ${djUsername}`);
        } else {
          errorCount++;
        }
      } catch (error) {
        console.error("[dj-online-emails] Error processing:", pending.id, error);
        errorCount++;
      }
    }

    console.log(
      `[dj-online-emails] Done: ${sentCount} sent, ${skippedCount} skipped, ${errorCount} errors`
    );

    return NextResponse.json({
      processed: pendingEmails.length,
      sent: sentCount,
      skipped: skippedCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error("[dj-online-emails] Error in cron:", error);
    return NextResponse.json(
      { error: "Failed to process DJ online emails" },
      { status: 500 }
    );
  }
}
