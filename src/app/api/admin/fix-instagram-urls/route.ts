import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Extract Instagram username from URL or handle
function extractInstagramUsername(input: string): string {
  // Remove trailing slashes and query params
  const cleaned = input.split("?")[0].replace(/\/+$/, "");

  // Match Instagram URL patterns
  const urlMatch = cleaned.match(/instagram\.com\/([^\/]+)/);
  if (urlMatch) {
    return urlMatch[1]; // Return just the username
  }

  // If it's already just a username (possibly with @)
  return cleaned.replace(/^@/, "");
}

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin SDK not configured" },
      { status: 500 }
    );
  }

  try {
    const pendingProfilesRef = db.collection("pending-dj-profiles");
    const snapshot = await pendingProfilesRef.get();

    let fixed = 0;
    let skipped = 0;
    const updates: { id: string; before: string; after: string }[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const instagram = data.djProfile?.socialLinks?.instagram;

      if (instagram && instagram.includes("instagram.com")) {
        const username = extractInstagramUsername(instagram);

        await doc.ref.update({
          "djProfile.socialLinks.instagram": username,
        });

        updates.push({ id: doc.id, before: instagram, after: username });
        fixed++;
        console.log(`[fix-instagram] ${doc.id}: ${instagram} → ${username}`);
      } else {
        skipped++;
      }
    }

    console.log(`[fix-instagram] Complete: ${fixed} fixed, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      stats: {
        total: snapshot.size,
        fixed,
        skipped,
      },
      updates,
    });
  } catch (error) {
    console.error("[fix-instagram] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Migration failed", details: errorMessage },
      { status: 500 }
    );
  }
}
