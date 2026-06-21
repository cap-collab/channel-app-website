import { describe, it, expect } from "vitest";
import { generateRecommendations } from "./engine";
import { normalizeArchive, normalizeUser, type AffiliationLookup } from "./normalize";
import { mergeConfig, DEFAULT_RECOMMENDATION_CONFIG } from "./config";
import type { ContentItem, RecommendationResult, SectionId } from "./types";
import { FAKE_ARCHIVES, NOW_MS } from "./__fixtures__/fake-content";
import {
  USER_MARIA_FAN,
  USER_WATCHLIST_ONLY,
  USER_NEW,
  USER_HEAVY,
  type FakeUser,
} from "./__fixtures__/fake-users";

function items(): ContentItem[] {
  return FAKE_ARCHIVES.map(normalizeArchive);
}
function itemMap() {
  const m = new Map<string, ContentItem>();
  for (const i of items()) m.set(i.id, i);
  return m;
}

// Maria's crew (luke, ninka) bridges to a user who engaged with Maria.
const MARIA_CREW_AFFILIATION: AffiliationLookup = {
  relatedDisplayByDjUsername: new Map([
    ["luke", "Maria"],
    ["ninka", "Maria"],
  ]),
};

function run(
  user: FakeUser,
  affiliation: AffiliationLookup = { relatedDisplayByDjUsername: new Map() },
  configOverride: unknown = {},
): RecommendationResult {
  const signals = normalizeUser({
    uid: user.uid,
    email: user.email,
    loveHistory: user.loveHistory,
    streamHistory: user.streamHistory,
    searchFavorites: user.searchFavorites,
    archiveById: itemMap(),
    goLiveMutes: user.goLiveMutes,
    ownDjUsername: user.ownDjUsername,
  });
  const config = mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, configOverride);
  return generateRecommendations(signals, items(), affiliation, config, {
    context: "website",
    nowMs: NOW_MS,
  });
}

function section(r: RecommendationResult, id: SectionId) {
  return r.sections.find((s) => s.id === id)!;
}
function ids(r: RecommendationResult, id: SectionId) {
  return section(r, id).items.map((i) => i.item.id);
}

describe("generateRecommendations — sections", () => {
  it("Maria fan: her shows in favorite-artists, crew/scene in discovery", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const fav = ids(r, "favorite-artists");
    expect(fav).toContain("a-maria-new");
    expect(fav).toContain("a-maria-old");

    const disc = ids(r, "discovery");
    // luke + ninka (crew) and stranger-scene (spiral+uptempo) qualify.
    expect(disc).toContain("a-luke-new");
    expect(disc).toContain("a-ninka-new");
    expect(disc).toContain("a-stranger-scene");
    // Maria's own shows are NOT duplicated into discovery.
    expect(disc).not.toContain("a-maria-new");
  });

  it("watchlist-only user: watchlisted artist lands in favorite-artists", () => {
    const r = run(USER_WATCHLIST_ONLY);
    // searched "Ninka" → ninka archive is a favorite-artist.
    expect(ids(r, "favorite-artists")).toContain("a-ninka-new");
  });

  it("excludes hidden, too-short, private, and stale archives everywhere", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const all = [...ids(r, "favorite-artists"), ...ids(r, "discovery")];
    expect(all).not.toContain("a-hidden");
    expect(all).not.toContain("a-short");
    expect(all).not.toContain("a-private");
    expect(all).not.toContain("a-stale"); // outside recency window
    // and they're reported with reasons in dropped (except stale, filtered pre-rules)
    const droppedReasons = new Set(r.dropped.map((d) => d.excludedReason));
    expect(droppedReasons.has("hidden priority")).toBe(true);
    expect(droppedReasons.has("too short")).toBe(true);
    expect(droppedReasons.has("not public")).toBe(true);
  });

  it("brand-new user gets EMPTY favorite-artists (no engagement → no padding)", () => {
    const r = run(USER_NEW);
    const fav = section(r, "favorite-artists");
    // No favorites/engagement → favorite-artists must stay empty (not filled).
    expect(fav.items.length).toBe(0);
    // discovery may still fallback-fill for cold-start discovery.
    const disc = section(r, "discovery");
    expect(disc.items.length).toBeGreaterThanOrEqual(0);
  });

  it("user WITH favorites but few new shows gets favorite-artists fallback-filled", () => {
    // Maria fan: has engagement, so favorite-artists is fallback-eligible.
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION, { minimums: { "favorite-artists": 6, discovery: 2, "coming-up": 0 } });
    const fav = section(r, "favorite-artists");
    // 2 real Maria shows + fallback to reach the minimum.
    expect(fav.items.some((i) => i.isFallback)).toBe(true);
  });

  it("ranks are contiguous 1..N within each section", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    for (const s of r.sections) {
      s.items.forEach((it, i) => expect(it.rank).toBe(i + 1));
    }
  });

  it("is deterministic: identical inputs → identical output", () => {
    const a = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const b = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("always emits the coming-up section (empty, filled by I/O layer)", () => {
    const r = run(USER_NEW);
    const cu = section(r, "coming-up");
    expect(cu).toBeDefined();
    expect(cu.items).toEqual([]);
  });
});

describe("generateRecommendations — diversity & already-heard", () => {
  it("caps per DJ within a section", () => {
    // maxPerDj=1 → only one Maria archive in favorite-artists.
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION, { diversity: { maxPerDj: 1 } });
    const mariaCount = ids(r, "favorite-artists").filter((id) => id.startsWith("a-maria")).length;
    expect(mariaCount).toBe(1);
  });

  it("heavy listener's most-streamed archive is penalized below the fresh one", () => {
    const r = run(USER_HEAVY, MARIA_CREW_AFFILIATION);
    const fav = section(r, "favorite-artists").items;
    const newIdx = fav.findIndex((i) => i.item.id === "a-maria-new"); // streamed 50x
    const oldIdx = fav.findIndex((i) => i.item.id === "a-maria-old"); // streamed 1x
    expect(newIdx).toBeGreaterThan(-1);
    expect(oldIdx).toBeGreaterThan(-1);
    // Despite a-maria-new being featured + newer, 50 streams push it below old.
    expect(oldIdx).toBeLessThan(newIdx);
  });
});

describe("generateRecommendations — editorial", () => {
  it("suppress drops an archive everywhere with a reason", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION, {
      editorial: { suppressArchiveIds: ["a-maria-new"] },
    });
    expect(ids(r, "favorite-artists")).not.toContain("a-maria-new");
    expect(r.dropped.some((d) => d.item.id === "a-maria-new" && d.excludedReason === "editorially suppressed")).toBe(true);
  });

  it("feature pins an archive to the top of its section", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION, {
      editorial: { featureArchiveIds: ["a-maria-old"] },
    });
    const fav = section(r, "favorite-artists").items;
    expect(fav[0].item.id).toBe("a-maria-old");
    expect(fav[0].pinned).toBe(true);
  });

  it("boost lifts an archive's score and rank", () => {
    const base = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const baseDisc = ids(base, "discovery");
    const boosted = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION, {
      editorial: { boostArchiveIds: { "a-ninka-new": 10 } },
    });
    const boostedDisc = ids(boosted, "discovery");
    const baseRank = baseDisc.indexOf("a-ninka-new");
    const boostedRank = boostedDisc.indexOf("a-ninka-new");
    expect(boostedRank).toBeLessThan(baseRank);
  });
});
