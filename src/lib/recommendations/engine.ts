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
  ScoredCandidate,
  SectionId,
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

  // A user with ZERO signal of any kind (no engagement, no watchlist, no
  // self-taste as a DJ) gets a single "Start here" section that REPLACES all
  // others: the latest featured archive per (scene+tempo) combo.
  const hasAnyTaste =
    user.engagedDjs.size > 0 ||
    user.watchlistArtists.size > 0 ||
    user.engagedScenes.size > 0 ||
    user.engagedTempos.size > 0;

  if (!hasAnyTaste) {
    return {
      sections: [buildStartHere(scored, config, ctx.context)],
      dropped: [],
      configVersion: config.version,
    };
  }

  // favorite-artists is NEVER padded with strangers — it's exactly the latest
  // archive per artist the user engaged with / watchlisted, however many that
  // is. Only discovery fallback-fills (cold-start discovery from featured).
  const fallbackSections = new Set<SectionId>(["discovery"]);

  const { sections, dropped } = applyRules(scored, config, ctx.context, {
    goLiveMutes: user.goLiveMutes,
    ownDjUsername: user.ownDjUsername,
    fallbackSections,
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

// Cold-start "Start here": one FEATURED archive per (scene+tempo) combo, latest
// first. Deterministic — sorted by score (priority+recency) then id, collapsed
// to one per combo. Excludes hidden/private/too-short via the same eligibility.
function buildStartHere(
  scored: ScoredCandidate[],
  config: RecommendationConfig,
  context: EngineContext["context"],
): RecommendationSection {
  const eligible = scored.filter(
    (c) =>
      (c.item.priority === "featured" || c.item.priority === "high") &&
      (!config.eligibility.requirePublic || c.item.isPublic) &&
      c.item.durationSec >= config.eligibility.minDurationSec,
  );
  eligible.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.item.id < b.item.id ? -1 : 1));

  const seen = new Set<string>();
  const picks: ScoredCandidate[] = [];
  const cap = config.caps[context]["start-here"];
  for (const c of eligible) {
    const key = `${c.item.sceneSlugs[0] ?? ""}|${c.item.tempo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ ...c, section: "start-here", reasons: ["Featured on Channel"], rank: picks.length + 1 });
    if (picks.length >= cap) break;
  }

  return { id: "start-here", title: SECTION_TITLES["start-here"], items: picks };
}
