import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Verify request is from Vercel Cron or has valid secret
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Normalize DJ name for use as document ID
function normalizeForId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Strip HTML tags and decode entities
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

interface DublabDJ {
  title: string;
  slug: string;
  content?: string;
  thumbnail?: number;
  files?: Record<string, {
    url: string;
    sizes?: {
      large?: string;
      medium_large?: string;
      medium?: string;
    };
  }>;
  meta?: {
    description?: string;
    image?: string;
  };
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
    // First, get the list of all DJ slugs
    const listRes = await fetch("https://dublab.wpengine.com/wp-json/lazystate/v1/djs", {
      headers: { Origin: "https://www.dublab.com" },
      signal: AbortSignal.timeout(30000),
    });

    if (listRes.status !== 200) {
      return NextResponse.json(
        { error: "Failed to fetch dublab DJ list", status: listRes.status },
        { status: 500 }
      );
    }

    const listData = await listRes.json();
    const djPaths: string[] = listData["/djs"]?.pages || [];

    console.log(`[sync-dublab-djs] Found ${djPaths.length} DJs in list`);

    const pendingProfilesRef = db.collection("pending-dj-profiles");
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process DJs in batches
    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const djPath of djPaths) {
      // Extract slug from path like "/djs/carlos-nino"
      const slug = djPath.replace("/djs/", "");
      if (!slug) continue;

      try {
        // Fetch individual DJ data
        const djRes = await fetch(`https://dublab.wpengine.com/wp-json/lazystate/v1/djs/${slug}`, {
          headers: { Origin: "https://www.dublab.com" },
          signal: AbortSignal.timeout(5000),
        });

        if (djRes.status !== 200) {
          errors++;
          continue;
        }

        const djData = await djRes.json();
        const dj: DublabDJ = djData[djPath];

        if (!dj || !dj.title) {
          skipped++;
          continue;
        }

        const djName = dj.title.trim();
        const normalizedId = normalizeForId(djName);
        const docRef = pendingProfilesRef.doc(normalizedId);
        const publicUrl = `https://www.dublab.com/djs/${slug}`;

        // Extract bio from content (HTML) or meta.description
        let bio: string | null = null;
        if (dj.content) {
          bio = stripHtml(dj.content);
        } else if (dj.meta?.description) {
          bio = dj.meta.description;
        }

        // Extract photo URL
        let photoUrl: string | null = null;
        if (dj.meta?.image) {
          photoUrl = dj.meta.image;
        } else if (dj.thumbnail && dj.files?.[dj.thumbnail]) {
          const file = dj.files[dj.thumbnail];
          photoUrl = file.sizes?.large || file.sizes?.medium_large || file.url;
        }

        const now = new Date();

        // Check if profile already exists
        const existingDoc = await docRef.get();

        if (existingDoc.exists) {
          const existingData = existingDoc.data();

          // Don't overwrite profiles that have been manually edited or claimed
          if (existingData?.source !== "auto") {
            skipped++;
            continue;
          }

          batch.update(docRef, {
            "djProfile.bio": bio,
            "djProfile.photoUrl": photoUrl,
            validatedFrom: publicUrl,
            updatedAt: now,
          });
          updated++;
        } else {
          // Create new profile
          batch.set(docRef, {
            djName,
            chatUsername: djName,
            chatUsernameNormalized: normalizedId,
            normalizedName: djName.toLowerCase(),
            source: "auto",
            status: "pending",
            autoSources: [{
              stationId: "dublab",
              showName: djName,
              lastSeen: now,
            }],
            djProfile: {
              bio,
              photoUrl,
              location: "Los Angeles",  // dublab is LA-based
              genres: [],
              socialLinks: {},
              promoText: null,
              promoHyperlink: null,
            },
            validatedFrom: publicUrl,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }

        batchCount++;

        // Commit batch when reaching limit
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          console.log(`[sync-dublab-djs] Committed batch, processed ${created + updated + skipped} so far`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        console.error(`[sync-dublab-djs] Error processing ${slug}:`, error);
        errors++;
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[sync-dublab-djs] Complete: created=${created}, updated=${updated}, skipped=${skipped}, errors=${errors}`);

    return NextResponse.json({
      success: true,
      totalDJs: djPaths.length,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("[sync-dublab-djs] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to sync dublab DJs", details: errorMessage },
      { status: 500 }
    );
  }
}
