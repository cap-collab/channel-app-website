import { NextRequest, NextResponse } from "next/server";
import { sendMentionEmail } from "@/lib/email";
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
    // Query pending mention emails (sent = false)
    const pendingMentions = await queryCollection("pendingMentionEmails", [
      { field: "sent", op: "EQUAL", value: false },
    ]);

    let sentCount = 0;
    let errorCount = 0;

    for (const mention of pendingMentions) {
      try {
        const userId = mention.data.userId as string;
        const userData = await getUser(userId);

        if (!userData) {
          // User not found - delete the pending mention
          await deleteDocument("pendingMentionEmails", mention.id);
          continue;
        }

        // Check if user has mention emails enabled
        const emailNotifications = userData.emailNotifications as Record<string, boolean> | undefined;
        if (!emailNotifications?.mentions) {
          // User disabled mention emails - delete and skip
          await deleteDocument("pendingMentionEmails", mention.id);
          continue;
        }

        const stationId = mention.data.stationId as string;
        const stationName = STATION_NAMES[stationId] || stationId;
        const mentionerUsername = mention.data.mentionerUsername as string;

        // Try to look up DJ profile for the mentioner
        // If they have a profile, link to their chat page
        const djProfile = await getDJProfile(mentionerUsername);

        // Send email
        const success = await sendMentionEmail({
          to: userData.email as string,
          mentionerUsername,
          stationName,
          stationId,
          djUsername: djProfile?.username,
          messagePreview: mention.data.messagePreview as string | undefined,
        });

        if (success) {
          // Delete after successful send (don't need to keep)
          await deleteDocument("pendingMentionEmails", mention.id);
          sentCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        console.error("Error processing mention email:", mention.id, error);
        errorCount++;
      }
    }

    return NextResponse.json({
      processed: pendingMentions.length,
      sent: sentCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error("Error in mention-emails cron:", error);
    return NextResponse.json(
      { error: "Failed to process mention emails" },
      { status: 500 }
    );
  }
}
