/**
 * Featured scene×tempo matrix — the logged-out /scene "Start here" grid, also
 * reused as the empty-state fallback for the weekly recommendation email.
 *
 * For each (tempo row, scene column) cell, pick the LATEST eligible archive of
 * that scene + tempo, emitted in row-major order so a 2-col grid lays out
 * correctly. Pure over already-fetched archive docs (no I/O).
 */

import type { Archive, ArchiveSerialized, Tempo } from "@/types/broadcast";
import { normalizeArchive } from "./normalize";
import { priorityRank } from "@/lib/archive-priority";
import { DEFAULT_RECOMMENDATION_CONFIG } from "./config";

// Full tempo + scene order (the logged-out grid uses all of these).
export const FEATURED_TEMPO_ORDER: Tempo[] = ["downtempo", "uptempo", "very_slow", "very_fast"];
export const FEATURED_SCENE_ORDER = ["spiral", "star"];

export interface FeaturedMatrixOpts {
  // Tempos to drop from the grid (e.g. ["very_fast"] = exclude "Intense").
  excludeTempos?: Tempo[];
}

/**
 * Build the latest-per-(scene×tempo) matrix from raw archive docs. Returns full
 * ArchiveSerialized rows in row-major order (left=spiral, right=star). With the
 * default orders and no exclusions that's up to 8 cells; excluding very_fast
 * yields up to 6.
 */
export function buildFeaturedMatrix(
  docs: ArchiveSerialized[],
  opts: FeaturedMatrixOpts = {},
): ArchiveSerialized[] {
  const exclude = new Set(opts.excludeTempos ?? []);
  const tempos = FEATURED_TEMPO_ORDER.filter((t) => !exclude.has(t));

  const fullById = new Map<string, ArchiveSerialized>();
  const items = docs.map((doc) => {
    fullById.set(doc.id, doc);
    return normalizeArchive(doc as unknown as Archive);
  });

  const minDur = DEFAULT_RECOMMENDATION_CONFIG.eligibility.minDurationSec;
  // Highest PRIORITY first (featured > high > medium > low), recency as the
  // tiebreaker — so each scene×tempo cell shows our best archive, not merely the
  // most recent. id is the final deterministic tie-break.
  const eligible = items
    .filter((it) => it.isPublic && it.durationSec >= minDur && it.priority !== "hidden")
    .sort((a, b) => {
      const pa = priorityRank(a.priority);
      const pb = priorityRank(b.priority);
      if (pa !== pb) return pa - pb;
      if (b.recordedAtMs !== a.recordedAtMs) return b.recordedAtMs - a.recordedAtMs;
      return a.id < b.id ? -1 : 1;
    });

  const pickLatest = (scene: string, tempo: Tempo) =>
    eligible.find((it) => it.tempo === tempo && it.sceneSlugs.includes(scene));

  const out: ArchiveSerialized[] = [];
  for (const tempo of tempos) {
    for (const scene of FEATURED_SCENE_ORDER) {
      const pick = pickLatest(scene, tempo);
      if (pick) {
        const full = fullById.get(pick.id);
        if (full) out.push(full);
      }
    }
  }
  return out;
}
