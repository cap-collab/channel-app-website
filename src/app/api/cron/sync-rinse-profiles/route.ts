import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Verify request is from Vercel Cron or has valid secret
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Normalize DJ name for use as document ID (no spaces, no hyphens - just alphanumeric)
function normalizeForId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    .replace(/\s+/g, " ")
    .trim();
}

// Small delay to avoid rate limiting
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RinseProfile {
  name: string;
  slug: string;
  bio: string | null;
  genres: string[];
  photoUrl: string | null;
  validationUrl: string;
}

// Genre slugs to scrape for discovering shows
const GENRE_SLUGS = [
  "house",
  "techno",
  "garage",
  "drum-bass",
  "jungle",
  "grime",
  "dubstep",
  "bass",
  "disco",
  "electro",
  "hip-hop",
  "r-b",
  "soul",
  "jazz",
  "ambient",
  "experimental",
  "electronic",
  "dancefloor",
  "breakbeat",
  "trance",
  "hardcore",
  "uk-funky",
  "afrobeats",
  "dancehall",
  "reggae",
];

// Fetch show slugs from a genre tag page
async function fetchGenrePageSlugs(genreSlug: string): Promise<string[]> {
  const url = `https://www.rinse.fm/shows/tags/${genreSlug}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (res.status !== 200) return [];

    const html = await res.text();

    // Extract show slugs from href="/shows/[slug]" patterns
    const slugRegex = /href="\/shows\/([a-z0-9À-ÿ-]+)"/gi;
    const slugs = new Set<string>();

    let match;
    while ((match = slugRegex.exec(html)) !== null) {
      const slug = match[1].toLowerCase();
      // Filter out tag pages and other non-show links
      if (!slug.startsWith("tags") && slug !== "tags") {
        slugs.add(slug);
      }
    }

    return Array.from(slugs);
  } catch (error) {
    console.error(
      `[sync-rinse-profiles] Error fetching genre page ${genreSlug}:`,
      error
    );
    return [];
  }
}

// Fetch individual show profile
async function fetchShowProfile(slug: string): Promise<RinseProfile | null> {
  const url = `https://www.rinse.fm/shows/${slug}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.status !== 200) return null;

    const html = await res.text();

    // Extract DJ name from <h1> tag
    const nameMatch =
      html.match(/<h1[^>]*class="[^"]*font-rinse[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
      html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (!nameMatch) return null;
    const name = nameMatch[1].trim();

    // Extract bio - prioritize the About section (rns-text-block), fallback to intro paragraph
    let bio: string | null = null;

    // First try: About section (rns-text-block div with substantial content)
    const aboutMatch = html.match(
      /<div[^>]*class="[^"]*rns-text-block[^"]*max-w-xl[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (aboutMatch) {
      const aboutText = stripHtml(aboutMatch[1]);
      if (aboutText.length > 50) {
        bio = aboutText;
      }
    }

    // Fallback: Try any rns-text-block
    if (!bio) {
      const textBlockMatch = html.match(
        /<div[^>]*class="[^"]*rns-text-block[^"]*"[^>]*>([\s\S]*?)<\/div>/i
      );
      if (textBlockMatch) {
        const textBlockContent = stripHtml(textBlockMatch[1]);
        if (textBlockContent.length > 20) {
          bio = textBlockContent;
        }
      }
    }

    // Final fallback: Intro/description paragraph near the hero
    if (!bio) {
      const introMatch = html.match(
        /<p[^>]*class="[^"]*text-sm[^"]*"[^>]*>([^<]{20,})<\/p>/i
      );
      if (introMatch) {
        bio = stripHtml(introMatch[1]);
      }
    }

    // Extract genres from tag links: /shows/tags/[genre]
    const genreRegex = /href="\/shows\/tags\/([a-z0-9-]+)"/gi;
    const genres: string[] = [];
    let genreMatch;
    while ((genreMatch = genreRegex.exec(html)) !== null) {
      // Convert slug to readable format: "drum-bass" -> "Drum Bass"
      const genreSlug = genreMatch[1];
      const genreTitle = genreSlug
        .split("-")
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      if (!genres.includes(genreTitle)) {
        genres.push(genreTitle);
      }
    }

    // Extract photo URL from image.rinse.fm
    const photoMatch = html.match(/https:\/\/image\.rinse\.fm\/_\/[^\s"']+/i);
    let photoUrl = photoMatch ? photoMatch[0] : null;
    // Clean up query params to get base image URL with reasonable size
    if (photoUrl) {
      const baseUrl = photoUrl.split("?")[0];
      photoUrl = `${baseUrl}?w=800&h=800`;
    }

    return {
      name,
      slug,
      bio,
      genres,
      photoUrl,
      validationUrl: url,
    };
  } catch (error) {
    console.error(`[sync-rinse-profiles] Error fetching show ${slug}:`, error);
    return null;
  }
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
    // PHASE 1: Discover all show slugs from genre pages
    console.log(
      `[sync-rinse-profiles] Starting discovery from ${GENRE_SLUGS.length} genre pages`
    );

    const allSlugs = new Set<string>();
    for (const genre of GENRE_SLUGS) {
      const slugs = await fetchGenrePageSlugs(genre);
      slugs.forEach((s) => allSlugs.add(s));
      console.log(
        `[sync-rinse-profiles] Genre "${genre}": found ${slugs.length} shows`
      );
      await delay(200); // Rate limit between genre pages
    }

    console.log(
      `[sync-rinse-profiles] Discovered ${allSlugs.size} unique show slugs`
    );

    // PHASE 2: Fetch individual profiles and sync to Firestore
    const pendingProfilesRef = db.collection("pending-dj-profiles");
    let created = 0;
    let updated = 0;
    let skippedAdmin = 0;
    let skippedNoData = 0;
    let errors = 0;

    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    for (const slug of Array.from(allSlugs)) {
      try {
        const profile = await fetchShowProfile(slug);

        if (!profile || !profile.name) {
          skippedNoData++;
          continue;
        }

        const normalizedId = normalizeForId(profile.name);
        if (normalizedId.length < 2) {
          skippedNoData++;
          continue;
        }

        const docRef = pendingProfilesRef.doc(normalizedId);
        const existingDoc = await docRef.get();
        const now = new Date();

        if (existingDoc.exists) {
          const existingData = existingDoc.data();

          // Skip admin-created profiles (non-auto source)
          if (existingData?.source !== "auto") {
            skippedAdmin++;
            continue;
          }

          // MERGE LOGIC: Only update empty fields - never overwrite existing data
          const existingDjProfile = existingData?.djProfile || {};
          const updates: Record<string, unknown> = {};

          if (!existingDjProfile.bio && profile.bio) {
            updates["djProfile.bio"] = profile.bio;
          }
          if (!existingDjProfile.photoUrl && profile.photoUrl) {
            updates["djProfile.photoUrl"] = profile.photoUrl;
          }
          if (
            (!existingDjProfile.genres ||
              existingDjProfile.genres.length === 0) &&
            profile.genres.length > 0
          ) {
            updates["djProfile.genres"] = profile.genres;
          }

          // Always update source tracking
          updates.validatedFrom = profile.validationUrl;
          updates.updatedAt = now;

          // Only write if there are actual profile updates (beyond just timestamps)
          if (Object.keys(updates).length > 2) {
            batch.update(docRef, updates);
            updated++;
            batchCount++;
          }
        } else {
          // CREATE new profile
          batch.set(docRef, {
            djName: profile.name,
            chatUsername: profile.name,
            chatUsernameNormalized: normalizedId,
            normalizedName: profile.name.toLowerCase(),
            source: "auto",
            status: "pending",
            autoSources: [
              {
                stationId: "rinse",
                showName: profile.name,
                lastSeen: now,
              },
            ],
            djProfile: {
              bio: profile.bio,
              photoUrl: profile.photoUrl,
              location: "London", // Rinse FM is London-based
              genres: profile.genres,
              socialLinks: {},
              promoText: null,
              promoHyperlink: null,
            },
            validatedFrom: profile.validationUrl,
            createdAt: now,
            updatedAt: now,
          });
          created++;
          batchCount++;
        }

        // Commit batch when reaching limit
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          console.log(
            `[sync-rinse-profiles] Committed batch, processed ${created + updated + skippedAdmin + skippedNoData} so far`
          );
        }

        // Rate limiting: 100ms delay between profile fetches
        await delay(100);
      } catch (error) {
        console.error(`[sync-rinse-profiles] Error processing ${slug}:`, error);
        errors++;
      }
    }

    // Commit remaining batch
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(
      `[sync-rinse-profiles] Complete: created=${created}, updated=${updated}, skippedAdmin=${skippedAdmin}, skippedNoData=${skippedNoData}, errors=${errors}`
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalSlugsDiscovered: allSlugs.size,
        created,
        updated,
        skippedAdmin,
        skippedNoData,
        errors,
      },
    });
  } catch (error) {
    console.error("[sync-rinse-profiles] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to sync Rinse profiles", details: errorMessage },
      { status: 500 }
    );
  }
}
