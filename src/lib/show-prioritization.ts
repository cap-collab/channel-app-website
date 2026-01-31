import { Show } from '@/types';

/**
 * Show recurrence priority levels:
 * - weekly/bi-weekly (highest priority)
 * - monthly
 * - others (lowest priority)
 */
function getRecurrencePriority(type: string | undefined): number {
  if (!type) return 0;
  const typeLower = type.toLowerCase();
  if (typeLower === 'weekly' || typeLower === 'bi-weekly' || typeLower === 'biweekly') {
    return 3; // Highest priority
  }
  if (typeLower === 'monthly') {
    return 2;
  }
  return 1; // Other types (one-off, etc.)
}

interface ScoredShow<T> {
  item: T;
  recurrencePriority: number;
  stationId?: string;
  location?: string;
}

/**
 * Prioritizes shows by:
 * 1. Weekly/bi-weekly recurring shows first
 * 2. Monthly recurring shows second
 * 3. Others last
 * 4. Within each tier, diversifies by station and location
 *
 * @param shows - Array of shows to prioritize
 * @param getShowType - Function to extract the show type from an item
 * @param getStationId - Function to extract station ID from an item
 * @param getLocation - Optional function to extract location from an item
 * @param limit - Maximum number of shows to return
 * @returns Prioritized and diversified array of shows
 */
export function prioritizeShows<T>(
  shows: T[],
  getShowType: (item: T) => string | undefined,
  getStationId: (item: T) => string | undefined,
  getLocation?: (item: T) => string | undefined,
  limit?: number
): T[] {
  if (shows.length === 0) return [];

  // Score each show by recurrence priority
  const scoredShows: ScoredShow<T>[] = shows.map((item) => ({
    item,
    recurrencePriority: getRecurrencePriority(getShowType(item)),
    stationId: getStationId(item),
    location: getLocation?.(item),
  }));

  // Group shows by recurrence priority tier
  const tiers = new Map<number, ScoredShow<T>[]>();
  for (const show of scoredShows) {
    const tier = show.recurrencePriority;
    if (!tiers.has(tier)) {
      tiers.set(tier, []);
    }
    tiers.get(tier)!.push(show);
  }

  // Process each tier with diversity, starting with highest priority
  const result: T[] = [];
  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => b - a); // Descending

  for (const tierKey of sortedTierKeys) {
    const tierShows = tiers.get(tierKey)!;
    const diversified = diversifyByStationAndLocation(tierShows);
    result.push(...diversified.map((s) => s.item));
  }

  return limit ? result.slice(0, limit) : result;
}

/**
 * Diversifies shows within a tier by selecting shows with different stations and locations.
 * Uses a round-robin approach to ensure variety.
 */
function diversifyByStationAndLocation<T>(shows: ScoredShow<T>[]): ScoredShow<T>[] {
  if (shows.length <= 1) return shows;

  const result: ScoredShow<T>[] = [];
  const remaining = [...shows];
  const usedStations = new Set<string>();
  const usedLocations = new Set<string>();

  while (remaining.length > 0) {
    // Find the best candidate that maximizes diversity
    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      const show = remaining[i];
      let diversityScore = 0;

      // Prefer shows from stations we haven't used yet
      if (show.stationId && !usedStations.has(show.stationId)) {
        diversityScore += 2;
      }

      // Prefer shows from locations we haven't used yet
      if (show.location && !usedLocations.has(show.location)) {
        diversityScore += 1;
      }

      // If all stations/locations are already used, prefer shows with different ones
      // from the most recent addition
      if (diversityScore > bestScore) {
        bestScore = diversityScore;
        bestIndex = i;
      }
    }

    const selected = remaining.splice(bestIndex, 1)[0];
    result.push(selected);

    // Track used stations and locations
    if (selected.stationId) {
      usedStations.add(selected.stationId);
    }
    if (selected.location) {
      usedLocations.add(selected.location);
    }

    // Reset tracking after we've covered all unique values to allow re-use
    // This helps when we have more shows than unique stations/locations
    const uniqueStations = new Set(remaining.map((s) => s.stationId).filter(Boolean));
    const uniqueLocations = new Set(remaining.map((s) => s.location).filter(Boolean));

    if (uniqueStations.size > 0 && usedStations.size >= uniqueStations.size + result.length) {
      usedStations.clear();
    }
    if (uniqueLocations.size > 0 && usedLocations.size >= uniqueLocations.size + result.length) {
      usedLocations.clear();
    }
  }

  return result;
}

/**
 * Applies prioritization to an already-filtered array of Show objects.
 * Convenience wrapper for the common case.
 */
export function prioritizeShowArray(shows: Show[], limit?: number): Show[] {
  return prioritizeShows(
    shows,
    (show) => show.type,
    (show) => show.stationId,
    (show) => show.djLocation,
    limit
  );
}
