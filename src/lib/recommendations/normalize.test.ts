import { describe, it, expect } from "vitest";
import {
  normalizeArchive,
  normalizeUser,
  buildCandidateInputs,
  type AffiliationLookup,
} from "./normalize";
import type { ContentItem } from "./types";
import { FAKE_ARCHIVES, archiveById } from "./__fixtures__/fake-content";
import { USER_MARIA_FAN, USER_NEW, USER_HEAVY } from "./__fixtures__/fake-users";

function itemMap(): Map<string, ContentItem> {
  const m = new Map<string, ContentItem>();
  for (const a of FAKE_ARCHIVES) m.set(a.id, normalizeArchive(a));
  return m;
}

const NO_AFFILIATION: AffiliationLookup = { relatedDisplayByDjUsername: new Map() };
const FAV_RECENCY = { engagementHalfLifeDays: 30, releaseFreshnessWeight: 0.5, ownCrewDefaultDays: 30 };
const NOW = 1_700_000_000_000; // fixed nowMs for deterministic tests
// Wrapper so existing call sites keep working with the new 5-arg signature.
const buildInputs = (
  u: Parameters<typeof buildCandidateInputs>[0],
  items: Parameters<typeof buildCandidateInputs>[1],
  aff: AffiliationLookup,
) => buildCandidateInputs(u, items, aff, FAV_RECENCY, NOW);

describe("normalizeArchive", () => {
  it("normalizes DJ usernames and defaults priority to medium", () => {
    const item = normalizeArchive(archiveById("a-maria-new"));
    expect(item.djUsernames).toEqual(["maria"]);
    expect(item.djDisplayNames).toEqual(["Maria"]);
    expect(item.priority).toBe("featured");
    expect(item.sceneSlugs).toEqual(["spiral"]);
    expect(item.tempo).toBe("uptempo");
  });

  it("prefers sceneIdsOverride over sceneSlugs", () => {
    const item = normalizeArchive({
      ...archiveById("a-maria-new"),
      sceneIdsOverride: ["forced"],
      sceneSlugs: ["spiral"],
    });
    expect(item.sceneSlugs).toEqual(["forced"]);
  });

  it("treats isPublic !== false as public", () => {
    expect(normalizeArchive(archiveById("a-maria-new")).isPublic).toBe(true);
    expect(normalizeArchive(archiveById("a-private")).isPublic).toBe(false);
  });

  it("folds crossList contributors into djUsernames for matching (username + resolved uid)", () => {
    // A B2B/collective archive credits ONLY the collective slug in djs[]; the
    // individual DJs are tagged via crossListUsernames (pending) and
    // crossListUserIds (real uids, resolved via the uid→username map).
    const uidToUsername = new Map([["uid-slip", "slip"]]);
    const item = normalizeArchive(
      {
        ...archiveById("a-maria-new"),
        id: "a-b2b",
        djs: [{ name: "Information", username: "information" }],
        crossListUsernames: ["straye"],
        crossListUserIds: ["uid-slip"],
      },
      undefined,
      uidToUsername,
    );
    // Primary slug credit stays; contributors appended (deduped, normalized).
    expect(item.djUsernames).toEqual(["information", "straye", "slip"]);
  });

  it("crossList contributors do NOT drive scene inheritance", () => {
    // Contributor 'straye' has profile scene "dub". The slug-only archive has no
    // own scenes, so scene inheritance runs — but it must inherit ONLY from djs[]
    // (the collective, which has no profile scene here), NOT from crossList.
    const djSceneMap = new Map([["straye", ["dub"]]]);
    const item = normalizeArchive(
      {
        ...archiveById("a-maria-new"),
        id: "a-b2b-scene",
        djs: [{ name: "Information", username: "information" }],
        sceneSlugs: [], // no own scenes → inheritance path active
        sceneIdsOverride: undefined,
        crossListUsernames: ["straye"],
      },
      djSceneMap,
    );
    // straye is in djUsernames (matching) but its "dub" scene is NOT inherited.
    expect(item.djUsernames).toContain("straye");
    expect(item.sceneSlugs).toEqual([]);
  });
});

