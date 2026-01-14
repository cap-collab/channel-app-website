import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";
import { getAdminDb } from "@/lib/firebase-admin";
import { Show } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Fetch DJ profiles using Admin SDK (bypasses security rules)
async function enrichBroadcastShowsWithDJProfiles(shows: Show[]): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping DJ profile enrichment");
    return shows;
  }

  // Collect all unique DJ user IDs from broadcast shows
  const djUserIds = new Set<string>();
  shows.forEach((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      djUserIds.add(show.djUserId);
    }
  });

  if (djUserIds.size === 0) {
    return shows;
  }

  // Fetch all DJ profiles in parallel using Admin SDK
  const djProfiles: Record<string, { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string }> = {};

  const profilePromises = Array.from(djUserIds).map(async (userId) => {
    try {
      const userDoc = await adminDb.collection("users").doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string } | undefined;
        if (djProfile) {
          djProfiles[userId] = {
            bio: djProfile.bio || undefined,
            photoUrl: djProfile.photoUrl || undefined,
            promoText: djProfile.promoText || undefined,
            promoHyperlink: djProfile.promoHyperlink || undefined,
          };
        }
      }
    } catch (err) {
      console.error(`[API /schedule] Failed to fetch DJ profile for ${userId}:`, err);
    }
  });

  await Promise.all(profilePromises);

  // Enrich broadcast shows with DJ profile data
  // For shows that already have pre-configured data (from venue DJ slots), prefer that data
  // Only use fresh profile data as fallback when slot data is missing
  return shows.map((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      const profile = djProfiles[show.djUserId];
      if (profile) {
        return {
          ...show,
          // Prefer pre-configured slot data, fall back to fresh profile data
          djBio: show.djBio || profile.bio,
          djPhotoUrl: show.djPhotoUrl || profile.photoUrl,
          promoText: show.promoText || profile.promoText,
          promoUrl: show.promoUrl || profile.promoHyperlink,
        };
      }
    }
    return show;
  });
}

export async function GET() {
  try {
    const shows = await getAllShows();

    // Enrich broadcast shows with DJ profiles using Admin SDK
    const enrichedShows = await enrichBroadcastShowsWithDJProfiles(shows);

    return NextResponse.json({ shows: enrichedShows });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
