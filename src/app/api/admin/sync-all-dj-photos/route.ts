import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// POST - One-time sync: update djPhotoUrl in all collectives and venues
// by looking up each DJ's current photo from users or pending-dj-profiles
export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-cron-secret");
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    // Build lookup maps for DJ photos
    const photoByUserId = new Map<string, string>();
    const photoByUsername = new Map<string, string>();

    // Load all users with DJ profiles
    const usersSnapshot = await db.collection("users").get();
    usersSnapshot.forEach((doc) => {
      const data = doc.data();
      const photoUrl = data.djProfile?.photoUrl;
      if (photoUrl) {
        photoByUserId.set(doc.id, photoUrl);
        const username = data.chatUsernameNormalized;
        if (username) photoByUsername.set(username, photoUrl);
      }
    });

    // Load all pending DJ profiles
    const pendingSnapshot = await db.collection("pending-dj-profiles").get();
    pendingSnapshot.forEach((doc) => {
      const data = doc.data();
      const photoUrl = data.djProfile?.photoUrl;
      if (photoUrl) {
        const username = data.chatUsernameNormalized;
        if (username && !photoByUsername.has(username)) {
          photoByUsername.set(username, photoUrl);
        }
      }
    });

    let updated = 0;
    const details: string[] = [];

    // Process collectives and venues
    const collections = ["collectives", "venues"];
    for (const collName of collections) {
      const snapshot = await db.collection(collName).get();
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const residentDJs = data.residentDJs;
        if (!residentDJs || !Array.isArray(residentDJs)) continue;

        let changed = false;
        const updatedDJs = residentDJs.map((dj: Record<string, unknown>) => {
          // Look up current photo by userId first, then by username
          const currentPhoto =
            (dj.djUserId && photoByUserId.get(dj.djUserId as string)) ||
            (dj.djUsername && photoByUsername.get(dj.djUsername as string)) ||
            null;

          if (currentPhoto && currentPhoto !== dj.djPhotoUrl) {
            changed = true;
            details.push(`${collName}/${data.name || doc.id}: ${dj.djName} photo updated`);
            return { ...dj, djPhotoUrl: currentPhoto };
          }
          return dj;
        });

        if (changed) {
          await doc.ref.update({ residentDJs: updatedDJs });
          updated++;
        }
      }
    }

    return NextResponse.json({ success: true, updated, details });
  } catch (error) {
    console.error("[sync-all-dj-photos] Error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}
