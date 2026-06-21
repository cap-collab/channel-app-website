/**
 * "Start here" selection — pure.
 *
 * The cold-start / logged-out pick: the latest FEATURED (or high) archive per
 * (scene+tempo) combo. Used by:
 *   - engine.ts (cold-start section for a no-taste user), and
 *   - GET /api/recommendations/featured (public, logged-out grid).
 *
 * No user, no scoring needed — just eligibility + recency. Deterministic.
 */

import type { ContentItem } from "./types";

export interface StartHereOptions {
  minDurationSec: number;
  requirePublic: boolean;
  recencyWindowMs?: number; // if set, exclude archives older than nowMs - window
  nowMs?: number;
  cap: number;
}

// One featured/high archive per (scene+tempo) combo, latest recording first.
export function pickStartHereItems(items: ContentItem[], opts: StartHereOptions): ContentItem[] {
  const cutoff =
    opts.recencyWindowMs != null && opts.nowMs != null ? opts.nowMs - opts.recencyWindowMs : -Infinity;

  const eligible = items.filter(
    (it) =>
      (it.priority === "featured" || it.priority === "high") &&
      (!opts.requirePublic || it.isPublic) &&
      it.durationSec >= opts.minDurationSec &&
      it.recordedAtMs >= cutoff,
  );

  // Latest recording first; id tie-break for determinism.
  eligible.sort((a, b) =>
    b.recordedAtMs !== a.recordedAtMs ? b.recordedAtMs - a.recordedAtMs : a.id < b.id ? -1 : 1,
  );

  const seen = new Set<string>();
  const picks: ContentItem[] = [];
  for (const it of eligible) {
    const key = `${it.sceneSlugs[0] ?? ""}|${it.tempo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(it);
    if (picks.length >= opts.cap) break;
  }
  return picks;
}
