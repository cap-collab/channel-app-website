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

    // Get all pending notifications that should be sent now
    const pendingNotifications = await adminDb
      .collection("scheduledNotifications")
      .where("sent", "==", false)
      .where("notifyAt", "<=", now)
      .limit(100) // Process in batches
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
          // User deleted, mark notification as sent
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
