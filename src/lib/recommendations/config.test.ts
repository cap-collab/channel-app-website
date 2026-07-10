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

  it("has the rationalized pillar weights + affiliationBoost", () => {
    const w = DEFAULT_RECOMMENDATION_CONFIG.weights;
    // Three pillars equal at max 2 (priorityRaw tops at 2 × w1).
    expect(w.priority).toBe(1);
    expect(w.affiliationBoost).toBe(2);
    expect(w.sceneTempoAffinity).toBe(2);
  });

  it("has favoritesRecency defaults, and mergeConfig preserves siblings", () => {
    const fr = DEFAULT_RECOMMENDATION_CONFIG.favoritesRecency;
    expect(fr.engagementHalfLifeDays).toBe(30);
    expect(fr.releaseFreshnessWeight).toBe(0.5);
    expect(fr.ownCrewDefaultDays).toBe(30);
    const merged = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, {
      favoritesRecency: { engagementHalfLifeDays: 45 },
    });
    expect(merged.favoritesRecency.engagementHalfLifeDays).toBe(45);
    expect(merged.favoritesRecency.releaseFreshnessWeight).toBe(0.5); // sibling preserved
    expect(merged.weights.affiliationBoost).toBe(2); // unrelated sibling preserved
  });
});
