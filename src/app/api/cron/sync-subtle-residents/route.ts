import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Verify request is from Vercel Cron or has valid secret
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Subtle Radio Supabase API config
const SUBTLE_SUPABASE_URL = "https://pkqpxkyxuaklmztbvryf.supabase.co";
const SUBTLE_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBrcXB4a3l4dWFrbG16dGJ2cnlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc3MTgzNzYsImV4cCI6MjA1MzI5NDM3Nn0.uq5M6qd3tntsj7KpiXPTNIUn-mk6VQFFXJFPj7Wg-os";

interface SubtleResident {
  id: number;
  show_name: string;
  slug: string;
  description: string | null;
  city: string | null;
  country: string | null;
  top_genre: string | null;
  genre_2: string | null;
  genre_3: string | null;
  image_url: string | null;
  instagram: string | null;
  soundcloud: string | null;
  bandcamp: string | null;
  mixcloud: string | null;
  youtube: string | null;
  website: string | null;
  tiktok: string | null;
  hide_resident: boolean;
}

// Normalize DJ name for use as document ID
function normalizeForId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
    // Fetch all visible residents from Subtle's Supabase
    const apiUrl = `${SUBTLE_SUPABASE_URL}/rest/v1/team_pages?select=*&hide_resident=eq.false`;
    const res = await fetch(apiUrl, {
      headers: { apikey: SUBTLE_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(30000),
    });

    if (res.status !== 200) {
      return NextResponse.json(
        { error: "Failed to fetch Subtle residents", status: res.status },
        { status: 500 }
      );
    }

    const residents: SubtleResident[] = await res.json();
    console.log(`[sync-subtle-residents] Fetched ${residents.length} residents from Subtle API`);

    const pendingProfilesRef = db.collection("pending-dj-profiles");
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Process in batches to avoid Firestore limits
    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const resident of residents) {
      const djName = resident.show_name.trim();
      if (!djName) {
        skipped++;
        continue;
      }

      const normalizedId = normalizeForId(djName);
      const docRef = pendingProfilesRef.doc(normalizedId);
      const publicUrl = `https://www.subtleradio.com/residents/${resident.slug}`;

      // Build genres array
      const genres: string[] = [];
      if (resident.top_genre) genres.push(resident.top_genre);
      if (resident.genre_2) genres.push(resident.genre_2);
      if (resident.genre_3) genres.push(resident.genre_3);

      // Build social links
      const socialLinks: Record<string, string> = {};
      if (resident.instagram) socialLinks.instagram = resident.instagram;
      if (resident.soundcloud) socialLinks.soundcloud = resident.soundcloud;
      if (resident.bandcamp) socialLinks.bandcamp = resident.bandcamp;
      if (resident.mixcloud) socialLinks.mixcloud = resident.mixcloud;
      if (resident.youtube) socialLinks.youtube = resident.youtube;
      if (resident.website) socialLinks.website = resident.website;
      if (resident.tiktok) socialLinks.tiktok = resident.tiktok;

      // Build location
      const locationParts: string[] = [];
      if (resident.city) locationParts.push(resident.city);
      if (resident.country) locationParts.push(resident.country);
      const location = locationParts.length > 0 ? locationParts.join(", ") : null;

      // Check if profile already exists
      const existingDoc = await docRef.get();
      const now = new Date();

      if (existingDoc.exists) {
        // Update existing profile with latest data from Subtle
        const existingData = existingDoc.data();

        // Don't overwrite profiles that have been manually edited or claimed
        if (existingData?.source !== "auto") {
          skipped++;
          continue;
        }

        batch.update(docRef, {
          bio: resident.description || null,
          photoUrl: resident.image_url || null,
          location: location,
          genres: genres.length > 0 ? genres : null,
          socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : null,
          validatedFrom: publicUrl,
          updatedAt: now,
        });
        updated++;
      } else {
        // Create new profile
        batch.set(docRef, {
          djName,
          normalizedName: djName.toLowerCase(),
          source: "auto",
          autoSources: [{
            stationId: "subtle",
            showName: djName,
            lastSeen: now,
          }],
          bio: resident.description || null,
          photoUrl: resident.image_url || null,
          location: location,
          genres: genres.length > 0 ? genres : null,
          socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : null,
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
        console.log(`[sync-subtle-residents] Committed batch, processed ${created + updated + skipped} so far`);
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[sync-subtle-residents] Complete: created=${created}, updated=${updated}, skipped=${skipped}`);

    return NextResponse.json({
      success: true,
      totalResidents: residents.length,
      created,
      updated,
      skipped,
    });
  } catch (error) {
    console.error("[sync-subtle-residents] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to sync Subtle residents", details: errorMessage },
      { status: 500 }
    );
  }
}
