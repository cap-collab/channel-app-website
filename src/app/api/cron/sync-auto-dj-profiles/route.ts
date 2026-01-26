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

interface ProfileData {
  exists: boolean;
  bio?: string;
  location?: string;
  genres?: string[];
  socialLinks?: Record<string, string>;
  photoUrl?: string;
  validationUrl?: string;
}

// Slug helpers for URL normalization
function toNoSpaceSlug(name: string): string {
  // "Dor Wand" → "dorwand" (for dublab, SoundCloud)
  return name.replace(/[\s]+/g, "").toLowerCase();
}

function toHyphenSlug(name: string): string {
  // "Dor Wand" → "dor-wand" (for Subtle, NTS)
  return name.replace(/[\s]+/g, "-").toLowerCase();
}

// Extract DJ name for dublab shows where format is "DJ Name - Show Name"
function extractDublabDJ(showName: string): string | null {
  const match = showName.match(/^(.+?)\s*-\s*.+$/);
  if (match && match[1]) {
    const djName = match[1].trim();
    if (djName.length >= 2 && /[a-zA-Z]/.test(djName)) {
      return djName;
    }
  }
  return null;
}

// Validate dublab DJ profile using their WordPress API
async function validateDublabProfile(djName: string): Promise<ProfileData> {
  const slug = toNoSpaceSlug(djName);
  const apiUrl = `https://dublab.wpengine.com/wp-json/lazystate/v1/djs/${slug}`;
  const publicUrl = `https://www.dublab.com/djs/${slug}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "Origin": "https://www.dublab.com" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 200) {
      const data = await res.json();
      const djData = data[`/djs/${slug}`];

      if (djData && !djData._notfound) {
        // Extract bio from meta.description (plain text) or strip HTML from content
        let bio = djData.meta?.description;
        if (!bio && djData.content) {
          // Strip HTML tags from content
          bio = djData.content.replace(/<[^>]+>/g, "").trim();
        }

        // Extract photo URL from meta.image or files
        let photoUrl = djData.meta?.image;
        if (!photoUrl && djData.thumbnail && djData.files?.[djData.thumbnail]) {
          const file = djData.files[djData.thumbnail];
          photoUrl = file.sizes?.large || file.sizes?.medium_large || file.url;
        }

        return {
          exists: true,
          validationUrl: publicUrl,
          bio: bio || undefined,
          photoUrl: photoUrl || undefined,
        };
      }
    }
  } catch {
    // Timeout or network error
  }
  return { exists: false };
}

// Validate Subtle Radio resident (hyphen slug)
async function validateSubtleProfile(showName: string): Promise<ProfileData> {
  const slug = toHyphenSlug(showName);
  const url = `https://www.subtleradio.com/residents/${slug}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 200) {
      const html = await res.text();

      // Extract genres from page
      const genres: string[] = [];
      const genreMatches = Array.from(html.matchAll(/class="[^"]*genre[^"]*"[^>]*>([^<]+)</gi));
      for (const m of genreMatches) {
        genres.push(m[1].trim());
      }

      // Extract description
      let bio: string | undefined;
      const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
      if (descMatch) {
        bio = descMatch[1];
      }

      // Extract social links
      const socialLinks: Record<string, string> = {};
      const linkPatterns = [
        { pattern: /href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i, key: "instagram" },
        { pattern: /href="(https?:\/\/(?:www\.)?soundcloud\.com\/[^"]+)"/i, key: "soundcloud" },
        { pattern: /href="(https?:\/\/[^"]*bandcamp\.com[^"]*)"/, key: "bandcamp" },
      ];

      for (const { pattern, key } of linkPatterns) {
        const match = html.match(pattern);
        if (match) {
          socialLinks[key] = match[1];
        }
      }

      return { exists: true, validationUrl: url, bio, genres, socialLinks };
    }
  } catch {
    // Timeout or network error
  }
  return { exists: false };
}

// Validate NTS show page (hyphen slug) - extract from React state
async function validateNTSProfile(djName: string): Promise<ProfileData> {
  const slug = toHyphenSlug(djName);
  const url = `https://www.nts.live/shows/${slug}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 200) {
      const html = await res.text();

      // Extract from window._REACT_STATE_
      const stateMatch = html.match(/window\._REACT_STATE_\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          const show = state?.show;

          if (show) {
            const bio = show.description || undefined;
            const photoUrl = show.media?.picture_large || show.media?.picture_medium || undefined;

            // Extract social links
            const socialLinks: Record<string, string> = {};
            if (show.external_links && Array.isArray(show.external_links)) {
              for (const link of show.external_links) {
                const linkUrl = link.url || link;
                if (typeof linkUrl === "string") {
                  if (linkUrl.includes("instagram.com")) socialLinks.instagram = linkUrl;
                  else if (linkUrl.includes("soundcloud.com")) socialLinks.soundcloud = linkUrl;
                  else if (linkUrl.includes("bandcamp.com")) socialLinks.bandcamp = linkUrl;
                  else if (!linkUrl.includes("nts.live")) socialLinks.website = linkUrl;
                }
              }
            }

            return { exists: true, validationUrl: url, bio, photoUrl, socialLinks };
          }
        } catch {
          // JSON parse error
        }
      }

      // Page exists but couldn't extract data
      return { exists: true, validationUrl: url };
    }
  } catch {
    // Timeout or network error
  }
  return { exists: false };
}

// Validate via SoundCloud for Rinse (no-space slug)
async function validateSoundCloudProfile(djName: string): Promise<ProfileData> {
  const slug = toNoSpaceSlug(djName);
  const url = `https://soundcloud.com/${slug}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 200) {
      const html = await res.text();

      // Extract bio from meta description or JSON-LD
      let bio: string | undefined;
      let location: string | undefined;

      // Try meta description
      const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      if (descMatch) {
        bio = descMatch[1];
      }

      // Try to find location in page content
      const locationMatch = html.match(/"city"\s*:\s*"([^"]+)"/);
      if (locationMatch) {
        location = locationMatch[1];
      }

      return {
        exists: true,
        validationUrl: url,
        bio,
        location,
        socialLinks: { soundcloud: url },
      };
    }
  } catch {
    // Timeout or network error
  }
  return { exists: false };
}

