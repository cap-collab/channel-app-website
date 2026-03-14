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
    const usernamesRef = db.collection("usernames");

    // Single read: get all pending profiles
    const snapshot = await pendingProfilesRef.get();

    // Build in-memory set of all doc IDs (avoids per-doc reads)
    const allDocIds = new Set<string>();
    for (const doc of snapshot.docs) {
      allDocIds.add(doc.id);
    }

    // Filter to only hyphenated IDs
    const hyphenatedDocs = snapshot.docs.filter((doc) => doc.id.includes("-"));

    let deleted = 0;
    let migrated = 0;
    let usernamesCleaned = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of hyphenatedDocs) {
      const docId = doc.id;
      const data = doc.data();
      const correctId = normalizeId(data.chatUsername || docId);

      if (correctId === docId) {
        // Not actually a normalization issue (e.g. no hyphens after normalize)
        continue;
      }

      if (allDocIds.has(correctId)) {
        // Correct doc already exists — just delete the hyphenated duplicate
        batch.delete(doc.ref);
        deleted++;
        console.log(
          `[migrate] Delete duplicate: ${docId} (correct: ${correctId} exists)`
        );
      } else {
        // Migrate: create correct doc, delete old one
        batch.set(pendingProfilesRef.doc(correctId), {
          ...data,
          chatUsernameNormalized: correctId,
        });
        batch.delete(doc.ref);
        allDocIds.add(correctId); // Track so subsequent dupes see it
        migrated++;
        console.log(`[migrate] Migrate: ${docId} → ${correctId}`);
      }

      batchCount += 2; // delete + possible set

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit remaining profile changes
    if (batchCount > 0) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }

    // Clean up stale username reservations for hyphenated IDs
    // Only read username docs for the hyphenated IDs we processed
    for (const doc of hyphenatedDocs) {
      const docId = doc.id;
      const correctId = normalizeId(doc.data().chatUsername || docId);
      if (correctId === docId) continue;

      const usernameDoc = await usernamesRef.doc(docId).get();
      if (usernameDoc.exists && usernameDoc.data()?.isPending === true) {
        batch.delete(usernameDoc.ref);
        usernamesCleaned++;
        batchCount++;

        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // Commit remaining username cleanups
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(
      `[migrate] Complete: ${migrated} migrated, ${deleted} deleted, ${usernamesCleaned} usernames cleaned`
    );

    return NextResponse.json({
      success: true,
      stats: {
        total: snapshot.size,
        hyphenated: hyphenatedDocs.length,
        migrated,
        deleted,
        usernamesCleaned,
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
