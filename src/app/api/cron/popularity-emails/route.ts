import { NextRequest, NextResponse } from "next/server";
import { sendPopularityAlertEmail } from "@/lib/email";
import {
  queryCollection,
  queryUsersWhere,
  getUser,
  deleteDocument,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Normalize a name for DJ profile lookup (same as chatUsernameNormalized in DB)
function normalizeUsername(name: string): string {
  return name.replace(/[\s-]+/g, "").toLowerCase();
}

// Look up DJ profile by name - checks pending-dj-profiles first, then users
async function getDJProfile(searchTerm: string): Promise<{ username: string } | null> {
  try {
    const normalized = normalizeUsername(searchTerm);

    // 1. Check pending-dj-profiles FIRST
    const pendingProfiles = await queryCollection(
      "pending-dj-profiles",
      [{ field: "chatUsernameNormalized", op: "EQUAL", value: normalized }],
      1
    );

    if (pendingProfiles.length > 0) {
      const data = pendingProfiles[0].data;
      const chatUsername = data.chatUsername as string | undefined;
      if (chatUsername) {
        return { username: chatUsername };
      }
    }

    // 2. Fall back to users collection (approved DJs)
    const users = await queryUsersWhere("chatUsernameNormalized", "EQUAL", normalized);
    for (const user of users) {
      const role = user.data.role as string | undefined;
      if (role === "dj" || role === "broadcaster" || role === "admin") {
        const chatUsername = user.data.chatUsername as string | undefined;
        if (chatUsername) {
          return { username: chatUsername };
        }
      }
    }
  } catch (error) {
    console.error("Error looking up DJ profile:", error);
  }
  return null;
}

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
        const showName = alert.data.showName as string;

        // Try to look up DJ profile from show name
        // If they have a profile, link to their chat page
        const djProfile = await getDJProfile(showName);

        // Send email
        const success = await sendPopularityAlertEmail({
          to: userData.email as string,
          showName,
          stationName,
          stationId,
          djUsername: djProfile?.username,
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
