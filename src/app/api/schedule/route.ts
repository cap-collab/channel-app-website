import { NextResponse } from "next/server";
import { getAllShows } from "@/lib/metadata";
import { getAdminDb } from "@/lib/firebase-admin";
import { Show, IRLShowData } from "@/types";

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
  // Also handles en-dash (–) and em-dash (—) which some stations use
  const hyphenMatch = show.name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (hyphenMatch) {
    addCandidate(hyphenMatch[2].trim());
    addCandidate(hyphenMatch[1].trim());
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

  // Also collect djUsername values from all shows (metadata-defined profiles)
  // These take priority - when a show has djUsername, we ALWAYS use that profile's info
  shows.forEach((show) => {
    if (show.djUsername) {
      const normalized = normalizeForProfileLookup(show.djUsername);
      if (normalized.length >= 2 && !externalDjNames.has(normalized)) {
        externalDjNames.set(normalized, show.djUsername);
      }
    }
  });

  // Fetch broadcast DJ profiles from users collection
  const djProfiles: Record<string, { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string }> = {};

  const broadcastPromises = Array.from(djUserIds).map(async (userId) => {
    try {
      const userDoc = await adminDb.collection("users").doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; promoText?: string; promoHyperlink?: string; location?: string } | undefined;
        if (djProfile) {
          djProfiles[userId] = {
            bio: djProfile.bio || undefined,
            photoUrl: djProfile.photoUrl || undefined,
            promoText: djProfile.promoText || undefined,
            promoHyperlink: djProfile.promoHyperlink || undefined,
            location: djProfile.location || undefined,
          };
        }
      }
    } catch (err) {
      console.error(`[API /schedule] Failed to fetch DJ profile for ${userId}:`, err);
    }
  });

  // Fetch external DJ profiles from pending-dj-profiles AND users collections
  const externalProfiles: Record<string, { bio?: string; photoUrl?: string; username?: string; djName?: string; genres?: string[]; location?: string }> = {};

  const externalPromises = Array.from(externalDjNames.keys()).map(async (normalized) => {
    try {
      // First try users collection (claimed profiles have priority - more complete data)
      const usersSnapshot = await adminDb
        .collection("users")
        .where("chatUsernameNormalized", "==", normalized)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        const userDoc = usersSnapshot.docs[0];
        const userData = userDoc.data();
        const djProfile = userData?.djProfile as { bio?: string; photoUrl?: string; genres?: string[]; location?: string } | undefined;
        externalProfiles[normalized] = {
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          username: userData?.chatUsernameNormalized || userData?.chatUsername || undefined,
          djName: userData?.chatUsername || undefined,
          genres: djProfile?.genres || undefined,
          location: djProfile?.location || undefined,
        };
        return;
      }

      // Fall back to pending-dj-profiles collection (auto-generated profiles)
      const pendingDoc = await adminDb.collection("pending-dj-profiles").doc(normalized).get();
      if (pendingDoc.exists) {
        const data = pendingDoc.data();
        const djProfile = data?.djProfile as { bio?: string; photoUrl?: string; genres?: string[]; location?: string } | undefined;
        externalProfiles[normalized] = {
          bio: djProfile?.bio || undefined,
          photoUrl: djProfile?.photoUrl || undefined,
          username: data?.chatUsernameNormalized || data?.chatUsername || undefined,
          djName: data?.djName || undefined,
          genres: djProfile?.genres || undefined,
          location: djProfile?.location || undefined,
        };
      }
    } catch {
      // Silently ignore errors for external profiles
    }
  });

  await Promise.all([...broadcastPromises, ...externalPromises]);

  // Debug: log what profiles we fetched
  console.log(`[API /schedule] Fetched ${Object.keys(externalProfiles).length} external profiles:`, Object.keys(externalProfiles).slice(0, 20));

  // Enrich shows with DJ profile data
  return shows.map((show) => {
    // PRIORITY 1: If show has djUsername from metadata, ALWAYS use that profile's info
    // This takes precedence over everything else - the linked profile is the source of truth
    if (show.djUsername) {
      const normalized = normalizeForProfileLookup(show.djUsername);
      const profile = externalProfiles[normalized];

      // Debug logging for specific profiles
      if (normalized === "dorwand" || normalized === "bambi") {
        console.log(`[API /schedule] Looking up ${normalized}: profile found = ${!!profile}, photoUrl = ${profile?.photoUrl}`);
      }

      if (profile) {
        return {
          ...show,
          dj: profile.djName || show.dj,  // Profile name takes priority
          djBio: profile.bio,
          djPhotoUrl: profile.photoUrl,
          djUsername: profile.username || show.djUsername,  // Preserve djUsername for profile links
          djGenres: profile.genres,
          djLocation: profile.location,
        };
      }
      // If no profile found but djUsername exists, keep the show as-is (djUsername preserved via ...show)
    }

    // PRIORITY 2: Broadcast shows - use users collection
    if (show.stationId === "broadcast" && show.djUserId) {
      const profile = djProfiles[show.djUserId];
      if (profile) {
        return {
          ...show,
          djBio: show.djBio || profile.bio,
          djPhotoUrl: show.djPhotoUrl || profile.photoUrl,
          promoText: show.promoText || profile.promoText,
          promoUrl: show.promoUrl || profile.promoHyperlink,
          djLocation: profile.location,
        };
      }
    }

    // PRIORITY 3: External radio shows - use pending-dj-profiles collection matching
    // Skip dj-radio shows as they already have all profile data from fetchDJRadioShows
    if (show.stationId !== "broadcast" && show.stationId !== "newtown" && show.stationId !== "dj-radio") {
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
          if (show.stationId === "dublab" && /\s+[-–—]\s+/.test(show.name)) {
            djName = show.name.split(/\s+[-–—]\s+/)[0].trim();
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
            djUsername: profile.username || show.djUsername || normalized,  // Use normalized lookup key as fallback for profile URL
            djGenres: profile.genres,
            djLocation: profile.location,
          };
        }
      }
    }

    return show;
  });
}

