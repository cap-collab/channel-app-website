/**
 * Section assignment — pure.
 *
 * Decides which of the two archive-based sections a candidate belongs to:
 *   - "favorite-artists": archive's DJ is engaged-with OR on the watchlist.
 *   - "discovery":        NOT favorite-artists, AND (affiliated/crew DJ OR
 *                         scene+tempo the user engaged with).
 *   - null:               no personalized tie → eligible only as fallback-fill.
 *
 * Scene+tempo is a WEAK signal, so a scene+tempo match only qualifies for
 * discovery when the archive is high/featured (we only surface our best content
 * via taste-matching). A crew/affiliation match is a stronger DJ-relationship
 * signal and qualifies at any eligible priority.
 *
 * Section 1 wins over Section 2. "coming-up" is not assigned here — it's
 * scheduled shows from the go-live matcher, handled in the I/O layer.
 */

import { priorityIsHigh } from "@/lib/archive-priority";
import type { CandidateInput, SectionId } from "./types";

export function assignSection(input: CandidateInput): SectionId | null {
  if (input.matchedEngagedDjs.length > 0 || input.matchedWatchlistDjs.length > 0) {
    return "favorite-artists";
  }
  // scene+tempo discovery: high/featured only. crew/affiliation: any priority.
  const sceneTempoQualifies = input.sceneTempoMatch && priorityIsHigh(input.item.priority);
  if (input.isAffiliated || sceneTempoQualifies) {
    return "discovery";
  }
  return null;
}
