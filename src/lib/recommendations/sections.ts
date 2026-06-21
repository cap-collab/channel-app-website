/**
 * Section assignment — pure.
 *
 * Decides which of the two archive-based sections a candidate belongs to:
 *   - "favorite-artists": archive's DJ is engaged-with OR on the watchlist.
 *   - "discovery":        NOT favorite-artists, AND (affiliated/crew DJ OR
 *                         scene+tempo the user engaged with).
 *   - null:               no personalized tie → eligible only as fallback-fill.
 *
 * Section 1 wins over Section 2. "coming-up" is not assigned here — it's
 * scheduled shows from the go-live matcher, handled in the I/O layer.
 */

import type { CandidateInput, SectionId } from "./types";

export function assignSection(input: CandidateInput): SectionId | null {
  if (input.matchedEngagedDjs.length > 0 || input.matchedWatchlistDjs.length > 0) {
    return "favorite-artists";
  }
  if (input.isAffiliated || input.sceneTempoMatch) {
    return "discovery";
  }
  return null;
}
