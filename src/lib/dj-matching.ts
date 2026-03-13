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
 * Extracted name with matching strategy.
 * exact=true: require full normalized name match (for structured patterns like "w/", "Presents")
 * exact=false: use word boundary match (for ambiguous patterns like " - ")
 */
type ExtractedName = { name: string; exact: boolean };

/**
 * Extract potential DJ names from a show name string.
 * Handles common formats like:
 * - "Host w/ Guest" or "Host with Guest" (both host and guest, exact match)
 * - "DJ Presents: Show Name" (presenter, exact match)
 * - "DJ Name - Show Name" (both sides, word boundary match)
 */
export function extractDJNamesFromShowName(showName: string): ExtractedName[] {
  const candidates: ExtractedName[] = [];

  // Format: "Host w/ Guest" or "Host with Guest"
  // Extract BOTH host (before w/) and guest (after w/) as exact-match candidates
  const wMatch = showName.match(/^(.+?)\s+w(?:ith)?\/?\s+(.+)$/i);
  if (wMatch) {
    candidates.push({ name: wMatch[1].trim(), exact: true }); // host
    candidates.push({ name: wMatch[2].trim(), exact: true }); // guest
  }

  // Format: "DJ Presents: Show Name" or "DJ Presents Show Name"
  const presentsMatch = showName.match(/^(.+?)\s+presents?:?\s+.+$/i);
  if (presentsMatch) {
    candidates.push({ name: presentsMatch[1].trim(), exact: true });
  }

  // Format: "Something - Something" (could be either order)
  if (!wMatch && !presentsMatch && showName.includes(" - ")) {
    const parts = showName.split(" - ");
    if (parts.length === 2) {
      const left = parts[0].trim();
      const right = parts[1].trim();

      // Check if left side has multiple DJs separated by "and" or "&"
      // e.g. "Daddy Differently and Dirty Dave" → exact-match each individually
      const andPattern = /\s+(?:and|&)\s+/i;
      if (andPattern.test(left)) {
        left.split(andPattern).forEach((name) => {
          const trimmed = name.trim();
          if (trimmed) candidates.push({ name: trimmed, exact: true });
        });
      } else {
        candidates.push({ name: left, exact: false });
      }

      candidates.push({ name: right, exact: false });
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

  // 3. Check extracted DJ names from show name patterns
  const extractedNames = extractDJNamesFromShowName(show.name);
  if (extractedNames.length > 0) {
    for (const { name: extracted, exact } of extractedNames) {
      if (exact) {
        // For structured patterns (w/, presents), require exact name match
        if (normalizeName(extracted) === normalizeName(searchTerm)) {
          return true;
        }
      } else {
        // For ambiguous patterns (dash), keep word boundary match
        if (wordBoundaryMatch(extracted, searchTerm)) {
          return true;
        }
      }
    }
  } else {
    // No structured pattern found — fall back to raw show name match
    if (wordBoundaryMatch(show.name, searchTerm)) {
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
