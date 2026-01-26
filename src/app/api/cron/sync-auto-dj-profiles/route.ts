import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getAllShows } from "@/lib/metadata";
import { FieldValue } from "firebase-admin/firestore";

// Verify request is from Vercel Cron or has valid secret
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

interface AutoSource {
  stationId: string;
  showName: string;
  lastSeen: Date;
}

// Extract DJ name for dublab shows where format is "DJ Name - Show Name"
// The metadata has this backwards (j field contains show name, not DJ)
function extractDublabDJ(showName: string): string | null {
  // Match pattern "DJ Name - Show Name"
  const match = showName.match(/^(.+?)\s*-\s*.+$/);
  if (match && match[1]) {
    const djName = match[1].trim();
    // Make sure it's not empty and looks like a name (not just numbers or special chars)
    if (djName.length >= 2 && /[a-zA-Z]/.test(djName)) {
      return djName;
    }
  }
  return null;
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

  try {
    // Fetch all shows from all stations
    const allShows = await getAllShows();
    console.log(`[sync-auto-dj-profiles] Fetched ${allShows.length} total shows`);

    // Extract unique DJs from external radio shows (not broadcast)
    const djMap = new Map<string, { djName: string; sources: AutoSource[] }>();

    for (const show of allShows) {
      // Skip Channel Broadcast shows (they have their own profiles)
      if (show.stationId === "broadcast") continue;

      // For dublab: the DJ name is in show.name as "DJ - Show Name" format
      // The show.dj field incorrectly contains the show name
      let djName = show.dj;
      let showName = show.name;

      if (show.stationId === "dublab" && show.name) {
        const extractedDJ = extractDublabDJ(show.name);
        if (extractedDJ) {
          djName = extractedDJ;
          // The actual show name is what's after the dash
          const dashIndex = show.name.indexOf(" - ");
          if (dashIndex > 0) {
            showName = show.name.substring(dashIndex + 3).trim();
          }
        }
      }

      // Skip shows without DJ info
      if (!djName) continue;

      // Normalize DJ name for document ID
      // Remove spaces, hyphens, and any characters invalid for Firestore doc IDs
      const normalized = djName
        .replace(/[\s-]+/g, "")
        .replace(/[\/,&.#$\[\]]/g, "") // Remove Firestore-invalid chars
        .toLowerCase();

      // Skip empty or very short normalized names
      if (normalized.length < 2) continue;

      if (!djMap.has(normalized)) {
        djMap.set(normalized, { djName, sources: [] });
      }

      // Add source if not already present for this station+show combo
      const existing = djMap.get(normalized)!;
      const alreadyHasSource = existing.sources.some(
        (s) => s.stationId === show.stationId && s.showName === showName
      );

      if (!alreadyHasSource) {
        existing.sources.push({
          stationId: show.stationId,
          showName: showName,
          lastSeen: new Date(),
        });
      }
    }

    console.log(`[sync-auto-dj-profiles] Found ${djMap.size} unique DJs from external radios`);

    // Process each DJ - create or update profile
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [normalized, data] of Array.from(djMap.entries())) {
      const profileRef = db.collection("pending-dj-profiles").doc(normalized);
      const existingDoc = await profileRef.get();

      if (!existingDoc.exists) {
        // Create new auto profile
        await profileRef.set({
          chatUsername: data.djName,
          chatUsernameNormalized: normalized,
          source: "auto",
          status: "pending",
          autoSources: data.sources.map((s: AutoSource) => ({
            stationId: s.stationId,
            showName: s.showName,
            lastSeen: s.lastSeen,
          })),
          djProfile: {
            bio: null,
            photoUrl: null,
            location: null,
            genres: [],
            promoText: null,
            promoHyperlink: null,
            socialLinks: {},
          },
          createdAt: FieldValue.serverTimestamp(),
        });
        created++;
      } else {
        const existingData = existingDoc.data();

        // Only update if it's an auto profile (don't overwrite admin-created)
        if (existingData?.source === "auto") {
          await profileRef.update({
            autoSources: data.sources.map((s: AutoSource) => ({
              stationId: s.stationId,
              showName: s.showName,
              lastSeen: s.lastSeen,
            })),
            updatedAt: FieldValue.serverTimestamp(),
          });
          updated++;
        } else {
          // Profile exists but is admin-created, skip
          skipped++;
        }
      }
    }

    console.log(
      `[sync-auto-dj-profiles] Done: ${created} created, ${updated} updated, ${skipped} skipped (admin profiles)`
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalDJs: djMap.size,
        created,
        updated,
        skipped,
      },
    });
  } catch (error) {
    console.error("[sync-auto-dj-profiles] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to sync auto DJ profiles", details: errorMessage },
      { status: 500 }
    );
  }
}
