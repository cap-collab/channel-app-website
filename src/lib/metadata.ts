import { MetadataResponse, Show, ShowV2 } from "@/types";
import { getStationByMetadataKey } from "./stations";

const METADATA_URL = "https://cap-collab.github.io/channel-metadata/metadata.json";
const NEWTOWN_SCHEDULE_URL = "https://newtownradio.com/weekly-schedule/";

// Cache for metadata
let cachedMetadata: MetadataResponse | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Cache for Newtown recovery fetch
let newtownRecoveryCache: Show[] | null = null;
let newtownRecoveryCacheTimestamp: number = 0;
const NEWTOWN_RECOVERY_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Phantom shows to skip (stale Google Calendar entries)
const NEWTOWN_PHANTOM_SHOWS = new Set([
  "stretches with will shanks",
  "cymatic salad",
  "..dash",
]);

export async function fetchMetadata(): Promise<MetadataResponse> {
  const now = Date.now();

  // Return cached data if still valid
  if (cachedMetadata && now - cacheTimestamp < CACHE_DURATION) {
    return cachedMetadata;
  }

  try {
    const response = await fetch(METADATA_URL, {
      next: { revalidate: 300 }, // ISR: revalidate every 5 minutes
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }

    const data: MetadataResponse = await response.json();
    cachedMetadata = data;
    cacheTimestamp = now;

    return data;
  } catch (error) {
    console.error("Error fetching metadata:", error);
    // Return cached data if fetch fails
    if (cachedMetadata) {
      return cachedMetadata;
    }
    throw error;
  }
}

/**
 * Decode HTML entities in a string
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#039;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity);
}

/**
 * Recovery fetch for Newtown Radio - scrapes directly from their website
 * Called when GitHub metadata has 0 Newtown shows (due to IP blocking in GitHub Actions)
 */
async function fetchNewtownDirectly(): Promise<Show[]> {
  const now = Date.now();

  // Return cached data if still valid
  if (newtownRecoveryCache && now - newtownRecoveryCacheTimestamp < NEWTOWN_RECOVERY_CACHE_DURATION) {
    console.log("[Newtown Recovery] Using cached data");
    return newtownRecoveryCache;
  }

  console.log("[Newtown Recovery] Fetching directly from newtownradio.com...");

  try {
    const response = await fetch(NEWTOWN_SCHEDULE_URL, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const shows: Show[] = [];

    // Extract show titles from simcal-event-title spans
    const titlePattern = /<span class="simcal-event-title"[^>]*>([^<]+)<\/span>/gi;
    const titles: string[] = [];
    let titleMatch;
    while ((titleMatch = titlePattern.exec(html)) !== null) {
      titles.push(decodeHtmlEntities(titleMatch[1].trim()));
    }

    // Extract start times from content attributes
    const startPattern = /simcal-event-start-time"[^>]*content="([^"]+)"/gi;
    const startTimes: string[] = [];
    let startMatch;
    while ((startMatch = startPattern.exec(html)) !== null) {
      startTimes.push(startMatch[1]);
    }

    // Extract end times from content attributes
    const endPattern = /simcal-event-end-time"[^>]*content="([^"]+)"/gi;
    const endTimes: string[] = [];
    let endMatch;
    while ((endMatch = endPattern.exec(html)) !== null) {
      endTimes.push(endMatch[1]);
    }

    console.log(`[Newtown Recovery] Found ${titles.length} titles, ${startTimes.length} start times, ${endTimes.length} end times`);

    // Match titles with times (they should be in same order)
    const minCount = Math.min(titles.length, startTimes.length, endTimes.length);

    for (let i = 0; i < minCount; i++) {
      const title = titles[i];
      const startISO = startTimes[i];
      const endISO = endTimes[i];

      // Skip phantom shows
      if (NEWTOWN_PHANTOM_SHOWS.has(title.toLowerCase())) {
        continue;
      }

      // Parse ISO 8601 dates
      const startDate = new Date(startISO);
      const endDate = new Date(endISO);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        continue;
      }

      shows.push({
        id: `newtown-${startDate.toISOString()}`,
        name: title,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        stationId: "newtown",
        type: title.toUpperCase() === "OPEN" ? "playlist" : undefined,
      });
    }

    // Sort by start time
    shows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    console.log(`[Newtown Recovery] Parsed ${shows.length} shows`);

    // Cache the result
    newtownRecoveryCache = shows;
    newtownRecoveryCacheTimestamp = now;

    return shows;
  } catch (error) {
    console.error("[Newtown Recovery] Failed:", error);
    // Return cached data if available
    if (newtownRecoveryCache) {
      return newtownRecoveryCache;
    }
    return [];
  }
}

// Convert V2 show format to full Show object
function expandShow(show: ShowV2, stationMetadataKey: string): Show {
  const station = getStationByMetadataKey(stationMetadataKey);
  const stationId = station?.id || stationMetadataKey;

  return {
    id: `${stationId}-${show.s}`,
    name: show.n,
    startTime: show.s,
    endTime: show.e,
    description: show.d || undefined,
    dj: show.j || undefined,
    imageUrl: show.u || undefined,
    stationId,
    type: show.t || undefined,
  };
}

// Get all shows for all stations
export async function getAllShows(): Promise<Show[]> {
  const metadata = await fetchMetadata();
  const shows: Show[] = [];

  for (const [stationKey, stationShows] of Object.entries(metadata.stations)) {
    for (const show of stationShows) {
      shows.push(expandShow(show, stationKey));
    }
  }

  // Recovery: If Newtown has no show playing NOW, fetch directly from the source
  // This handles the case where GitHub Actions gets blocked by Newtown's website
  const now = new Date();
  const newtownShows = shows.filter((s) => s.stationId === "newtown");
  const hasCurrentNewtownShow = newtownShows.some((show) => {
    const start = new Date(show.startTime);
    const end = new Date(show.endTime);
    return start <= now && end > now;
  });

  if (!hasCurrentNewtownShow) {
    console.log("[Metadata] No current Newtown show, triggering recovery fetch...");
    try {
      const recoveredShows = await fetchNewtownDirectly();
      // Remove any existing Newtown shows and replace with recovered ones
      const nonNewtownShows = shows.filter((s) => s.stationId !== "newtown");
      shows.length = 0;
      shows.push(...nonNewtownShows, ...recoveredShows);
    } catch (error) {
      console.error("[Metadata] Newtown recovery fetch failed:", error);
    }
  }

  return shows.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

// Get shows for a specific station
export async function getShowsForStation(stationMetadataKey: string): Promise<Show[]> {
  const metadata = await fetchMetadata();
  const stationShows = metadata.stations[stationMetadataKey] || [];

  // Recovery: If requesting Newtown and no show is playing NOW, fetch directly
  if (stationMetadataKey === "newtown") {
    const now = new Date();
    const expandedShows = stationShows.map((show) => expandShow(show, stationMetadataKey));
    const hasCurrentShow = expandedShows.some((show) => {
      const start = new Date(show.startTime);
      const end = new Date(show.endTime);
      return start <= now && end > now;
    });

    if (!hasCurrentShow) {
      console.log("[Metadata] No current Newtown show, triggering recovery fetch...");
      try {
        return await fetchNewtownDirectly();
      } catch (error) {
        console.error("[Metadata] Newtown recovery fetch failed:", error);
        return expandedShows;
      }
    }
    return expandedShows.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  return stationShows
    .map((show) => expandShow(show, stationMetadataKey))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

// Get shows for a specific date
export async function getShowsForDate(date: Date): Promise<Show[]> {
  const shows = await getAllShows();

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return shows.filter((show) => {
    const showStart = new Date(show.startTime);
    const showEnd = new Date(show.endTime);

    // Show overlaps with this day
    return showStart < endOfDay && showEnd > startOfDay;
  });
}

// Get currently airing shows
export async function getCurrentShows(): Promise<Show[]> {
  const shows = await getAllShows();
  const now = new Date();

  return shows.filter((show) => {
    const showStart = new Date(show.startTime);
    const showEnd = new Date(show.endTime);
    return showStart <= now && showEnd > now;
  });
}

// Search shows by name or DJ
export async function searchShows(query: string): Promise<Show[]> {
  const shows = await getAllShows();
  const lowerQuery = query.toLowerCase();

  return shows.filter((show) => {
    const nameMatch = show.name.toLowerCase().includes(lowerQuery);
    const djMatch = show.dj?.toLowerCase().includes(lowerQuery);
    return nameMatch || djMatch;
  });
}

// Check if a show matches any favorited terms
export function showMatchesFavorites(show: Show, favorites: string[]): boolean {
  const lowerFavorites = favorites.map((f) => f.toLowerCase());

  const nameMatch = lowerFavorites.some(
    (fav) =>
      show.name.toLowerCase().includes(fav) || fav.includes(show.name.toLowerCase())
  );

  const djMatch =
    show.dj &&
    lowerFavorites.some(
      (fav) =>
        show.dj!.toLowerCase().includes(fav) || fav.includes(show.dj!.toLowerCase())
    );

  return nameMatch || !!djMatch;
}
