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

// Count words in a string
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Extract all candidate names for profile lookup from a show
// Returns deduplicated names in priority order
function extractCandidateNames(show: Show): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (name: string | undefined) => {
    if (!name) return;
    const trimmed = name.trim();
    const normalized = normalizeForProfileLookup(trimmed);
    if (normalized.length >= 2 && !seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(trimmed);
    }
  };

  // 1. Direct dj field
  addCandidate(show.dj);

  // 2. Show name as-is
  addCandidate(show.name);

  // 3. Hyphen pattern: "X - Y" → try Y first, then X
  if (show.name.includes(' - ')) {
    const parts = show.name.split(' - ');
    if (parts.length >= 2) {
      addCandidate(parts[1].trim());
      addCandidate(parts[0].trim());
    }
  }

  // 4. "w/" pattern: "X w/ Y" → try Y first, then X
  const wMatch = show.name.match(/^(.+?)\s+w\/\s+(.+)$/i);
  if (wMatch) {
    addCandidate(wMatch[2].trim());
    addCandidate(wMatch[1].trim());
  }

  // 5. "X Presents Y" pattern: "Geologist Presents: The O'Brien System" → try X first (DJ), then Y
  const presentsMatch = show.name.match(/^(.+?)\s+presents?:?\s+(.+)$/i);
  if (presentsMatch) {
    addCandidate(presentsMatch[1].trim());  // Before "Presents" (likely DJ name)
    addCandidate(presentsMatch[2].trim());  // After "Presents" (show/episode name)
  }

  // 6. "invite/invité/presents/present" pattern in dj field or show name → try part after
  // Handles cases like "Presents DJ Name" or "Invité Special Guest"
  const invitePattern = /^(invit[eé]s?|presents?)\s+(.+)$/i;
  const djInviteMatch = show.dj?.match(invitePattern);
  if (djInviteMatch) {
    addCandidate(djInviteMatch[2].trim());
  }
  const nameInviteMatch = show.name.match(invitePattern);
  if (nameInviteMatch) {
    addCandidate(nameInviteMatch[2].trim());
  }

  // 7. Colon pattern: "X : Y" → try Y first, then X
  if (show.name.includes(' : ')) {
    const parts = show.name.split(' : ');
    if (parts.length >= 2) {
      addCandidate(parts[1].trim());
      addCandidate(parts[0].trim());
    }
  }

  return candidates;
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
      // Extract all candidate names using unified pattern matching
      const candidates = extractCandidateNames(show);
      for (const name of candidates) {
        const normalized = normalizeForProfileLookup(name);
        if (normalized.length >= 2 && !externalDjNames.has(normalized)) {
          externalDjNames.set(normalized, name);
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
  const externalProfiles: Record<string, { bio?: string; photoUrl?: string; username?: string; djName?: string; genres?: string[] }> = {};

  const externalPromises = Array.from(externalDjNames.keys()).map(async (normalized) => {
    try {
      const doc = await adminDb.collection("pending-dj-profiles").doc(normalized).get();
      if (doc.exists) {
        const data = doc.data();
        const djProfile = data?.djProfile as { bio?: string; photoUrl?: string; genres?: string[] } | undefined;
        externalProfiles[normalized] = {
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          username: data?.chatUsernameNormalized || data?.chatUsername || undefined,
          djName: data?.djName || undefined,
          genres: djProfile?.genres || undefined,
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
      // Try all candidate names in priority order until a profile is found
      const candidates = extractCandidateNames(show);

      for (const name of candidates) {
        const normalized = normalizeForProfileLookup(name);
        const profile = externalProfiles[normalized];

        if (profile) {
          // Determine DJ name to display:
          // 1. dublab: always use part before hyphen
          // 2. Others: use profile.djName, or show name if ≤2 words
          let djName: string | undefined;
          if (show.stationId === "dublab" && show.name.includes(' - ')) {
            djName = show.name.split(' - ')[0].trim();
          } else if (profile.djName) {
            djName = profile.djName;
          } else if (countWords(show.name) <= 2) {
            djName = show.name;
          }

          return {
            ...show,
            dj: djName || show.dj,
            djBio: profile.bio,
            djPhotoUrl: profile.photoUrl,
            djUsername: profile.username,
            djGenres: profile.genres,
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
