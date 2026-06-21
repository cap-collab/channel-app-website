/**
 * Snapshot shaping — pure.
 *
 * Maps a RecommendationResult (+ the I/O-built coming-up rows) into the lean
 * RecommendationSnapshot persisted to Firestore. generatedAtMs is injected
 * (never Date.now() here). Doc-id helper mirrors the codebase's loopDocId style.
 */

import type {
  RecommendationResult,
  RecommendationSnapshot,
  RecommendationContext,
  SnapshotItem,
  SnapshotSection,
  ComingUpItem,
  ScoredCandidate,
  TasteSummary,
} from "./types";

export function snapshotDocId(uid: string, context: RecommendationContext): string {
  return `${uid}__${context}`;
}

function toSnapshotItem(c: ScoredCandidate): SnapshotItem {
  return {
    archiveId: c.item.id,
    slug: c.item.slug,
    showName: c.item.showName,
    showImageUrl: c.item.showImageUrl,
    djUsernames: c.item.djUsernames,
    djDisplayNames: c.item.djDisplayNames,
    sceneSlugs: c.item.sceneSlugs,
    recordingUrl: c.item.recordingUrl,
    durationSec: c.item.durationSec,
    rank: c.rank ?? 0,
    score: c.score,
    scoreBreakdown: c.scoreBreakdown,
    reasons: c.reasons,
    pinned: c.pinned ?? false,
    isFallback: c.isFallback ?? false,
  };
}

export interface BuildSnapshotMeta {
  uid: string;
  context: RecommendationContext;
  generatedAtMs: number;
  generatedBy: RecommendationSnapshot["generatedBy"];
  comingUp: ComingUpItem[];
  tasteSummary: TasteSummary;
}

export function buildSnapshot(
  result: RecommendationResult,
  meta: BuildSnapshotMeta,
): RecommendationSnapshot {
  const sections: SnapshotSection[] = result.sections.map((s) => {
    if (s.id === "coming-up") {
      return { id: s.id, title: s.title, items: [], comingUp: meta.comingUp };
    }
    return { id: s.id, title: s.title, items: s.items.map(toSnapshotItem) };
  });

  const deliveredCount = result.sections.reduce((n, s) => n + s.items.length, 0) + meta.comingUp.length;

  return {
    uid: meta.uid,
    context: meta.context,
    generatedAtMs: meta.generatedAtMs,
    generatedBy: meta.generatedBy,
    configVersion: result.configVersion,
    sections,
    candidateCount: deliveredCount,
    excludedCount: result.dropped.length,
    tasteSummary: meta.tasteSummary,
  };
}