// Small delay to avoid rate limiting
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // Group shows by DJ to avoid duplicate validations
    const djMap = new Map<
      string,
      {
        djName: string;
        sources: AutoSource[];
        stationId: string; // Primary station for validation
        showNameForValidation: string; // For Subtle where show name = DJ name
      }
    >();

    for (const show of allShows) {
      // Skip Channel Broadcast shows (they have their own profiles)
      if (show.stationId === "broadcast") continue;

      // Skip Newtown Radio - no auto profiles
      if (show.stationId === "newtown") continue;

      // For dublab: the DJ name is in show.name as "DJ - Show Name" format
      let djName = show.dj;
      let showName = show.name;

      if (show.stationId === "dublab" && show.name) {
        const extractedDJ = extractDublabDJ(show.name);
        if (extractedDJ) {
          djName = extractedDJ;
          const dashIndex = show.name.indexOf(" - ");
          if (dashIndex > 0) {
            showName = show.name.substring(dashIndex + 3).trim();
          }
        }
      }

      // Skip shows without DJ info
      if (!djName) continue;

      // Normalize DJ name for document ID
      const normalized = djName
        .replace(/[\s-]+/g, "")
        .replace(/[\/,&.#$\[\]]/g, "")
        .toLowerCase();

      // Skip empty or very short normalized names
      if (normalized.length < 2) continue;

      if (!djMap.has(normalized)) {
        djMap.set(normalized, {
          djName,
          sources: [],
          stationId: show.stationId,
          showNameForValidation: showName,
        });
      }

      // Add source if not already present
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

    // Process each DJ - validate then create/update profile
    let created = 0;
    let updated = 0;
    let skippedAdmin = 0;
    let skippedNoProfile = 0;

    // Cache validation results to avoid duplicate requests
    const validationCache = new Map<string, ProfileData>();

    for (const [normalized, data] of Array.from(djMap.entries())) {
      // Check if profile already exists
      const profileRef = db.collection("pending-dj-profiles").doc(normalized);
      const existingDoc = await profileRef.get();

      // Skip if admin-created profile exists
      if (existingDoc.exists && existingDoc.data()?.source !== "auto") {
        skippedAdmin++;
        continue;
      }

      // Validate profile on external platform
      const cacheKey = `${data.stationId}:${data.djName}`;
      let profileData: ProfileData;

      if (validationCache.has(cacheKey)) {
        profileData = validationCache.get(cacheKey)!;
      } else {
        switch (data.stationId) {
          case "dublab":
            profileData = await validateDublabProfile(data.djName);
            break;
          case "subtle":
            // For Subtle, show name = DJ/resident name
            profileData = await validateSubtleProfile(data.showNameForValidation);
            break;
          case "nts1":
          case "nts2":
            profileData = await validateNTSProfile(data.djName);
            break;
          case "rinse":
          case "rinsefr":
            profileData = await validateSoundCloudProfile(data.djName);
            break;
          default:
            profileData = { exists: false };
        }

        validationCache.set(cacheKey, profileData);

        // Small delay to avoid rate limiting
        await delay(100);
      }

      // Skip if no valid external profile found
      if (!profileData.exists) {
        skippedNoProfile++;
        console.log(`[sync-auto-dj-profiles] Skipped ${data.djName} - no external profile found`);
        continue;
      }

      if (!existingDoc.exists) {
        // Create new auto profile with enriched data
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
            bio: profileData.bio || null,
            photoUrl: profileData.photoUrl || null,
            location: profileData.location || null,
            genres: profileData.genres || [],
            promoText: null,
            promoHyperlink: null,
            socialLinks: profileData.socialLinks || {},
          },
          validatedFrom: profileData.validationUrl || null,
          createdAt: FieldValue.serverTimestamp(),
        });
        created++;
        console.log(`[sync-auto-dj-profiles] Created profile for ${data.djName}`);
      } else {
        // Update existing auto profile
        await profileRef.update({
          autoSources: data.sources.map((s: AutoSource) => ({
            stationId: s.stationId,
            showName: s.showName,
            lastSeen: s.lastSeen,
          })),
          updatedAt: FieldValue.serverTimestamp(),
        });
        updated++;
      }
    }

    console.log(
      `[sync-auto-dj-profiles] Done: ${created} created, ${updated} updated, ${skippedAdmin} skipped (admin), ${skippedNoProfile} skipped (no external profile)`
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalDJs: djMap.size,
        created,
        updated,
        skippedAdmin,
        skippedNoProfile,
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
