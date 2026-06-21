import { describe, it, expect } from "vitest";
import { snapshotDocId, buildSnapshot } from "./snapshot";
import { generateRecommendations } from "./engine";
import { normalizeArchive, normalizeUser } from "./normalize";
import { DEFAULT_RECOMMENDATION_CONFIG } from "./config";
import type { ContentItem } from "./types";
import { FAKE_ARCHIVES, NOW_MS } from "./__fixtures__/fake-content";
import { USER_MARIA_FAN } from "./__fixtures__/fake-users";

function items(): ContentItem[] {
  return FAKE_ARCHIVES.map(normalizeArchive);
}
function itemMap() {
  const m = new Map<string, ContentItem>();
  for (const i of items()) m.set(i.id, i);
  return m;
}

describe("snapshotDocId", () => {
  it("composes uid + context", () => {
    expect(snapshotDocId("abc", "website")).toBe("abc__website");
    expect(snapshotDocId("abc", "weekly-email")).toBe("abc__weekly-email");
  });
});

describe("buildSnapshot", () => {
  it("maps sections to lean items, uses injected generatedAtMs, attaches comingUp", () => {
    const signals = normalizeUser({
      uid: USER_MARIA_FAN.uid,
      email: USER_MARIA_FAN.email,
      loveHistory: USER_MARIA_FAN.loveHistory,
      streamHistory: USER_MARIA_FAN.streamHistory,
      searchFavorites: USER_MARIA_FAN.searchFavorites,
      archiveById: itemMap(),
    });
    const result = generateRecommendations(
      signals,
      items(),
      { relatedDisplayByDjUsername: new Map() },
      DEFAULT_RECOMMENDATION_CONFIG,
      { context: "weekly-email", nowMs: NOW_MS },
    );

    const snap = buildSnapshot(result, {
      uid: USER_MARIA_FAN.uid,
      context: "weekly-email",
      generatedAtMs: 12345,
      generatedBy: "cron",
      comingUp: [
        { showId: "broadcast-x", showName: "X Live", djUsername: "x", startTimeMs: NOW_MS + 1000, reason: "engaged" },
      ],
    });

    expect(snap.generatedAtMs).toBe(12345);
    expect(snap.generatedBy).toBe("cron");
    expect(snap.uid).toBe(USER_MARIA_FAN.uid);
    expect(snap.context).toBe("weekly-email");

    const fav = snap.sections.find((s) => s.id === "favorite-artists")!;
    expect(fav.items.length).toBeGreaterThan(0);
    expect(fav.items[0]).toHaveProperty("archiveId");
    expect(fav.items[0]).toHaveProperty("reasons");

    const cu = snap.sections.find((s) => s.id === "coming-up")!;
    expect(cu.comingUp).toHaveLength(1);
    expect(cu.comingUp![0].showId).toBe("broadcast-x");
  });
});
