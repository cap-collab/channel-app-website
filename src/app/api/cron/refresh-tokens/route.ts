import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { refreshAccessToken } from "@/lib/google-calendar";
import { Timestamp } from "firebase-admin/firestore";

// Verify cron secret for security
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

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
    // Find users with tokens expiring in the next 30 minutes
    const expiryThreshold = new Date(Date.now() + 30 * 60 * 1000);

    const usersSnapshot = await adminDb
      .collection("users")
      .where("googleCalendar.expiresAt", "<=", Timestamp.fromDate(expiryThreshold))
      .limit(50)
      .get();

    let refreshedCount = 0;
    let errorCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const calendarData = userData.googleCalendar;

      if (!calendarData?.refreshToken) {
        continue;
      }

      try {
        const { accessToken, expiresAt } = await refreshAccessToken(
          calendarData.refreshToken
        );

        await userDoc.ref.update({
          "googleCalendar.accessToken": accessToken,
          "googleCalendar.expiresAt": expiresAt,
        });

        refreshedCount++;
      } catch (error) {
        console.error("Error refreshing token for user:", userDoc.id, error);
        errorCount++;

        // If refresh fails (e.g., user revoked access), remove calendar data
        if (String(error).includes("invalid_grant")) {
          await userDoc.ref.update({
            googleCalendar: null,
          });
        }
      }
    }

    return NextResponse.json({
      processed: usersSnapshot.size,
      refreshed: refreshedCount,
      errors: errorCount,
    });
  } catch (error) {
    console.error("Error in refresh-tokens cron:", error);
    return NextResponse.json(
      { error: "Failed to refresh tokens" },
      { status: 500 }
    );
  }
}
