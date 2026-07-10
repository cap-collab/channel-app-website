/**
 * Recommendation config: defaults + a pure deep-merge of admin overrides.
 *
 * DEFAULT_RECOMMENDATION_CONFIG is the source of truth. The Firestore doc
 * app-config/recommendations holds only a PARTIAL override; mergeConfig layers
 * it on top. Nothing in scoring/rules is hardcoded — it all reads from here.
 */

import type { RecommendationConfig } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  version: 1,
  // Rationalized small-int weights: the THREE PILLARS are equal at max 2 —
  // priority (raw 2/1 x w1), affiliationBoost (w2), sceneTempoAffinity (0..1 x w2).
  // recency/selfTaste are smaller nudges. Only ratios matter (score has no
  // absolute meaning). Discovery ranks by the summed score (no rigid tiers).
  weights: {
    priority: 1, // priorityRaw is 2 (featured/high) / 1 (medium/low) → bump 2 or 1
    recency: 0.5, // small freshness nudge
    sectionBonus: 1,
    sceneTempoAffinity: 3, // DOMINANT taste signal — the user's engaged scene+tempo leads discovery
    selfTasteBoost: 1, // DJ user's own scene/tempo lifts matching discovery picks
    affiliationBoost: 1, // crew/audience-borrow (binary): a TIEBREAK, not a driver — surfaces crew
    // content but only lifts it above equal non-crew, never above a stronger taste match.
  },
  recency: {
    halfLifeDays: 14,
    windowDays: 60, // only archives from the last 60 days are candidates
  },
  alreadyHeard: {
    penaltyStrength: 1, // score /= (1 + count) — the house base/(1+recent) shape
  },
  unengagedIntense: {
    // An Intense (very_fast) archive is damped to 50% when the user has never
    // engaged with Intense — a mild nudge so their real scenes/tempos rank
    // above it, without hiding Intense entirely. Only Intense is penalized.
    penaltyFactor: 0.5,
  },
  diversity: {
    maxPerDj: 2,
  },
  caps: {
    website: {
      // Show 4, pre-load 4 extra so removing a card reveals the next-best
      // already-loaded item (the UI slices to 4).
      "favorite-artists": 8,
      discovery: 8,
      "coming-up": 8,
      "start-here": 8,
    },
    "weekly-email": {
      "favorite-artists": 4,
      discovery: 4,
      "coming-up": 5,
      "start-here": 6,
    },
  },
  minimums: {
    "favorite-artists": 2,
    // Fill discovery ("In Your Scene") up to 8 from the taste-scored fallback
    // pool so a thin user still sees a full section of their OWN scene/tempo
    // matches (not featured filler). Capped by context: website cap 8 → fills to
    // 8; weekly-email cap 4 → fills to 4 (then the email slices to its top 3).
    discovery: 8,
    "coming-up": 0, // never fallback-filled — it's scheduled shows, not archives
    "start-here": 0, // built directly from featured-per-type, no fallback
  },
  eligibility: {
    minDurationSec: 300, // 5 min
    requirePublic: true,
  },
  editorial: {
    boostArchiveIds: {},
    boostDjUsernames: {},
    suppressArchiveIds: [],
    featureArchiveIds: [],
  },
  minRegenIntervalMs: 24 * 60 * 60 * 1000, // 24h freshness floor: /scene serves
  // the stored snapshot and only lazily regenerates a user whose snapshot is
  // older than this when they return. The email cron persists a fresh snapshot
  // for everyone on each run (the bulk refresh).
};

// Deep object literal check (not arrays, not null).
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `overrides` over `base`. Plain objects merge recursively; arrays
 * and scalars are replaced wholesale (so editorial lists are replaced, not
 * concatenated). Pure and deterministic — never mutates its inputs.
 */
export function mergeConfig(
  base: RecommendationConfig,
  overrides: unknown,
): RecommendationConfig {
  if (!isPlainObject(overrides)) return base;
  return deepMerge(base, overrides) as RecommendationConfig;
}

function deepMerge(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) {
    // Arrays/scalars (or type mismatch): override wins wholesale.
    return over === undefined ? base : over;
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(over)) {
    const o = over[key];
    if (o === undefined) continue;
    out[key] = key in base ? deepMerge(base[key], o) : o;
  }
  return out;
}

// Re-export so callers don't need a second import for the day constant.
export { DAY_MS };