// Fetch IRL shows from DJ profiles
async function fetchIRLShows(): Promise<IRLShowData[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping IRL shows");
    return [];
  }

  try {
    // Query all users with DJ role who might have IRL shows
    const usersSnapshot = await adminDb
      .collection("users")
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .get();

    const irlShows: IRLShowData[] = [];
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const djProfile = userData?.djProfile;
      const chatUsername = userData?.chatUsername;

      if (!djProfile?.irlShows || !Array.isArray(djProfile.irlShows)) {
        return;
      }

      // Skip system/admin accounts without proper DJ profiles for IRL shows
      // These accounts shouldn't have their IRL shows displayed publicly
      if (!chatUsername || !djProfile.photoUrl) {
        return;
      }

      // Filter to upcoming shows only
      for (const show of djProfile.irlShows) {
        // Skip if no date (URL is optional - some events don't have ticket links)
        if (!show.date) continue;

        // Skip past shows (compare ISO date strings)
        if (show.date < today) continue;

        irlShows.push({
          djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase() || "",
          djName: chatUsername || "Unknown DJ",
          djPhotoUrl: djProfile.photoUrl || undefined,
          djLocation: djProfile.location || undefined,
          djGenres: djProfile.genres || undefined,
          eventName: show.name || "Event",
          location: show.location || "",
          ticketUrl: show.url,
          date: show.date,
        });
      }
    });

    // Sort by date ascending
    irlShows.sort((a, b) => a.date.localeCompare(b.date));

    // Deduplicate: keep only one IRL show per DJ per location (the soonest one)
    // This prevents the same DJ from appearing multiple times in the same city
    const deduped: IRLShowData[] = [];
    const seen = new Set<string>();
    for (const show of irlShows) {
      const key = `${show.djUsername}-${show.location.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(show);
      }
    }

    return deduped;
  } catch (error) {
    console.error("[API /schedule] Error fetching IRL shows:", error);
    return [];
  }
}

// Fetch radio shows from DJ profiles (DJ-added upcoming radio appearances)
async function fetchDJRadioShows(): Promise<Show[]> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[API /schedule] Admin SDK not available, skipping DJ radio shows");
    return [];
  }

  try {
    // Query all users with DJ role who might have radio shows
    const usersSnapshot = await adminDb
      .collection("users")
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .get();

    const radioShows: Show[] = [];
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const djProfile = userData?.djProfile;
      const chatUsername = userData?.chatUsername;
      const userEmail = userData?.email;

      if (!djProfile?.radioShows || !Array.isArray(djProfile.radioShows)) {
        return;
      }

      // Filter to upcoming shows only
      for (const show of djProfile.radioShows) {
        // Skip if no date (radio name and other fields are optional)
        if (!show.date) continue;

        // Skip past shows (compare ISO date strings)
        if (show.date < today) continue;

        // Create a unique ID that won't collide with other shows
        // Include the show name to differentiate from external shows with same DJ
        const showNameSlug = (show.name || "").replace(/\s+/g, "-").toLowerCase().slice(0, 20);
        const radioNameSlug = (show.radioName || "radio").replace(/\s+/g, "-").toLowerCase();
        const showId = `dj-radio-${chatUsername?.replace(/\s+/g, "").toLowerCase()}-${show.date}-${radioNameSlug}-${showNameSlug}`;

        // Parse date and time to create start/end times
        // Use the DJ's timezone if available, otherwise default to America/Los_Angeles
        const timezone = show.timezone || "America/Los_Angeles";
        const timeStr = show.time || "12:00"; // Default to noon if no time
        const [hours, minutes] = timeStr.split(":").map(Number);

        // Create ISO string with the time, then adjust for timezone
        // We need to find what UTC time corresponds to this local time
        const localDateTime = `${show.date}T${String(hours || 0).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}:00`;

        // Get timezone offset for this specific date/time
        // Create a date assuming UTC, then see what local time that produces in the target timezone
        const testDate = new Date(localDateTime + "Z");
        const localStr = testDate.toLocaleString("en-US", { timeZone: timezone, hour12: false });
        const localMatch = localStr.match(/(\d+):(\d+):(\d+)/);
        const localHour = localMatch ? parseInt(localMatch[1]) : hours || 0;

        // Calculate offset: if UTC 09:00 shows as 01:00 local, offset is -8 hours
        // So to get 09:00 local, we need 17:00 UTC (add 8 hours)
        let offsetHours = (hours || 0) - localHour;
        // Handle day wraparound
        if (offsetHours > 12) offsetHours -= 24;
        if (offsetHours < -12) offsetHours += 24;

        const startTimeMs = testDate.getTime() + (offsetHours * 60 * 60 * 1000);
        const startTime = new Date(startTimeMs).toISOString();

        // Use duration from show, default to 1 hour
        const durationHours = parseFloat(show.duration) || 1;
        const endTime = new Date(startTimeMs + durationHours * 60 * 60 * 1000).toISOString();

        // Build show name - use provided name, or construct from DJ and radio
        const showName = show.name || (show.radioName ? `${chatUsername} on ${show.radioName}` : `${chatUsername} Radio Show`);

        radioShows.push({
          id: showId,
          name: showName,
          dj: chatUsername || "Unknown DJ",
          startTime,
          endTime,
          stationId: "dj-radio", // Special station ID for DJ-added radio shows
          djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase(),
          djPhotoUrl: djProfile.photoUrl || undefined,
          djLocation: djProfile.location || undefined,
          djGenres: djProfile.genres || undefined,
          djEmail: userEmail || undefined, // Include email for prioritization
          // Store additional info for display
          description: show.url ? `Listen at: ${show.url}` : undefined,
          // Custom fields for DJ radio shows
          imageUrl: djProfile.photoUrl || undefined,
        });
      }
    });

    // Sort by date ascending
    radioShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    return radioShows;
  } catch (error) {
    console.error("[API /schedule] Error fetching DJ radio shows:", error);
    return [];
  }
}

export async function GET() {
  try {
    // Fetch shows, IRL shows, and DJ radio shows in parallel
    const [shows, irlShows, djRadioShows] = await Promise.all([
      getAllShows(),
      fetchIRLShows(),
      fetchDJRadioShows(),
    ]);

    // Merge DJ radio shows into the main shows array
    const allShows = [...shows, ...djRadioShows];

    // Enrich shows with DJ profiles using Admin SDK
    const enrichedShows = await enrichShowsWithDJProfiles(allShows);

    return NextResponse.json({ shows: enrichedShows, irlShows });
  } catch (error) {
    console.error("[API /schedule] Error fetching shows:", error);
    return NextResponse.json({ shows: [], irlShows: [], error: "Failed to fetch shows" }, { status: 500 });
  }
}
