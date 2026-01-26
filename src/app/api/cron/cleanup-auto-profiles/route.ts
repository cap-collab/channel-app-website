import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Verify request is from Vercel Cron or has valid secret
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

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin SDK not configured" },
      { status: 500 }
    );
  }

  // Check for station filter in query params
  const { searchParams } = new URL(request.url);
  const stationFilter = searchParams.get("station");

  try {
    // Get all auto-generated profiles
    const snapshot = await db
      .collection("pending-dj-profiles")
      .where("source", "==", "auto")
      .get();

    console.log(`[cleanup-auto-profiles] Found ${snapshot.size} total auto profiles`);

    // Delete in batches, optionally filtering by station
    const batch = db.batch();
    let count = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // If station filter is set, only delete profiles from that station
      if (stationFilter) {
        const autoSources = data.autoSources as Array<{ stationId: string }> | undefined;
        const hasMatchingStation = autoSources?.some(s => s.stationId === stationFilter);
        if (!hasMatchingStation) {
          continue;
        }
      }

      batch.delete(doc.ref);
      count++;
    }

    if (count > 0) {
      await batch.commit();
    }

    const filterMsg = stationFilter ? ` (filtered by station: ${stationFilter})` : "";
    console.log(`[cleanup-auto-profiles] Deleted ${count} auto profiles${filterMsg}`);

    return NextResponse.json({
      success: true,
      deleted: count,
      filter: stationFilter || "all",
    });
  } catch (error) {
    console.error("[cleanup-auto-profiles] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to cleanup auto profiles", details: errorMessage },
      { status: 500 }
    );
  }
}
