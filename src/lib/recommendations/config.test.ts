import { describe, it, expect } from "vitest";
import { DEFAULT_RECOMMENDATION_CONFIG, mergeConfig } from "./config";

describe("mergeConfig", () => {
  it("returns base unchanged when overrides is not an object", () => {
    expect(mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, undefined)).toEqual(
      DEFAULT_RECOMMENDATION_CONFIG,
    );
    expect(mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, null)).toEqual(
      DEFAULT_RECOMMENDATION_CONFIG,
    );
  });

  it("deep-merges nested objects", () => {
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      weights: { priority: 5 },
    });
    expect(merged.weights.priority).toBe(5);
    // sibling weights preserved from defaults
    expect(merged.weights.recency).toBe(DEFAULT_RECOMMENDATION_CONFIG.weights.recency);
  });

  it("replaces arrays wholesale (editorial lists)", () => {
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      editorial: { suppressArchiveIds: ["a", "b"] },
    });
    expect(merged.editorial.suppressArchiveIds).toEqual(["a", "b"]);
    // other editorial fields kept
    expect(merged.editorial.boostArchiveIds).toEqual({});
  });

  it("merges record-of-multipliers", () => {
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      editorial: { boostDjUsernames: { maria: 2 } },
    });
    expect(merged.editorial.boostDjUsernames).toEqual({ maria: 2 });
  });

  it("does not mutate the base config", () => {
    const before = JSON.stringify(DEFAULT_RECOMMENDATION_CONFIG);
    mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, { weights: { priority: 99 } });
    expect(JSON.stringify(DEFAULT_RECOMMENDATION_CONFIG)).toBe(before);
  });

  it("overrides per-context caps", () => {
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      caps: { website: { discovery: 12 } },
    });
    expect(merged.caps.website.discovery).toBe(12);
    expect(merged.caps.website["favorite-artists"]).toBe(
      DEFAULT_RECOMMENDATION_CONFIG.caps.website["favorite-artists"],
    );
    expect(merged.caps["weekly-email"]).toEqual(
      DEFAULT_RECOMMENDATION_CONFIG.caps["weekly-email"],
    );
  });

  it("has a 24h default freshness floor", () => {
    expect(DEFAULT_RECOMMENDATION_CONFIG.minRegenIntervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it("weights: taste dominates, affiliation is a tiebreak", () => {
    const w = DEFAULT_RECOMMENDATION_CONFIG.weights;
    expect(w.priority).toBe(1); // priorityRaw tops at 2 → bump 2
    expect(w.sceneTempoAffinity).toBe(3); // dominant taste signal
    expect(w.affiliationBoost).toBe(1); // tiebreak, below taste + priority
    expect(w.sceneTempoAffinity).toBeGreaterThan(w.affiliationBoost);
  });

  it("mergeConfig preserves unrelated sibling weights on a partial override", () => {
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      weights: { sceneTempoAffinity: 5 },
    });
    expect(merged.weights.sceneTempoAffinity).toBe(5);
    expect(merged.weights.affiliationBoost).toBe(1); // sibling preserved
    expect(merged.weights.priority).toBe(1); // sibling preserved
  });
});
