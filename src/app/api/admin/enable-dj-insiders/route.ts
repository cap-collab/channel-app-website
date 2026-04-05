import { NextRequest, NextResponse } from "next/server";
import { queryUsersWhere, queryCollection, updateUser } from "@/lib/firebase-rest";

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

  try {
    // --- DJ Insiders: all users with role=dj ---
    const djUsers = await queryUsersWhere("role", "EQUAL", "dj");

    let djUpdated = 0;
    let djSkipped = 0;
    const djResults: Array<{ id: string; email?: string; action: string }> = [];

    for (const user of djUsers) {
      const data = user.data;
      const notifs = data.emailNotifications as Record<string, unknown> | undefined;

      if (notifs?.djInsiders === true) {
        djSkipped++;
        djResults.push({ id: user.id, email: data.email as string, action: "already_enabled" });
        continue;
      }

      if (!dryRun) {
        await updateUser(user.id, { "emailNotifications.djInsiders": true });
      }

      djUpdated++;
      djResults.push({ id: user.id, email: data.email as string, action: dryRun ? "would_enable" : "enabled" });
    }

    // --- Listener marketing: all users, enable watchlistMatch unless explicitly false ---
    const allUsers = await queryCollection("users", [], 10000);

    let listenerUpdated = 0;
    let listenerSkipped = 0;
    const listenerResults: Array<{ id: string; email?: string; action: string }> = [];

    for (const user of allUsers) {
      const data = user.data;
      const notifs = data.emailNotifications as Record<string, unknown> | undefined;

      // Already opted in
      if (notifs?.watchlistMatch === true) {
        listenerSkipped++;
        listenerResults.push({ id: user.id, email: data.email as string, action: "already_enabled" });
        continue;
      }

      // Explicitly opted out — respect that
      if (notifs?.watchlistMatch === false) {
        listenerSkipped++;
        listenerResults.push({ id: user.id, email: data.email as string, action: "explicitly_off" });
        continue;
      }

      // Not set yet (undefined/null) — opt them in
      if (!dryRun) {
        await updateUser(user.id, { "emailNotifications.watchlistMatch": true });
      }

      listenerUpdated++;
      listenerResults.push({ id: user.id, email: data.email as string, action: dryRun ? "would_enable" : "enabled" });
    }

    return NextResponse.json({
      dryRun,
      djInsiders: {
        totalDJs: djUsers.length,
        updated: djUpdated,
        skipped: djSkipped,
        results: djResults,
      },
      listenerMarketing: {
        totalUsers: allUsers.length,
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
