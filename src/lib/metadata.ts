import { MetadataResponse, Show, ShowV2 } from "@/types";
import { getStationByMetadataKey } from "./stations";

const METADATA_URL = "https://cap-collab.github.io/channel-metadata/metadata.json";

// Cache for metadata
let cachedMetadata: MetadataResponse | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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

  return shows.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

// Get shows for a specific station
export async function getShowsForStation(stationMetadataKey: string): Promise<Show[]> {
  const metadata = await fetchMetadata();
  const stationShows = metadata.stations[stationMetadataKey] || [];

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
