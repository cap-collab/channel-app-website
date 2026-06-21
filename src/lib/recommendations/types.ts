/**
 * Deterministic recommendation engine — core types.
 *
 * Zero runtime dependencies. These interfaces are the contract between the
 * pure layers (normalize → sections → scoring → rules → engine) and the I/O
 * layer (server.ts). Everything here is plain and serializable so snapshots
 * round-trip through Firestore and tests can build fixtures by hand.
 */

import type { ArchivePriority, Tempo } from "@/types/broadcast";

// Which surface a snapshot is built for. Caps/minimums differ per context.
export type RecommendationContext = "website" | "weekly-email";

// Section ids. "start-here" replaces all others for a no-history user.
export type SectionId = "favorite-artists" | "discovery" | "coming-up" | "start-here";

// ── Normalized content (one per candidate archive) ──────────────────────────
export interface ContentItem {
  id: string;
  slug: string;
  showName: string;
  recordingUrl: string;
  showImageUrl?: string;
  durationSec: number;
  recordedAtMs: number; // recordedAt || createdAt
  createdAtMs: number;
  priority: ArchivePriority; // defaults to 'medium' when unset
  tempo: Tempo | null;
  sceneSlugs: string[];
  djUsernames: string[]; // normalized (normalizeForLookup), deduped
  djDisplayNames: string[]; // parallel to djUsernames for reasons/labels
  isPublic: boolean;
}

// Human-readable summary of what the recommendations are based on. Surfaced in
// the admin preview so you can see the user's engagement at a glance.
export interface TasteSummary {
  lovedDjs: string[]; // DJ display names the user hearted
  streamedDjs: string[]; // DJ display names the user streamed
  watchlistDjs: string[]; // search-favorite terms (watchlist)
  archivesStreamed: number; // distinct archives streamed
  sceneCounts: Array<{ scene: string; count: number }>; // streams per scene, desc
  tempoCounts: Array<{ tempo: Tempo; count: number }>; // streams per tempo, desc
}

// ── Per-user taste, built entirely from engagement history ──────────────────
export interface UserSignals {
  uid: string;
  email: string;
  // Normalized DJ usernames the user loved/streamed.
  engagedDjs: Set<string>;
  // Scenes on the archives the user streamed.
  engagedScenes: Set<string>;
  // Tempos on the archives the user streamed.
  engagedTempos: Set<Tempo>;
  // DJs from search favorites (watchlist) — normalized.
  watchlistArtists: Set<string>;
  // Archive ids the user already streamed → already-heard penalty.
  streamedArchiveIds: Set<string>;
  // Per-archive stream count for the penalty strength.
  archiveStreamCount: Record<string, number>;
  // goLiveMutes (normalized) + opt-outs, for exclusion + Section 3 matching.
  goLiveMutes: Set<string>;
  ownDjUsername?: string;
  // Scenes/tempos from the user's OWN archives (DJ users only). Folded into
  // engagedScenes/engagedTempos for matching, AND used to rank-boost discovery
  // picks that match the DJ's own scene/tempo. Empty for non-DJ users.
  selfScenes: Set<string>;
  selfTempos: Set<Tempo>;
  // Display-facing summary of the above (for the admin preview header).
  tasteSummary: TasteSummary;
}

// One candidate = an archive + this user's relationship to it. Pre-derived so
// the scorer is pure arithmetic with no set lookups.
export interface CandidateInput {
  item: ContentItem;
  alreadyStreamedCount: number;
  // Section-1 ties:
  matchedEngagedDjs: string[]; // intersection(item.djUsernames, engagedDjs)
  matchedWatchlistDjs: string[]; // intersection(item.djUsernames, watchlistArtists)
  // Section-2 ties:
  isAffiliated: boolean; // DJ is affiliated / same crew (from the go-live graph)
  affiliatedTo?: string; // display name of the related DJ, for the reason
  sceneTempoMatch: boolean; // scene ∈ engagedScenes AND tempo ∈ engagedTempos
  matchedScenes: string[];
  matchedTempo: Tempo | null;
  // DJ self-taste: archive matches one of the DJ's OWN archives' scene/tempo →
  // gets a discovery rank boost.
  matchesSelfTaste: boolean;
}

