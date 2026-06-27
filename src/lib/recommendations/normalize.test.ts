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
    const inputs = buildCandidateInputs(u, items, NO_AFFILIATION);
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
    const inputs = buildCandidateInputs(u, items, NO_AFFILIATION);
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
      relatedDisplayByDjUsername: new Map([["luke", "Maria"]]),
    };
    const inputs = buildCandidateInputs(u, items, affiliation);
    const luke = inputs.find((i) => i.item.id === "a-luke-new")!;
    expect(luke.isAffiliated).toBe(true);
    expect(luke.affiliatedTo).toBe("Maria");
  });
});