describe("normalizeUser — taste profile from engagement", () => {
  it("builds engagedDjs/scenes/tempos from streamed archives", () => {
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    expect(u.engagedDjs.has("maria")).toBe(true);
    expect(u.engagedScenes.has("spiral")).toBe(true); // from streamed a-maria-new
    expect(u.engagedTempos.has("uptempo")).toBe(true);
    expect(u.streamedArchiveIds.has("a-maria-new")).toBe(true);
    expect(u.archiveStreamCount["a-maria-new"]).toBe(3);
  });

  it("tracklist views add scene/tempo affinity ONLY (no engaged-DJ, not played)", () => {
    const u = normalizeUser({
      uid: "u-viewer",
      email: "viewer@example.com",
      loveHistory: [],
      streamHistory: [],
      searchFavorites: [],
      archiveById: itemMap(),
      // Viewed the tracklist of a-stranger-cold (scene dub, tempo very_slow, DJ stranger).
      tracklistViewArchiveIds: ["a-stranger-cold"],
    });
    // Scene + tempo affinity ARE credited.
    expect(u.engagedScenes.has("dub")).toBe(true);
    expect(u.engagedTempos.has("very_slow")).toBe(true);
    // The archive's DJ is NOT marked engaged (taste-only signal).
    expect(u.engagedDjs.has("stranger")).toBe(false);
    // The archive is NOT marked played/streamed (still recommendable).
    expect(u.streamedArchiveIds.has("a-stranger-cold")).toBe(false);
    // The viewed archive IS listed by show name in the taste summary.
    expect(u.tasteSummary.tracklistViewedArchives).toContain(
      archiveById("a-stranger-cold").showName,
    );
  });

  it("builds a taste summary with per-scene and per-tempo counts", () => {
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    expect(u.tasteSummary.lovedDjs).toContain("Maria");
    expect(u.tasteSummary.archivesStreamed).toBe(1);
    // Streamed archives are NAMED by show name (for the admin tab).
    expect(u.tasteSummary.streamedArchives).toContain(archiveById("a-maria-new").showName);
    // Streamed a-maria-new → scene spiral ×1, tempo uptempo ×1.
    expect(u.tasteSummary.sceneCounts).toEqual([{ scene: "spiral", count: 1 }]);
    expect(u.tasteSummary.tempoCounts).toEqual([{ tempo: "uptempo", count: 1 }]);
  });

  it("DJ's own archives fold scene+tempo into taste (selfScenes/selfTempos)", () => {
    // Treat a-luke-new (star, uptempo) as the user's OWN archive.
    const own = [normalizeArchive(archiveById("a-luke-new"))];
    const u = normalizeUser({
      uid: "u-dj",
      email: "dj@example.com",
      loveHistory: [],
      streamHistory: [],
      searchFavorites: [],
      archiveById: itemMap(),
      ownArchives: own,
    });
    expect(u.selfScenes.has("star")).toBe(true);
    expect(u.selfTempos.has("uptempo")).toBe(true);
    // Folded into engaged sets too, so they drive matching.
    expect(u.engagedScenes.has("star")).toBe(true);
    expect(u.engagedTempos.has("uptempo")).toBe(true);
    // AND merged into the taste counts (so they show in the admin tab + feed
    // affinity ranking) — even with zero stream history. Own archives count
    // DOUBLE (+2), so one own archive → count 2.
    expect(u.tasteSummary.sceneCounts).toContainEqual({ scene: "star", count: 2 });
    expect(u.tasteSummary.tempoCounts).toContainEqual({ tempo: "uptempo", count: 2 });
  });

  it("brand-new user has empty taste", () => {
    const u = normalizeUser({
      uid: USER_NEW.uid,
      email: USER_NEW.email,
      loveHistory: [],
      streamHistory: [],
      searchFavorites: [],
      archiveById: itemMap(),
    });
    expect(u.engagedDjs.size).toBe(0);
    expect(u.engagedScenes.size).toBe(0);
    expect(u.engagedTempos.size).toBe(0);
  });
});

