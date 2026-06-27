import { describe, it, expect } from "vitest";
import { buildFeaturedMatrix } from "./featured-matrix";
import type { ArchiveSerialized } from "@/types/broadcast";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function arc(over: Partial<ArchiveSerialized> & { id: string }): ArchiveSerialized {
  return {
    id: over.id,
    slug: over.id,
    broadcastSlotId: `slot-${over.id}`,
    showName: over.showName ?? over.id,
    djs: over.djs ?? [{ name: "DJ", username: "dj" }],
    recordingUrl: `https://r2/${over.id}.mp4`,
    duration: over.duration ?? 3600,
    recordedAt: over.recordedAt ?? NOW - DAY,
    createdAt: over.createdAt ?? NOW - DAY,
    stationId: "channel-main",
    isPublic: over.isPublic ?? true,
    priority: over.priority,
    sceneSlugs: over.sceneSlugs,
    tempo: over.tempo,
  } as ArchiveSerialized;
}

describe("buildFeaturedMatrix — priority-first cell pick", () => {
  it("prefers a Featured/High archive over a more RECENT Medium in the same cell", () => {
    const docs: ArchiveSerialized[] = [
      // Same cell (spiral × uptempo): a recent medium vs an older featured.
      arc({ id: "recent-medium", sceneSlugs: ["spiral"], tempo: "uptempo", priority: "medium", recordedAt: NOW - 1 * DAY }),
      arc({ id: "older-featured", sceneSlugs: ["spiral"], tempo: "uptempo", priority: "featured", recordedAt: NOW - 10 * DAY }),
    ];
    const out = buildFeaturedMatrix(docs).map((a) => a.id);
    // Featured wins the cell despite being older.
    expect(out).toContain("older-featured");
    expect(out).not.toContain("recent-medium");
  });

  it("falls back to latest Medium when no Featured/High exists for the cell", () => {
    const docs: ArchiveSerialized[] = [
      arc({ id: "old-medium", sceneSlugs: ["star"], tempo: "downtempo", priority: "medium", recordedAt: NOW - 10 * DAY }),
      arc({ id: "new-medium", sceneSlugs: ["star"], tempo: "downtempo", priority: "medium", recordedAt: NOW - 1 * DAY }),
    ];
    const out = buildFeaturedMatrix(docs).map((a) => a.id);
    expect(out).toContain("new-medium"); // latest of the same priority band
    expect(out).not.toContain("old-medium");
  });
});
