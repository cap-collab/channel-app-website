import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";
import { getAdminDb } from "@/lib/firebase-admin";
import { Show } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Normalize name for profile lookup (must match sync-auto-dj-profiles)
function normalizeForProfileLookup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Fetch DJ profiles using Admin SDK (bypasses security rules)
async function enrichShowsWithDJProfiles(shows: Show[]): Promise<Show[]> {
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

  // Collect all unique DJ/show names from external radio shows for pending-dj-profiles lookup
  const externalDjNames = new Map<string, string>(); // normalized -> original name
  shows.forEach((show) => {
    // External radios (NTS, Rinse, Subtle, dublab)
    if (show.stationId !== "broadcast" && show.stationId !== "newtown") {
      const nameToLookup = show.dj || show.name;
      if (nameToLookup) {
        const normalized = normalizeForProfileLookup(nameToLookup);
        if (normalized.length >= 2) {
          externalDjNames.set(normalized, nameToLookup);
        }
      }
    }
  });

  // Fetch broadcast DJ profiles from users collection
  const djProfiles: Record<string, { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string }> = {};

  const broadcastPromises = Array.from(djUserIds).map(async (userId) => {
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

  // Fetch external DJ profiles from pending-dj-profiles collection
  const externalProfiles: Record<string, { bio?: string; photoUrl?: string; username?: string }> = {};

  const externalPromises = Array.from(externalDjNames.keys()).map(async (normalized) => {
    try {
      const doc = await adminDb.collection("pending-dj-profiles").doc(normalized).get();
      if (doc.exists) {
        const data = doc.data();
        const djProfile = data?.djProfile as { bio?: string; photoUrl?: string } | undefined;
        externalProfiles[normalized] = {
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          username: data?.chatUsernameNormalized || data?.chatUsername || undefined,
        };
      }
    } catch {
      // Silently ignore errors for external profiles
    }
  });

  await Promise.all([...broadcastPromises, ...externalPromises]);

  // Enrich shows with DJ profile data
  return shows.map((show) => {
    // Broadcast shows: use users collection
    if (show.stationId === "broadcast" && show.djUserId) {
      const profile = djProfiles[show.djUserId];
      if (profile) {
        return {
          ...show,
          djBio: show.djBio || profile.bio,
          djPhotoUrl: show.djPhotoUrl || profile.photoUrl,
          promoText: show.promoText || profile.promoText,
          promoUrl: show.promoUrl || profile.promoHyperlink,
        };
      }
    }

    // External radio shows: use pending-dj-profiles collection
    if (show.stationId !== "broadcast" && show.stationId !== "newtown") {
      const nameToLookup = show.dj || show.name;
      if (nameToLookup) {
        const normalized = normalizeForProfileLookup(nameToLookup);
        const profile = externalProfiles[normalized];
        if (profile) {
          return {
            ...show,
            djBio: profile.bio,
            djPhotoUrl: profile.photoUrl,
            djUsername: profile.username,
          };
        }
      }
    }

    return show;
  });
}

export async function GET() {
  try {
    const shows = await getAllShows();

    // Enrich shows with DJ profiles using Admin SDK
    const enrichedShows = await enrichShowsWithDJProfiles(shows);

    return NextResponse.json({ shows: enrichedShows });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