describe("played signal — exclusion-only, never taste", () => {
  // A bare "play" (any duration) excludes an archive from recs but must NOT
  // pull its DJ/scene/tempo into taste — a play might mean they disliked it.
  it("a played-only archive contributes ZERO taste but IS excluded", () => {
    const u = normalizeUser({
      uid: "u-played",
      email: "p@x.com",
      loveHistory: [],
      streamHistory: [], // nothing streamed
      searchFavorites: [],
      archiveById: itemMap(),
      playedArchiveIds: ["a-maria-new"], // played Maria's spiral/uptempo set
    });
    // Taste is empty: no engaged DJ, scene, or tempo from a bare play.
    expect(u.engagedDjs.size).toBe(0);
    expect(u.engagedScenes.size).toBe(0);
    expect(u.engagedTempos.size).toBe(0);
    // But the archive is tracked for exclusion.
    expect(u.playedArchiveIds.has("a-maria-new")).toBe(true);
    // And it is NOT counted as a stream (distinct sets).
    expect(u.streamedArchiveIds.has("a-maria-new")).toBe(false);

    // The candidate's already-heard count is >0 → rules.ts drops it from §1/§2.
    const items = Array.from(itemMap().values());
    const played = buildInputs(u, items, NO_AFFILIATION).find((i) => i.item.id === "a-maria-new")!;
    expect(played.alreadyStreamedCount).toBeGreaterThan(0);
  });

  it("played + streamed union: streamed still drives taste, both exclude", () => {
    const u = normalizeUser({
      uid: "u-both",
      email: "b@x.com",
      loveHistory: [],
      streamHistory: [
        { archiveId: "a-maria-new", djUsernamesNormalized: ["maria"], streamCount: 2 },
      ],
      searchFavorites: [],
      archiveById: itemMap(),
      playedArchiveIds: ["a-luke-new"], // played but NOT streamed
    });
    // Streamed archive → taste. Played-only archive → NOT taste.
    expect(u.engagedDjs.has("maria")).toBe(true);
    expect(u.engagedDjs.has("luke")).toBe(false); // a bare play never engages the DJ
    expect(u.engagedScenes.has("spiral")).toBe(true); // from streamed maria
    expect(u.engagedScenes.has("star")).toBe(false); // luke's scene NOT pulled in
    // Both are excluded from recs.
    const items = Array.from(itemMap().values());
    const inputs = buildInputs(u, items, NO_AFFILIATION);
    expect(inputs.find((i) => i.item.id === "a-maria-new")!.alreadyStreamedCount).toBeGreaterThan(0);
    expect(inputs.find((i) => i.item.id === "a-luke-new")!.alreadyStreamedCount).toBeGreaterThan(0);
  });

  it("legacy gate-only streamHistory doc (no streamCount) excludes but is NOT taste", () => {
    const u = normalizeUser({
      uid: "u-gate",
      email: "g@x.com",
      loveHistory: [],
      streamHistory: [
        // Legacy shape: gateTriggered, no real streamCount → exclusion-only.
        { archiveId: "a-maria-new", djUsernamesNormalized: ["maria"], gateTriggered: true },
      ],
      searchFavorites: [],
      archiveById: itemMap(),
    });
    // No taste from a gate-only doc.
    expect(u.engagedDjs.size).toBe(0);
    expect(u.engagedScenes.size).toBe(0);
    // Still excluded (marked streamed/heard).
    expect(u.streamedArchiveIds.has("a-maria-new")).toBe(true);
    const items = Array.from(itemMap().values());
    const c = buildInputs(u, items, NO_AFFILIATION).find((i) => i.item.id === "a-maria-new")!;
    expect(c.alreadyStreamedCount).toBeGreaterThan(0);
  });

  it("a NEW gate-login (real streamCount, gateTriggered flag) DOES feed taste", () => {
    // The gate-credit path now writes a real streamCount — indistinguishable
    // from a normal 15-min stream, so taste must apply even if the doc still
    // carries the gateTriggered/gateCreditedAt marker.
    const u = normalizeUser({
      uid: "u-gate-new",
      email: "gn@x.com",
      loveHistory: [],
      streamHistory: [
        { archiveId: "a-maria-new", djUsernamesNormalized: ["maria"], streamCount: 1, gateTriggered: true },
      ],
      searchFavorites: [],
      archiveById: itemMap(),
    });
    expect(u.engagedDjs.has("maria")).toBe(true);
    expect(u.engagedScenes.has("spiral")).toBe(true);
  });
});

