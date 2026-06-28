/**
 * Scoring engine — pure & deterministic.
 *
 * score = (priority + recency + sectionBonus) / (1 + alreadyHeard * strength)
 *
 * Each additive component contributes `rawValue * weight`. The already-heard
 * penalty is a multiplicative damper recorded as its own breakdown component so
 * the breakdown still reconciles to the final score:
 *   sum(scoreBreakdown.contribution) === score   (a tested invariant)
 *
 * No rng, no globals, no Date.now() — nowMs is injected. Identical inputs →
 * identical floats.
 */

import { tempoLabel } from "@/lib/tempo";
import { priorityIsHigh } from "@/lib/archive-priority";
import type {
  CandidateInput,
  RecommendationConfig,
  ScoreComponent,
  ScoredCandidate,
  SectionId,
} from "./types";
import { assignSection } from "./sections";

const DAY_MS = 24 * 60 * 60 * 1000;

// Priority tier → 0..1 raw signal. Featured/high are the top; medium mid; low low.
function priorityRaw(priority: string): number {
  if (priorityIsHigh(priority)) return 1;
  if (priority === "medium") return 0.5;
  if (priority === "low") return 0.2;
  return 0; // hidden (excluded earlier anyway)
}

// Recency → 0..1 exponential half-life decay, clamped to 0 outside the window.
function recencyRaw(
  recordedAtMs: number,
  nowMs: number,
  halfLifeDays: number,
  windowDays: number,
): number {
  const ageDays = (nowMs - recordedAtMs) / DAY_MS;
  if (ageDays > windowDays) return 0;
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Score one candidate. Pure. The section is computed here so the caller has a
 * single source of truth, but exclusions/caps/editorial are applied later in
 * rules.ts.
 */
export function scoreCandidate(
  input: CandidateInput,
  config: RecommendationConfig,
  nowMs: number,
): ScoredCandidate {
  const { item } = input;
  const section: SectionId | null = assignSection(input);

  const priorityRawVal = priorityRaw(item.priority);
  const recencyRawVal = recencyRaw(
    item.recordedAtMs,
    nowMs,
    config.recency.halfLifeDays,
    config.recency.windowDays,
  );
  // Flat bonus for landing in a personalized section (1) vs fallback (0).
  const sectionRawVal = section ? 1 : 0;

  const components: ScoreComponent[] = [
    {
      name: "priority",
      rawValue: priorityRawVal,
      weight: config.weights.priority,
      contribution: priorityRawVal * config.weights.priority,
    },
    {
      name: "recency",
      rawValue: recencyRawVal,
      weight: config.weights.recency,
      contribution: recencyRawVal * config.weights.recency,
    },
    {
      name: "sectionBonus",
      rawValue: sectionRawVal,
      weight: config.weights.sectionBonus,
      contribution: sectionRawVal * config.weights.sectionBonus,
    },
  ];

  // Scene+tempo affinity: rank by how strongly the user engaged with this
  // candidate's scene+tempo, so their dominant taste surfaces first in discovery.
  components.push({
    name: "sceneTempoAffinity",
    rawValue: input.sceneTempoAffinity,
    weight: config.weights.sceneTempoAffinity,
    contribution: input.sceneTempoAffinity * config.weights.sceneTempoAffinity,
  });

  // DJ self-taste boost: a DJ user's own scene/tempo lifts matching discovery
  // picks above other discovery candidates.
  const selfRawVal = input.matchesSelfTaste ? 1 : 0;
  components.push({
    name: "selfTasteBoost",
    rawValue: selfRawVal,
    weight: config.weights.selfTasteBoost,
    contribution: selfRawVal * config.weights.selfTasteBoost,
  });

  const additiveBase = components.reduce((sum, c) => sum + c.contribution, 0);

  // Already-heard damper: score /= (1 + count * strength). Recorded so the
  // breakdown reconciles to the damped score.
  const damper = 1 / (1 + input.alreadyStreamedCount * config.alreadyHeard.penaltyStrength);
  const dampedScore = additiveBase * damper;
  components.push({
    name: "alreadyHeardPenalty",
    rawValue: input.alreadyStreamedCount,
    weight: config.alreadyHeard.penaltyStrength,
    contribution: dampedScore - additiveBase, // signed (≤ 0)
  });

  return {
    item,
    section,
    discoveryTier: input.discoveryTier,
    alreadyStreamedCount: input.alreadyStreamedCount,
    score: dampedScore,
    scoreBreakdown: components,
    reasons: buildReasons(input, section),
  };
}

// Human-readable reasons, most compelling first, never empty.
function buildReasons(input: CandidateInput, section: SectionId | null): string[] {
  const reasons: string[] = [];

  // Short, mobile-optimized band strings (see plan wording spec). reasons[0] is
  // what the Suggested band renders.
  if (section === "favorite-artists") {
    // §1: "New · {dj}" (engaged or watchlisted artist).
    reasons.push(`New · ${primaryDjName(input)}`);
  } else if (section === "discovery") {
    if (input.sceneTempoMatch) {
      // §2 scene+tempo: "More {scene} {tempo}", e.g. "More star uptempo".
      // Lowercase the tempo label so it reads consistently with the scene slug.
      const t = tempoLabel(input.matchedTempo)?.toLowerCase();
      const scene = input.matchedScenes[0];
      const bits = [scene, t].filter(Boolean).join(" ");
      reasons.push(bits ? `More ${bits}` : "More like this");
    } else if (input.isAffiliated && input.affiliatedTo) {
      // §2 crew → "Affiliated with {dj}"; audience-borrow → "Similar to {dj}".
      reasons.push(
        input.affiliationKind === "borrow"
          ? `Similar to ${input.affiliatedTo}`
          : `Affiliated with ${input.affiliatedTo}`,
      );
    }
  }

  // Guarantee non-empty.
  if (reasons.length === 0) reasons.push("New on Channel");
  return reasons;
}

function primaryDjName(input: CandidateInput): string {
  // The first engaged DJ's display name (fall back to any display name).
  const idx = input.item.djUsernames.indexOf(input.matchedEngagedDjs[0]);
  return input.item.djDisplayNames[idx] || input.item.djDisplayNames[0] || "an artist you love";
}
