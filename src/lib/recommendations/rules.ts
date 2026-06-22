/**
 * Rule engine — pure.
 *
 * Takes scored candidates and produces the final two archive-based sections
 * (favorite-artists, discovery). Order of operations, all driven by config:
 *   1. Hard exclusions (hidden, not-public, too-short, suppressed, muted DJ, own show)
 *   2. Editorial multipliers (boost archive / DJ)
 *   3. Sort by score; deterministic tie-break by archive id
 *   4. Per-DJ diversity cap within a section
 *   5. Editorial feature/pin to the top of the item's section
 *   6. Fallback-fill personalized sections below their minimum
 *   7. Per-section top-N cap; assign ranks
 *
 * No rng — ties break on a stable string compare of archive id. Excluded
 * candidates are returned in `dropped` (with excludedReason) for admin preview.
 */

import { priorityIsHigh } from "@/lib/archive-priority";
import type {
  RecommendationConfig,
  ScoredCandidate,
  SectionId,
  RecommendationSection,
} from "./types";
import { SECTION_TITLES } from "./types";

const ARCHIVE_SECTIONS: SectionId[] = ["favorite-artists", "discovery"];

export interface ApplyRulesResult {
  sections: RecommendationSection[];
  dropped: ScoredCandidate[];
}

export function applyRules(
  scored: ScoredCandidate[],
  config: RecommendationConfig,
  context: keyof RecommendationConfig["caps"],
  user: {
    goLiveMutes: Set<string>;
    ownDjUsername?: string;
    // Sections that may be fallback-filled when short. favorite-artists is
    // only included when the user actually has favorites/engagement — a user
    // with no taste gets an EMPTY favorite-artists section, not padding.
    fallbackSections: Set<SectionId>;
  },
): ApplyRulesResult {
  const dropped: ScoredCandidate[] = [];
  const kept: ScoredCandidate[] = [];

  // 1. Hard exclusions.
  const suppress = new Set(config.editorial.suppressArchiveIds);
  for (const c of scored) {
    const reason = exclusionReason(c, config, suppress, user);
    if (reason) {
      dropped.push({ ...c, excludedReason: reason });
    } else {
      kept.push(c);
    }
  }

  // 2. Editorial multipliers (mutate a copy's score + breakdown).
  const boosted = kept.map((c) => applyEditorialBoost(c, config));

  // Split into the personalized sections vs the fallback pool (section === null).
  const bySection = new Map<SectionId, ScoredCandidate[]>();
  for (const s of ARCHIVE_SECTIONS) bySection.set(s, []);
  const fallbackPool: ScoredCandidate[] = [];
  for (const c of boosted) {
    if (c.section && bySection.has(c.section)) bySection.get(c.section)!.push(c);
    else fallbackPool.push(c);
  }

  const featureOrder = new Map<string, number>();
  config.editorial.featureArchiveIds.forEach((id, i) => featureOrder.set(id, i));

  const sections: RecommendationSection[] = ARCHIVE_SECTIONS.map((sectionId) => {
    const candidates = bySection.get(sectionId)!;

    // 3. Sort. Discovery uses STRICT tiers (1→4); within a tier, score desc.
    //    Other sections: score desc with id tie-break.
    if (sectionId === "discovery") {
      candidates.sort((a, b) => {
        const ta = a.discoveryTier ?? 99;
        const tb = b.discoveryTier ?? 99;
        if (ta !== tb) return ta - tb;
        if (b.score !== a.score) return b.score - a.score;
        return a.item.id < b.item.id ? -1 : 1;
      });
    } else {
      sortByScoreThenId(candidates);
    }

    // 5 (pinned set aside) + 4 (diversity over the rest).
    const pinned = candidates.filter((c) => featureOrder.has(c.item.id));
    pinned.sort((a, b) => (featureOrder.get(a.item.id)! - featureOrder.get(b.item.id)!));
    const rest = candidates.filter((c) => !featureOrder.has(c.item.id));

    const diversified = capPerDj(rest, config.diversity.maxPerDj);

    // 6. Fallback-fill if below the section minimum.
    const cap = config.caps[context][sectionId];
    let assembled = [
      ...pinned.map((c) => ({ ...c, pinned: true })),
      ...diversified,
    ];
    // Section-specific collapse (pre-cap, post-sort so we keep the best):
    //  - favorite-artists: at most ONE archive per artist (the latest/highest).
    //  - discovery: at most ONE archive per (scene+tempo) combo.
    assembled = collapseSection(sectionId, assembled);

    const minimum = config.minimums[sectionId];
    if (user.fallbackSections.has(sectionId) && assembled.length < minimum) {
      const need = Math.min(cap, minimum) - assembled.length;
      if (need > 0) {
        // Fallback respects the same collapse so we don't reintroduce dupes.
        const existing = assembled;
        const fill = takeFallback(fallbackPool, need, existing, config.diversity.maxPerDj);
        assembled = collapseSection(sectionId, [...existing, ...fill]);
      }
    }

    // 7. Cap + rank.
    const final = assembled.slice(0, cap).map((c, i) => ({ ...c, rank: i + 1 }));

    return { id: sectionId, title: SECTION_TITLES[sectionId], items: final };
  });

  return { sections, dropped };
}