describe("buildCandidateInputs", () => {
  it("flags Section-1 ties (engaged DJ) and already-heard count", () => {
    const items = Array.from(itemMap().values());
    const u = normalizeUser({
      uid: USER_HEAVY.uid,
      email: USER_HEAVY.email,
      loveHistory: USER_HEAVY.loveHistory,
      streamHistory: USER_HEAVY.streamHistory,
      searchFavorites: USER_HEAVY.searchFavorites,
      archiveById: itemMap(),
    });
    const inputs = buildInputs(u, items, NO_AFFILIATION);
    const mariaNew = inputs.find((i) => i.item.id === "a-maria-new")!;
    expect(mariaNew.matchedEngagedDjs).toEqual(["maria"]);
    expect(mariaNew.alreadyStreamedCount).toBe(50);
  });

  it("flags Section-2 scene+tempo match for a stranger archive", () => {
    const items = Array.from(itemMap().values());
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    const inputs = buildInputs(u, items, NO_AFFILIATION);
    const strangerScene = inputs.find((i) => i.item.id === "a-stranger-scene")!;
    expect(strangerScene.sceneTempoMatch).toBe(true); // spiral + uptempo
    expect(strangerScene.matchedEngagedDjs).toEqual([]); // no DJ tie
    const strangerCold = inputs.find((i) => i.item.id === "a-stranger-cold")!;
    expect(strangerCold.sceneTempoMatch).toBe(false); // dub + very_slow
  });

  it("flags Section-2 affiliation tie via the lookup", () => {
    const items = Array.from(itemMap().values());
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    const affiliation: AffiliationLookup = {
      relatedDisplayByDjUsername: new Map([["luke", { display: "Maria", kind: "crew" as const }]]),
    };
    const inputs = buildInputs(u, items, affiliation);
    const luke = inputs.find((i) => i.item.id === "a-luke-new")!;
    expect(luke.isAffiliated).toBe(true);
    expect(luke.affiliatedTo).toBe("Maria");
  });

  it("bridges a COLLECTIVE-credited archive to an owner-fan via the lookup", () => {
    // A collective archive credits the collective SLUG in djs[] (owners are not
    // re-credited). The server maps slug → engaged-owner display in the lookup,
    // so the collective archive surfaces as discovery/crew for an owner's fan.
    const collectiveArchive = normalizeArchive({
      ...archiveById("a-luke-new"),
      id: "a-coll-show",
      showName: "Deep Collective Night",
      djs: [{ name: "Deep Collective", username: "deep-coll" }],
    });
    const items = [collectiveArchive];
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    // normalizeArchive normalizes "deep-coll" → "deepcoll" (dash stripped).
    const affiliation: AffiliationLookup = {
      relatedDisplayByDjUsername: new Map([["deepcoll", { display: "Maria", kind: "crew" as const }]]),
    };
    const inputs = buildInputs(u, items, affiliation);
    const coll = inputs.find((i) => i.item.id === "a-coll-show")!;
    expect(coll.isAffiliated).toBe(true); // engaged an owner → collective archive bridges
    expect(coll.discoveryTier).toBe(2); // crew/affiliated tier
  });

  it("affiliation makes a LOW-priority archive a discovery candidate (priority bypass)", () => {
    // A LOW archive normally can't enter discovery (needs featured/high). But if
    // it's affiliated (crew/borrow), it qualifies at ANY priority.
    const lowAff = normalizeArchive({ ...archiveById("a-luke-new"), id: "a-low-aff", priority: "low" });
    const u = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    const affiliation: AffiliationLookup = {
      relatedDisplayByDjUsername: new Map([["luke", { display: "Maria", kind: "crew" as const }]]),
    };
    const inputs = buildInputs(u, [lowAff], affiliation);
    const c = inputs.find((i) => i.item.id === "a-low-aff")!;
    expect(c.isAffiliated).toBe(true);
    expect(c.discoveryTier).not.toBeNull(); // qualifies despite LOW priority
  });
});

