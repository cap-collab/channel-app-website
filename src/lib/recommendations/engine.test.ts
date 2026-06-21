import { describe, it, expect } from "vitest";
import { generateRecommendations } from "./engine";
import { normalizeArchive, normalizeUser, type AffiliationLookup } from "./normalize";
import { mergeConfig, DEFAULT_RECOMMENDATION_CONFIG } from "./config";
import type { ContentItem, RecommendationResult, SectionId } from "./types";
import { FAKE_ARCHIVES, NOW_MS, archiveById } from "./__fixtures__/fake-content";
import {
  USER_MARIA_FAN,
  USER_WATCHLIST_ONLY,
  USER_NEW,
  USER_HEAVY,
  type FakeUser,
} from "./__fixtures__/fake-users";

function items(): ContentItem[] {
  return FAKE_ARCHIVES.map((a) => normalizeArchive(a));
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
  ownArchiveIds: string[] = [],
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
    ownArchives: ownArchiveIds.map((id) => normalizeArchive(archiveById(id))),
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
  it("Maria fan: ONE latest Maria archive in favorite-artists, crew/scene in discovery", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const fav = ids(r, "favorite-artists");
    // favorite-artists = latest archive PER ARTIST → exactly one Maria archive.
    const mariaInFav = fav.filter((id) => id.startsWith("a-maria"));
    expect(mariaInFav.length).toBe(1);
    // No stranger padding ever.
    expect(fav).not.toContain("a-stranger-cold");

    const disc = ids(r, "discovery");
    // crew + scene+tempo qualify, but discovery is 1 per (scene+tempo) combo.
    expect(disc.length).toBeGreaterThan(0);
    // Maria's own shows are NOT duplicated into discovery.
    expect(disc).not.toContain("a-maria-new");
  });

  it("discovery shows at most one archive per (scene+tempo) combo", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const disc = section(r, "discovery").items;
    const combos = disc.map((i) => `${i.item.sceneSlugs[0] ?? ""}|${i.item.tempo ?? ""}`);
    expect(new Set(combos).size).toBe(combos.length); // every combo unique
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

  it("brand-new user gets ONLY a 'Start here' section (replaces all others)", () => {
    const r = run(USER_NEW);
    // No taste of any kind → single start-here section, nothing else.
    expect(r.sections.map((s) => s.id)).toEqual(["start-here"]);
    const start = r.sections[0];
    expect(start.items.length).toBeGreaterThan(0);
    // One featured/high archive per (scene+tempo) combo.
    const combos = start.items.map((i) => `${i.item.sceneSlugs[0] ?? ""}|${i.item.tempo ?? ""}`);
    expect(new Set(combos).size).toBe(combos.length);
    // Every start-here pick is featured or high priority.
    expect(start.items.every((i) => i.item.priority === "featured" || i.item.priority === "high")).toBe(true);
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

  it("emits the coming-up section (empty, filled by I/O) for a user with taste", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const cu = section(r, "coming-up");
    expect(cu).toBeDefined();
    expect(cu.items).toEqual([]);
  });
});

describe("generateRecommendations — latest-per-artist & already-heard", () => {
  it("favorite-artists keeps exactly one archive per artist", () => {
    const r = run(USER_MARIA_FAN, MARIA_CREW_AFFILIATION);
    const mariaCount = ids(r, "favorite-artists").filter((id) => id.startsWith("a-maria")).length;
    expect(mariaCount).toBe(1);
  });

  it("favorite-artists keeps the LATEST recording per artist (not the less-heard)", () => {
    // a-maria-new recorded 2d ago, a-maria-old 20d ago. Latest wins regardless
    // of the already-heard penalty (which only affects scoring/ordering).
    const r = run(USER_HEAVY, MARIA_CREW_AFFILIATION);
    const maria = ids(r, "favorite-artists").filter((id) => id.startsWith("a-maria"));
    expect(maria).toEqual(["a-maria-new"]);
  });
});

describe("generateRecommendations — DJ self-taste", () => {
  it("a DJ's own scene/tempo counts as taste (not cold-start) and boosts matching discovery", () => {
    // DJ owns a-luke-new (star, uptempo) but has no other history.
    const r = run(USER_NEW, { relatedDisplayByDjUsername: new Map() }, {}, ["a-luke-new"]);
    // Has taste now → NOT the cold-start single start-here section.
    expect(r.sections.map((s) => s.id)).not.toEqual(["start-here"]);
    // a-stranger-cold is (dub, very_slow) — no self-match; a-ninka-new is
    // (star, very_fast) → shares the DJ's "star" scene → gets the boost.
    const disc = section(r, "discovery").items;
    const ninka = disc.find((i) => i.item.id === "a-ninka-new");
    if (ninka) {
      const boost = ninka.scoreBreakdown.find((c) => c.name === "selfTasteBoost");
      expect(boost?.contribution).toBeGreaterThan(0);
    }
    // At least something surfaced.
    expect(disc.length).toBeGreaterThan(0);
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
