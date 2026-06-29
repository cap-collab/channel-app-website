/**
 * Fake archives for recommendation tests. Spans priorities, scenes, tempos,
 * DJs, and ages. Ages are expressed as "days ago from NOW_MS" so tests can
 * compute recency deterministically against a fixed nowMs.
 */

import type { Archive } from "@/types/broadcast";

// Fixed reference "now" for all fixtures. Arbitrary but stable.
export const NOW_MS = 1_700_000_000_000; // 2023-11-14T...
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): number {
  return NOW_MS - n * DAY;
}

function archive(over: Partial<Archive> & { id: string }): Archive {
  return {
    id: over.id,
    slug: over.slug ?? over.id,
    broadcastSlotId: `slot-${over.id}`,
    showName: over.showName ?? `Show ${over.id}`,
    djs: over.djs ?? [{ name: "Unknown", username: "unknown" }],
    recordingUrl: over.recordingUrl ?? `https://r2/${over.id}.mp4`,
    duration: over.duration ?? 3600,
    recordedAt: over.recordedAt ?? daysAgo(5),
    createdAt: over.createdAt ?? daysAgo(5),
    stationId: "channel-main",
    showImageUrl: over.showImageUrl,
    streamCount: over.streamCount,
    isPublic: over.isPublic,
    sourceType: over.sourceType,
    priority: over.priority,
    sceneIdsOverride: over.sceneIdsOverride,
    sceneSlugs: over.sceneSlugs,
    tempo: over.tempo,
  };
}

// DJ identities used across fixtures (display name → username).
export const DJ = {
  maria: { name: "Maria", username: "maria" },
  luke: { name: "Luke", username: "luke" }, // maria's crew (affiliate)
  ninka: { name: "Ninka", username: "ninka" }, // maria's crew (sibling)
  dax: { name: "Dax", username: "dax" }, // borrows maria's audience
  stranger: { name: "Stranger", username: "stranger" },
  stranger2: { name: "Stranger Two", username: "stranger2" }, // distinct artist (for per-DJ dedup tests)
} as const;

export const FAKE_ARCHIVES: Archive[] = [
  // Maria — user engaged with her → Section 1. New + featured.
  archive({ id: "a-maria-new", showName: "Maria Spiral Set", djs: [DJ.maria], priority: "featured", sceneSlugs: ["spiral"], tempo: "uptempo", recordedAt: daysAgo(2), createdAt: daysAgo(2) }),
  // Maria — older medium. Still Section 1.
  archive({ id: "a-maria-old", showName: "Maria Throwback", djs: [DJ.maria], priority: "medium", sceneSlugs: ["spiral"], tempo: "downtempo", recordedAt: daysAgo(20), createdAt: daysAgo(20) }),
  // Luke — crew of maria → Section 2 (affiliated). New high.
  archive({ id: "a-luke-new", showName: "Luke Live", djs: [DJ.luke], priority: "high", sceneSlugs: ["star"], tempo: "uptempo", recordedAt: daysAgo(3), createdAt: daysAgo(3) }),
  // Ninka — crew of maria → Section 2 (affiliated).
  archive({ id: "a-ninka-new", showName: "Ninka Live", djs: [DJ.ninka], priority: "medium", sceneSlugs: ["star"], tempo: "very_fast", recordedAt: daysAgo(4), createdAt: daysAgo(4) }),
  // Stranger, but SAME scene (spiral) + SAME tempo (uptempo) as user engaged → Section 2 (scene+tempo).
  archive({ id: "a-stranger-scene", showName: "Stranger Spiral", djs: [DJ.stranger], priority: "high", sceneSlugs: ["spiral"], tempo: "uptempo", recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Same scene+tempo match as a-stranger-scene but MEDIUM priority, by a DISTINCT
  // artist (so discovery's 1-per-DJ cap doesn't dedup it against a-stranger-scene).
  archive({ id: "a-stranger-scene-med", showName: "Stranger Spiral Med", djs: [DJ.stranger2], priority: "medium", sceneSlugs: ["spiral"], tempo: "uptempo", recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Stranger, different scene + tempo, no tie → only fallback-fill eligible. Featured + new.
  archive({ id: "a-stranger-cold", showName: "Stranger Cold", djs: [DJ.stranger], priority: "featured", sceneSlugs: ["dub"], tempo: "very_slow", recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Stranger, another cold fallback candidate, high priority.
  archive({ id: "a-stranger-cold2", showName: "Stranger Cold 2", djs: [DJ.stranger], priority: "high", sceneSlugs: ["dub"], tempo: "very_slow", recordedAt: daysAgo(6), createdAt: daysAgo(6) }),
  // Hidden — must always be excluded.
  archive({ id: "a-hidden", showName: "Hidden", djs: [DJ.maria], priority: "hidden", sceneSlugs: ["spiral"], tempo: "uptempo", recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Too short — excluded by minDurationSec.
  archive({ id: "a-short", showName: "Short", djs: [DJ.maria], priority: "high", duration: 120, recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Private — excluded when requirePublic.
  archive({ id: "a-private", showName: "Private", djs: [DJ.maria], priority: "high", isPublic: false, recordedAt: daysAgo(1), createdAt: daysAgo(1) }),
  // Stale — outside the recency window (90 days).
  archive({ id: "a-stale", showName: "Stale", djs: [DJ.maria], priority: "high", sceneSlugs: ["spiral"], tempo: "uptempo", recordedAt: daysAgo(90), createdAt: daysAgo(90) }),
];

export function archiveById(id: string): Archive {
  const a = FAKE_ARCHIVES.find((x) => x.id === id);
  if (!a) throw new Error(`fixture archive not found: ${id}`);
  return a;
}
