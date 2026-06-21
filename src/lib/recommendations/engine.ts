/**
 * Pure orchestrator: normalize → score → rules.
 *
 * Given a user's normalized signals, the normalized content pool, the
 * affiliation lookup, the config, and an injected nowMs, returns the ranked
 * archive sections (favorite-artists, discovery) plus the dropped candidates
 * for admin inspection. "coming-up" is added by the I/O layer (it needs the
 * schedule + the go-live matcher), so the engine emits it as an empty section
 * the caller fills.
 *
 * This is the single entry point the unit tests drive — zero I/O, fully
 * deterministic.
 */

import type {
  ContentItem,
  UserSignals,
  RecommendationConfig,
  EngineContext,
  RecommendationResult,
  RecommendationSection,
} from "./types";
import { SECTION_TITLES } from "./types";
import { buildCandidateInputs, type AffiliationLookup } from "./normalize";
import { scoreCandidate } from "./scoring";
import { applyRules } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

export function generateRecommendations(
  user: UserSignals,
  items: ContentItem[],
  affiliation: AffiliationLookup,
  config: RecommendationConfig,
  ctx: EngineContext,
): RecommendationResult {
  // Candidate pool: archives within the recency window only. Stale archives are
  // simply not candidates (keeps rules.ts free of nowMs).
  const cutoff = ctx.nowMs - config.recency.windowDays * DAY_MS;
  const candidates = items.filter((it) => it.recordedAtMs >= cutoff);

  const inputs = buildCandidateInputs(user, candidates, affiliation);
  const scored = inputs.map((i) => scoreCandidate(i, config, ctx.nowMs));

  const { sections, dropped } = applyRules(scored, config, ctx.context, {
    goLiveMutes: user.goLiveMutes,
    ownDjUsername: user.ownDjUsername,
  });

  // Append the empty coming-up section so the snapshot shape is consistent;
  // the I/O layer fills it from the schedule + go-live matcher.
  const comingUp: RecommendationSection = {
    id: "coming-up",
    title: SECTION_TITLES["coming-up"],
    items: [],
  };

  return {
    sections: [...sections, comingUp],
    dropped,
    configVersion: config.version,
  };
}