// Collapse a section to one representative per group. Pinned (editorially
// featured) items ALWAYS survive and occupy their group, so an admin pin can't
// be collapsed away by a newer/higher sibling.
//  - favorite-artists: one per artist = the artist's LATEST recording (by
//    recordedAtMs, not score); artists ordered by latest-recording date.
//  - discovery: NO per-combo collapse — ordered by score (scene+tempo affinity
//    dominates), so the user's most-engaged combo can contribute more than one.
//    The per-DJ cap + the section cap keep it from being monotonous.
function collapseSection(sectionId: SectionId, items: ScoredCandidate[]): ScoredCandidate[] {
  if (sectionId === "favorite-artists") {
    return latestPerArtist(items);
  }
  return items;
}

const artistKey = (c: ScoredCandidate) => c.item.djUsernames[0] ?? c.item.id;

// One archive per artist = their newest recording (pinned wins its artist
// outright). Artists ordered by their kept archive's recording date, freshest
// first. Deterministic (id tie-break).
function latestPerArtist(items: ScoredCandidate[]): ScoredCandidate[] {
  const byArtist = new Map<string, ScoredCandidate>();
  for (const c of items) {
    const k = artistKey(c);
    const cur = byArtist.get(k);
    if (!cur) {
      byArtist.set(k, c);
      continue;
    }
    if (cur.pinned && !c.pinned) continue; // pin holds the slot
    if (!cur.pinned && c.pinned) {
      byArtist.set(k, c); // pin takes over
      continue;
    }
    // Same pin status → keep the later recording (id tie-break).
    if (
      c.item.recordedAtMs > cur.item.recordedAtMs ||
      (c.item.recordedAtMs === cur.item.recordedAtMs && c.item.id < cur.item.id)
    ) {
      byArtist.set(k, c);
    }
  }
  return Array.from(byArtist.values()).sort((a, b) => {
    // Pinned artists float to the top (in feature order via the upstream sort);
    // otherwise freshest-recording artist first.
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (b.item.recordedAtMs !== a.item.recordedAtMs) return b.item.recordedAtMs - a.item.recordedAtMs;
    return a.item.id < b.item.id ? -1 : 1;
  });
}

function exclusionReason(
  c: ScoredCandidate,
  config: RecommendationConfig,
  suppress: Set<string>,
  user: { goLiveMutes: Set<string>; ownDjUsername?: string },
): string | null {
  const { item } = c;
  if (item.priority === "hidden") return "hidden priority";
  if (config.eligibility.requirePublic && !item.isPublic) return "not public";
  if (item.durationSec < config.eligibility.minDurationSec) return "too short";
  if (suppress.has(item.id)) return "editorially suppressed";
  if (item.djUsernames.some((u) => user.goLiveMutes.has(u))) return "muted DJ";
  if (user.ownDjUsername && item.djUsernames.includes(user.ownDjUsername)) return "your own show";
  return null;
}

function applyEditorialBoost(c: ScoredCandidate, config: RecommendationConfig): ScoredCandidate {
  let m = 1;
  const archiveBoost = config.editorial.boostArchiveIds[c.item.id];
  if (typeof archiveBoost === "number") m *= archiveBoost;
  let djMax = 1;
  for (const u of c.item.djUsernames) {
    const b = config.editorial.boostDjUsernames[u];
    if (typeof b === "number" && b > djMax) djMax = b;
  }
  m *= djMax;
  if (m === 1) return c;

  const boostedScore = c.score * m;
  const reasons = m > 1 ? [...c.reasons, "Boosted by editor"] : c.reasons;
  return {
    ...c,
    score: boostedScore,
    editorialMultiplier: m,
    reasons,
    scoreBreakdown: [
      ...c.scoreBreakdown,
      {
        name: "editorialBoost",
        rawValue: m,
        weight: 1,
        contribution: boostedScore - c.score,
      },
    ],
  };
}

// Stable sort: score desc, then archive id asc (deterministic tie-break).
function sortByScoreThenId(arr: ScoredCandidate[]): void {
  arr.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
}

// Greedy per-DJ cap by primary DJ username. Input must be pre-sorted.
function capPerDj(sorted: ScoredCandidate[], maxPerDj: number): ScoredCandidate[] {
  const counts = new Map<string, number>();
  const out: ScoredCandidate[] = [];
  for (const c of sorted) {
    const dj = c.item.djUsernames[0] ?? "";
    const n = counts.get(dj) ?? 0;
    if (n >= maxPerDj) continue;
    counts.set(dj, n + 1);
    out.push(c);
  }
  return out;
}

// Pull fallback items (featured/high, recency-eligible, unheard) honoring the
// per-DJ cap across the already-assembled section. Pre-sorted by score then id.
function takeFallback(
  pool: ScoredCandidate[],
  need: number,
  alreadyIn: ScoredCandidate[],
  maxPerDj: number,
): ScoredCandidate[] {
  const eligible = pool.filter((c) => priorityIsHigh(c.item.priority) || c.item.priority === "featured");
  sortByScoreThenId(eligible);

  const counts = new Map<string, number>();
  for (const c of alreadyIn) {
    const dj = c.item.djUsernames[0] ?? "";
    counts.set(dj, (counts.get(dj) ?? 0) + 1);
  }
  const seen = new Set(alreadyIn.map((c) => c.item.id));
  const out: ScoredCandidate[] = [];
  for (const c of eligible) {
    if (out.length >= need) break;
    if (seen.has(c.item.id)) continue;
    const dj = c.item.djUsernames[0] ?? "";
    const n = counts.get(dj) ?? 0;
    if (n >= maxPerDj) continue;
    counts.set(dj, n + 1);
    out.push({ ...c, isFallback: true, reasons: ["Popular on Channel"] });
  }
  return out;
}
