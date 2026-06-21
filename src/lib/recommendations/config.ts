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
  weights: {
    priority: 3, // editorial priority tier dominates ordering within a section
    recency: 1.2,
    sectionBonus: 1,
    selfTasteBoost: 2, // DJ user's own scene/tempo lifts matching discovery picks
  },
  recency: {
    halfLifeDays: 14,
    windowDays: 60, // only archives from the last 60 days are candidates
  },
  alreadyHeard: {
    penaltyStrength: 1, // score /= (1 + count) — the house base/(1+recent) shape
  },
  diversity: {
    maxPerDj: 2,
  },
  caps: {
    website: {
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
    discovery: 2,
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
  minRegenIntervalMs: 48 * 60 * 60 * 1000, // 48h global freshness floor
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
