import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Normalize to alphanumeric only (no hyphens, no spaces)
function normalizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function POST(request: NextRequest) {
  // Verify cron secret (same as other admin endpoints)
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

    let deleted = 0;
    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const doc of snapshot.docs) {
      const docId = doc.id;
      const data = doc.data();

      // Check if document ID contains a hyphen (improperly normalized)
      if (docId.includes("-")) {
        // Calculate what the correct ID should be
        const correctId = normalizeId(data.chatUsername || docId);

        // Check if a document with the correct ID already exists
        const correctDocRef = pendingProfilesRef.doc(correctId);
        const correctDoc = await correctDocRef.get();

        if (correctDoc.exists) {
          // Correct document already exists, just delete the hyphenated one
          await doc.ref.delete();
          deleted++;
          console.log(`[migrate] Deleted duplicate: ${docId} (correct: ${correctId} exists)`);
        } else {
          // Migrate: create new document with correct ID, then delete old one
          const newData = {
            ...data,
            chatUsernameNormalized: correctId,
          };
          await correctDocRef.set(newData);
          await doc.ref.delete();
          migrated++;
          console.log(`[migrate] Migrated: ${docId} → ${correctId}`);
        }
      } else {
        // Document ID is already correct, just update chatUsernameNormalized if needed
        const correctNormalized = normalizeId(data.chatUsername || docId);
        if (data.chatUsernameNormalized !== correctNormalized) {
          await doc.ref.update({ chatUsernameNormalized: correctNormalized });
          migrated++;
          console.log(`[migrate] Updated chatUsernameNormalized: ${docId}`);
        } else {
          skipped++;
        }
      }
    }

    console.log(`[migrate] Complete: ${migrated} migrated, ${deleted} deleted, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      stats: {
        total: snapshot.size,
        migrated,
        deleted,
        skipped,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[migrate] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Migration failed", details: errorMessage },
      { status: 500 }
    );
  }
}
