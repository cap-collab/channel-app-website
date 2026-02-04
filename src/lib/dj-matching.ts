/**
 * DJ Name Matching Utilities
 *
 * Word boundary matching for DJ names to external radio shows.
 * "PAC" matches "PAC" or "Night Pac" but NOT "pace" or "space".
 */

/**
 * Normalize a name for comparison (lowercase, trim)
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Check if searchTerm appears as a whole word in text (word boundary match).
 * Case-insensitive.
 *
 * Examples with searchTerm "PAC":
 * - "PAC" -> true
 * - "Night Pac" -> true
 * - "Show w/ PAC" -> true
 * - "pace" -> false
 * - "space" -> false
 */
export function wordBoundaryMatch(text: string, searchTerm: string): boolean {
  const normalizedText = normalizeName(text);
  const normalizedTerm = normalizeName(searchTerm);

  if (!normalizedTerm) return false;

  // Escape special regex characters in the search term
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Word boundary regex: term must be surrounded by word boundaries
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(normalizedText);
}

/**
 * Extract potential DJ names from a show name string.
 * Handles common formats like:
 * - "Show Name w/ DJ Name"
 * - "DJ Name - Show Name"
 * - "Show Name - DJ Name"
 * - "Show Name with DJ Name"
 */
export function extractDJNamesFromShowName(showName: string): string[] {
  const candidates: string[] = [];

  // Format: "Show Name w/ DJ Name" or "Show Name with DJ Name"
  const wMatch = showName.match(/\bw(?:ith)?\/?\s+(.+)$/i);
  if (wMatch) {
    candidates.push(wMatch[1].trim());
  }

  // Format: "Something - Something" (could be either order)
  if (showName.includes(" - ")) {
    const parts = showName.split(" - ");
    if (parts.length === 2) {
      candidates.push(parts[0].trim());
      candidates.push(parts[1].trim());
    }
  }

  return candidates;
}

/**
 * Check if a show matches a DJ search term using word boundary matching.
 * Checks: djUsername, dj field, and extracted names from show name.
 */
export function showMatchesDJ(
  show: { dj?: string; djUsername?: string; name: string },
  searchTerm: string
): boolean {
  // 1. Check djUsername (word boundary match)
  if (show.djUsername && wordBoundaryMatch(show.djUsername, searchTerm)) {
    return true;
  }

  // 2. Check DJ field (word boundary match)
  if (show.dj && wordBoundaryMatch(show.dj, searchTerm)) {
    return true;
  }

  // 3. Check show name directly (word boundary match)
  if (wordBoundaryMatch(show.name, searchTerm)) {
    return true;
  }

  // 4. Check extracted DJ names from show name patterns
  const extractedNames = extractDJNamesFromShowName(show.name);
  for (const extracted of extractedNames) {
    if (wordBoundaryMatch(extracted, searchTerm)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a show matches any of the given DJ search terms.
 * Returns the matching search term, or undefined if no match.
 */
export function showMatchesAnyDJ(
  show: { dj?: string; djUsername?: string; name: string },
  searchTerms: string[]
): string | undefined {
  for (const term of searchTerms) {
    if (showMatchesDJ(show, term)) {
      return term;
    }
  }
  return undefined;
}

/**
 * Check if an IRL show matches a DJ search term using word boundary matching.
 */
export function irlShowMatchesDJ(
  irlShow: { djName: string; djUsername?: string },
  searchTerm: string
): boolean {
  // Check djUsername
  if (irlShow.djUsername && wordBoundaryMatch(irlShow.djUsername, searchTerm)) {
    return true;
  }

  // Check djName
  if (wordBoundaryMatch(irlShow.djName, searchTerm)) {
    return true;
  }

  return false;
}

/**
 * Check if an IRL show matches any of the given DJ search terms.
 * Returns the matching search term, or undefined if no match.
 */
export function irlShowMatchesAnyDJ(
  irlShow: { djName: string; djUsername?: string },
  searchTerms: string[]
): string | undefined {
  for (const term of searchTerms) {
    if (irlShowMatchesDJ(irlShow, term)) {
      return term;
    }
  }
  return undefined;
}
