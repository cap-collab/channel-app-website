import { describe, it, expect } from "vitest";
import { scoreCandidate } from "./scoring";
import { DEFAULT_RECOMMENDATION_CONFIG } from "./config";
import { normalizeArchive } from "./normalize";
import type { CandidateInput, ContentItem } from "./types";
import { archiveById, NOW_MS } from "./__fixtures__/fake-content";

const DAY = 24 * 60 * 60 * 1000;

function candidate(over: Partial<CandidateInput> & { item: ContentItem }): CandidateInput {
  return {
    alreadyStreamedCount: 0,
    matchedEngagedDjs: [],
    matchedWatchlistDjs: [],
    isAffiliated: false,
    sceneTempoMatch: false,
    matchedScenes: [],
    matchedTempo: null,
    matchesSelfTaste: false,
    ...over,
  };
}

const cfg = DEFAULT_RECOMMENDATION_CONFIG;

describe("scoreCandidate", () => {
  it("is deterministic", () => {
    const c = candidate({ item: normalizeArchive(archiveById("a-maria-new")), matchedEngagedDjs: ["maria"] });
    const a = scoreCandidate(c, cfg, NOW_MS);
    const b = scoreCandidate(c, cfg, NOW_MS);
    expect(a).toEqual(b);
  });

  it("scoreBreakdown contributions sum to score", () => {
    const c = candidate({
      item: normalizeArchive(archiveById("a-maria-new")),
      matchedEngagedDjs: ["maria"],
      alreadyStreamedCount: 4,
    });
    const r = scoreCandidate(c, cfg, NOW_MS);
    const sum = r.scoreBreakdown.reduce((s, x) => s + x.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 9);
  });

  it("already-heard penalty halves at count where 1+count*strength doubles", () => {
    const item = normalizeArchive(archiveById("a-maria-new"));
    const base = scoreCandidate(candidate({ item, matchedEngagedDjs: ["maria"], alreadyStreamedCount: 0 }), cfg, NOW_MS);
    // strength=1 → count=1 gives damper 1/2 of base.
    const once = scoreCandidate(candidate({ item, matchedEngagedDjs: ["maria"], alreadyStreamedCount: 1 }), cfg, NOW_MS);
    expect(once.score).toBeCloseTo(base.score / 2, 9);
  });

  it("recency decays by half-life and clamps to 0 outside the window", () => {
    // An archive exactly halfLifeDays old → recency raw ≈ 0.5.
    const halfLifeOld: ContentItem = {
      ...normalizeArchive(archiveById("a-stranger-cold")),
      recordedAtMs: NOW_MS - cfg.recency.halfLifeDays * DAY,
    };
    const r = scoreCandidate(candidate({ item: halfLifeOld }), cfg, NOW_MS);
    const rec = r.scoreBreakdown.find((x) => x.name === "recency")!;
    expect(rec.rawValue).toBeCloseTo(0.5, 6);

    const stale: ContentItem = {
      ...halfLifeOld,
      recordedAtMs: NOW_MS - (cfg.recency.windowDays + 10) * DAY,
    };
    const r2 = scoreCandidate(candidate({ item: stale }), cfg, NOW_MS);
    expect(r2.scoreBreakdown.find((x) => x.name === "recency")!.rawValue).toBe(0);
  });

  it("featured outranks medium on priority component", () => {
    const featured = scoreCandidate(candidate({ item: normalizeArchive(archiveById("a-stranger-cold")) }), cfg, NOW_MS);
    const medium = scoreCandidate(candidate({ item: normalizeArchive(archiveById("a-maria-old")) }), cfg, NOW_MS);
    const fp = featured.scoreBreakdown.find((x) => x.name === "priority")!.rawValue;
    const mp = medium.scoreBreakdown.find((x) => x.name === "priority")!.rawValue;
    expect(fp).toBeGreaterThan(mp);
  });

  it("reasons are never empty and reflect the section", () => {
    const fav = scoreCandidate(
      candidate({ item: normalizeArchive(archiveById("a-maria-new")), matchedEngagedDjs: ["maria"] }),
      cfg,
      NOW_MS,
    );
    expect(fav.section).toBe("favorite-artists");
    expect(fav.reasons[0]).toContain("Maria");

    const disc = scoreCandidate(
      candidate({
        item: normalizeArchive(archiveById("a-stranger-scene")),
        sceneTempoMatch: true,
        matchedScenes: ["spiral"],
        matchedTempo: "uptempo",
      }),
      cfg,
      NOW_MS,
    );
    expect(disc.section).toBe("discovery");
    // §2 scene+tempo band: "More {scene} {tempo}".
    expect(disc.reasons[0]).toBe("More spiral uptempo");

    const cold = scoreCandidate(candidate({ item: normalizeArchive(archiveById("a-stranger-cold")) }), cfg, NOW_MS);
    expect(cold.section).toBeNull();
    expect(cold.reasons.length).toBeGreaterThan(0);
  });
});