describe("favoritesRank — §1 ordering by engagement recency (blended with freshness)", () => {
  const NOW_FIXED = NOW;
  const daysAgoMs = (d: number) => NOW_FIXED - d * 24 * 60 * 60 * 1000;

  it("a recently-engaged artist outranks a stale-engaged one", () => {
    // recent DJ engaged 5d ago; stale DJ engaged 90d ago. Their archives are the
    // same age, so engagement recency decides.
    const recent = normalizeArchive({ ...archiveById("a-luke-new"), id: "a-recent", djs: [{ name: "Recent", username: "recentdj" }], recordedAt: daysAgoMs(5), createdAt: daysAgoMs(5) });
    const stale = normalizeArchive({ ...archiveById("a-luke-new"), id: "a-stale-eng", djs: [{ name: "Stale", username: "staledj" }], recordedAt: daysAgoMs(5), createdAt: daysAgoMs(5) });
    const u = normalizeUser({
      uid: "u", email: "u@x.com", searchFavorites: [],
      loveHistory: [
        { djUsernameNormalized: "recentdj", djDisplayName: "Recent", lastLovedAtMs: daysAgoMs(5) },
        { djUsernameNormalized: "staledj", djDisplayName: "Stale", lastLovedAtMs: daysAgoMs(90) },
      ],
      streamHistory: [],
      archiveById: itemMap(),
    });
    const inputs = buildInputs(u, [recent, stale], NO_AFFILIATION);
    const r = inputs.find((i) => i.item.id === "a-recent")!;
    const s = inputs.find((i) => i.item.id === "a-stale-eng")!;
    expect(r.favoritesRank).toBeGreaterThan(s.favoritesRank);
  });

  it("a stale-engaged DJ's brand-NEW archive outranks their OLD one (freshness re-hook)", () => {
    // Same stale DJ (engaged 90d ago); one archive is fresh (1d), one old (60d).
    const fresh = normalizeArchive({ ...archiveById("a-luke-new"), id: "a-fresh", djs: [{ name: "Stale", username: "staledj" }], recordedAt: daysAgoMs(1), createdAt: daysAgoMs(1) });
    const old = normalizeArchive({ ...archiveById("a-luke-new"), id: "a-old", djs: [{ name: "Stale", username: "staledj" }], recordedAt: daysAgoMs(60), createdAt: daysAgoMs(60) });
    const u = normalizeUser({
      uid: "u", email: "u@x.com", searchFavorites: [],
      loveHistory: [{ djUsernameNormalized: "staledj", djDisplayName: "Stale", lastLovedAtMs: daysAgoMs(90) }],
      streamHistory: [],
      archiveById: itemMap(),
    });
    const inputs = buildInputs(u, [fresh, old], NO_AFFILIATION);
    const f = inputs.find((i) => i.item.id === "a-fresh")!;
    const o = inputs.find((i) => i.item.id === "a-old")!;
    expect(f.favoritesRank).toBeGreaterThan(o.favoritesRank);
  });
});
