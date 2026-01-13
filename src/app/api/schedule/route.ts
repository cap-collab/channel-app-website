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
      console.log(`[API /schedule] Fetching profile for userId: ${userId}, exists: ${userDoc.exists}`);
      if (userDoc.exists) {
        const userData = userDoc.data();
        const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string } | undefined;
        console.log(`[API /schedule] User ${userId} djProfile:`, djProfile ? {
          hasBio: !!djProfile.bio,
          hasPhotoUrl: !!djProfile.photoUrl,
          hasPromoText: !!djProfile.promoText,
          hasPromoHyperlink: !!djProfile.promoHyperlink,
        } : 'none');
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
  console.log(`[API /schedule] Fetched ${Object.keys(djProfiles).length} DJ profiles`);

  // Enrich broadcast shows with DJ profile data
  return shows.map((show) => {
    if (show.stationId === "broadcast" && show.djUserId) {
      const profile = djProfiles[show.djUserId];
      if (profile) {
        return {
          ...show,
          djBio: profile.bio || show.djBio,
          djPhotoUrl: profile.photoUrl || show.djPhotoUrl,
          promoText: profile.promoText || show.promoText,
          promoUrl: profile.promoHyperlink || show.promoUrl,
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

    // Debug: Log broadcast shows with their profile data
    const broadcastShows = enrichedShows.filter(s => s.stationId === "broadcast");
    console.log(`[API /schedule] Broadcast shows (${broadcastShows.length}):`,
      broadcastShows.map(s => ({
        name: s.name,
        dj: s.dj,
        djUserId: s.djUserId,
        djPhotoUrl: !!s.djPhotoUrl,
        djBio: !!s.djBio,
        promoText: !!s.promoText,
        promoUrl: !!s.promoUrl,
      }))
    );

    return NextResponse.json({ shows: enrichedShows });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