// ── Scoring ─────────────────────────────────────────────────────────────────
export type ScoreComponentName =
  | "priority"
  | "recency"
  | "sectionBonus"
  | "selfTasteBoost"
  | "editorialBoost"
  | "alreadyHeardPenalty";

export interface ScoreComponent {
  name: ScoreComponentName;
  rawValue: number;
  weight: number;
  contribution: number; // signed; sum of contributions === score
}

export interface ScoredCandidate {
  item: ContentItem;
  section: SectionId | null; // null = only eligible as fallback-fill
  score: number;
  scoreBreakdown: ScoreComponent[];
  reasons: string[]; // never empty for a delivered item
  // Set by the rule engine:
  rank?: number;
  pinned?: boolean;
  editorialMultiplier?: number;
  isFallback?: boolean;
  excludedReason?: string; // set on dropped candidates (admin inspection only)
}

// ── Editorial overrides (admin-controlled, stored in the config doc) ─────────
export interface EditorialRules {
  boostArchiveIds: Record<string, number>; // archiveId → multiplier
  boostDjUsernames: Record<string, number>; // normalized djUsername → multiplier
  suppressArchiveIds: string[]; // hard-excluded everywhere
  featureArchiveIds: string[]; // pinned to top of their section, in order
}

// ── Admin-tunable config (the Firestore override doc merges over defaults) ───
export interface RecommendationConfig {
  version: number;
  weights: {
    priority: number;
    recency: number;
    sectionBonus: number; // flat bonus for landing in a personalized section
    selfTasteBoost: number; // boost for a DJ user's own scene/tempo (discovery)
  };
  recency: {
    halfLifeDays: number;
    windowDays: number; // only archives newer than this are candidates
  };
  alreadyHeard: {
    penaltyStrength: number; // score /= (1 + count * strength)
  };
  diversity: {
    maxPerDj: number; // cap per DJ within a section
  };
  caps: Record<RecommendationContext, Record<SectionId, number>>;
  minimums: Record<SectionId, number>; // below this → fallback-fill (personalized sections only)
  eligibility: {
    minDurationSec: number;
    requirePublic: boolean;
  };
  editorial: EditorialRules;
  minRegenIntervalMs: number; // global 48h freshness floor
}

// ── Context passed into the pure engine (no globals) ────────────────────────
export interface EngineContext {
  context: RecommendationContext;
  nowMs: number; // injected; never Date.now() inside pure code
}

// One section's final, ranked output.
export interface RecommendationSection {
  id: SectionId;
  title: string;
  items: ScoredCandidate[];
}

export interface RecommendationResult {
  sections: RecommendationSection[];
  dropped: ScoredCandidate[]; // excluded candidates with excludedReason (preview only)
  configVersion: number;
}

// ── Persisted snapshot ──────────────────────────────────────────────────────
export interface SnapshotItem {
  archiveId: string;
  slug: string;
  showName: string;
  showImageUrl?: string;
  djUsernames: string[];
  djDisplayNames: string[];
  sceneSlugs: string[];
  recordingUrl: string;
  durationSec: number;
  rank: number;
  score: number;
  scoreBreakdown: ScoreComponent[];
  reasons: string[];
  pinned: boolean;
  isFallback: boolean;
}

// "Coming up next week" rows are scheduled shows, not archives.
export interface ComingUpItem {
  showId: string;
  showName: string;
  djName?: string;
  djUsername?: string;
  startTimeMs: number;
  reason: string; // favorite | watchlist | engaged | affiliated | crew | borrow
}

export interface SnapshotSection {
  id: SectionId;
  title: string;
  items: SnapshotItem[]; // for favorite-artists + discovery
  comingUp?: ComingUpItem[]; // for coming-up
}

export interface RecommendationSnapshot {
  uid: string;
  context: RecommendationContext;
  generatedAtMs: number;
  generatedBy: "cron" | "admin-preview" | "admin-force" | "website-lazy";
  configVersion: number;
  sections: SnapshotSection[];
  candidateCount: number;
  excludedCount: number;
  // What the recommendations are based on (for inspection / the admin header).
  tasteSummary: TasteSummary;
}

// Static, human-facing section titles.
export const SECTION_TITLES: Record<SectionId, string> = {
  "favorite-artists": "New archives from your favorite artists",
  discovery: "We think you'd like",
  "coming-up": "Coming up next week",
  "start-here": "Start here",
};
