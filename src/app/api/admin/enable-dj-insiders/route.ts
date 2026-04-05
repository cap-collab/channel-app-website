import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// One-time migration:
// 1. Opt all DJ users into djInsiders marketing emails
// 2. Opt all users into watchlistMatch (listener marketing) unless they explicitly turned it off
// Usage: GET /api/admin/enable-dj-insiders?secret=CRON_SECRET
// Add &dryRun=true to preview without making changes
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    // --- DJ Insiders: all users with role=dj ---
    const djSnap = await db.collection("users").where("role", "==", "dj").get();

    let djUpdated = 0;
    let djSkipped = 0;
    const djResults: Array<{ id: string; email?: string; action: string }> = [];

    for (const doc of djSnap.docs) {
      const data = doc.data();
      const notifs = data.emailNotifications;

      if (notifs?.djInsiders === true) {
        djSkipped++;
        djResults.push({ id: doc.id, email: data.email, action: "already_enabled" });
        continue;
      }

      if (!dryRun) {
        await doc.ref.update({ "emailNotifications.djInsiders": true });
      }

      djUpdated++;
      djResults.push({ id: doc.id, email: data.email, action: dryRun ? "would_enable" : "enabled" });
    }

    // --- Listener marketing: all users, enable watchlistMatch unless explicitly false ---
    const allSnap = await db.collection("users").get();

    let listenerUpdated = 0;
    let listenerSkipped = 0;
    const listenerResults: Array<{ id: string; email?: string; action: string }> = [];

    for (const doc of allSnap.docs) {
      const data = doc.data();
      const notifs = data.emailNotifications;

      if (notifs?.watchlistMatch === true) {
        listenerSkipped++;
        listenerResults.push({ id: doc.id, email: data.email, action: "already_enabled" });
        continue;
      }

      if (notifs?.watchlistMatch === false) {
        listenerSkipped++;
        listenerResults.push({ id: doc.id, email: data.email, action: "explicitly_off" });
        continue;
      }

      if (!dryRun) {
        await doc.ref.update({ "emailNotifications.watchlistMatch": true });
      }

      listenerUpdated++;
      listenerResults.push({ id: doc.id, email: data.email, action: dryRun ? "would_enable" : "enabled" });
    }

    return NextResponse.json({
      dryRun,
      djInsiders: {
        totalDJs: djSnap.docs.length,
        updated: djUpdated,
        skipped: djSkipped,
        results: djResults,
      },
      listenerMarketing: {
        totalUsers: allSnap.docs.length,
        updated: listenerUpdated,
        skipped: listenerSkipped,
        results: listenerResults,
      },
    });
  } catch (error) {
    console.error("Error in email preferences migration:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
