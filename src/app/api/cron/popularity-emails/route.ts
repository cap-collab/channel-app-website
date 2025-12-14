import { NextRequest, NextResponse } from "next/server";
import { sendPopularityAlertEmail } from "@/lib/email";
import {
  queryCollection,
  getUser,
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
    // Query pending popularity emails (sent = false)
    const pendingAlerts = await queryCollection("pendingPopularityEmails", [
      { field: "sent", op: "EQUAL", value: false },
    ]);

    let sentCount = 0;
    let errorCount = 0;

    for (const alert of pendingAlerts) {
      try {
        const userId = alert.data.userId as string;
        const userData = await getUser(userId);

        if (!userData) {
          // User not found - delete the pending alert
          await deleteDocument("pendingPopularityEmails", alert.id);
          continue;
        }

        // Check if user has popularity emails enabled
        const emailNotifications = userData.emailNotifications as Record<string, boolean> | undefined;
        if (!emailNotifications?.popularity) {
          // User disabled popularity emails - delete and skip
          await deleteDocument("pendingPopularityEmails", alert.id);
          continue;
        }

        const stationId = alert.data.stationId as string;
        const stationName = STATION_NAMES[stationId] || stationId;

        // Send email
        const success = await sendPopularityAlertEmail({
          to: userData.email as string,
          showName: alert.data.showName as string,
          stationName,
          stationId,
          loveCount: alert.data.loveCount as number,
        });

        if (success) {
          // Delete after successful send
          await deleteDocument("pendingPopularityEmails", alert.id);
          sentCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        console.error("Error processing popularity email:", alert.id, error);
        errorCount++;
      }
    }

    return NextResponse.json({
      processed: pendingAlerts.length,
      sent: sentCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error("Error in popularity-emails cron:", error);
    return NextResponse.json(
      { error: "Failed to process popularity emails" },
      { status: 500 }
    );
  }
}
