/**
 * Shared go-live matching logic.
 *
 * Extracted verbatim from src/app/api/cron/show-starting-emails/route.ts so the
 * same matcher powers BOTH the go-live email cron AND the recommendation
 * engine's "Coming up next week" section. The decision logic is pure: it takes
 * a show, the per-user state, and the pre-built per-cron relationship sets, and
 * returns whether/how the user matches — no Firestore I/O, no Date.now(), no
 * mutable accumulators. Email-specific concerns (daily cap, per-show dedup,
 * dry-run trace, send/stamp) stay in the cron and are NOT part of this module.
 *
 * IMPORTANT: this module must stay behavior-identical to the inline matcher.
 * Relationship sets are keyed by `normalizeForLookup` (strip ALL non-alphanumeric),
 * which is the email cron's own normalizer — distinct from dj-matching's
 * `normalizeUsername` (strips only spaces/hyphens). Both are exported here so
 * callers build sets and look up with the same function.
 */

import { wordBoundaryMatch } from "@/lib/dj-matching";

// Normalize for DJ profile lookup - strip ALL non-alphanumeric and lowercase.
// This matches how pending-dj-profiles stores chatUsernameNormalized, and is
// the canonical key for every relationship-set map below.
export function normalizeForLookup(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The subset of a "live show" the matcher actually reads. The email cron's
// LiveShow is a superset of this; broadcast-slot-derived shows for the
// recommendation engine only need to populate these fields.
export interface MatchableShow {
  name: string;
  dj?: string;
  stationId: string;
  showId: string;
  djUsername?: string;
  djUserId?: string;
  collectiveOwnerUsernames?: string[];
  collectiveOwnerUserIds?: string[];
}

// Per-user state the matcher closes over. In the email cron these are fetched
// per user inside the loop; here they're explicit parameters.
export interface MatchUserState {
  userId: string;
  // "show"-type favorites: each carries { term, stationId, showName }.
  showFavorites: Array<{ data: Record<string, unknown> }>;
  // "search"-type favorite terms (raw strings).
  searchTerms: string[];
  // user.emailNotifications object (for engagementGoLive / affiliatedGoLive opt-outs).
  emailNotifications?: Record<string, unknown>;
  // user.goLiveMutes — normalized DJ usernames the user muted.
  goLiveMutes: Set<string>;
}

// Per-cron relationship sets, built once over the union of matchable shows.
// All keyed by showId; username sets keyed by normalizeForLookup form.
export interface RelationshipSets {
  affiliatedRecipientsByShowId: Map<string, Set<string>>;
  relatedUsernamesByShowId: Map<string, Set<string>>;
  borrowedUsernamesByShowId: Map<string, Set<string>>;
  engagedByShowId: Map<string, Set<string>>;
  engagedByRelatedDjByShowId: Map<string, Map<string, Set<string>>>;
  normalizedUsernameToDisplay: Map<string, string>;
}

export interface MatchResult {
  matchedViaAffiliation: boolean;
  affiliationBridgeDj?: string;
  bridgeKind?: "crew" | "borrow";
  engagementReason?: "engaged";
  savedReason?: "favorite" | "watchlist";
}

/**
 * The 4-tier unified matcher: favorite → watchlist → direct engagement →
 * affiliation / audience bridge. Returns match metadata if the user matched
 * (and how), or null. Pure: identical (show, userState, sets) → identical result.
 *
 * Channel Radio only — go-live matching never fires for external-station shows.
 */
export function matchUserToShow(
  show: MatchableShow,
  userState: MatchUserState,
  sets: RelationshipSets,
): MatchResult | null {
  const { userId, showFavorites, searchTerms, emailNotifications, goLiveMutes } = userState;
  void goLiveMutes; // gates handled by failsUniversalGates; kept on state for symmetry

  let matched = false;
  let matchedViaAffiliation = false;
  let affiliationBridgeDj: string | undefined;
  let bridgeKind: "crew" | "borrow" | undefined;
  let engagementReason: "engaged" | undefined;
  let savedReason: "favorite" | "watchlist" | undefined;

  // Channel Radio only. Go-live emails never fire for external-station shows
  // (nts, subtle, dublab, rinse, sutro, …), for ANY recipient or match tier.
  if (show.stationId !== "broadcast") return null;

  // Tier 1: favorite show (exact name match).
  for (const fav of showFavorites) {
    const favTerm = ((fav.data.term as string) || "").toLowerCase();
    const favStation = (fav.data.stationId as string) || "";
    const favShowName = ((fav.data.showName as string) || "").toLowerCase();
    if (
      (favStation === show.stationId || !favStation) &&
      (favTerm === show.name.toLowerCase() || favShowName === show.name.toLowerCase())
    ) {
      matched = true;
      savedReason = "favorite";
      break;
    }
  }

  // Tier 2: watchlist (search-favorite word-boundary match).
  if (!matched) {
    for (const term of searchTerms) {
      if (
        wordBoundaryMatch(show.name, term) ||
        (show.dj && wordBoundaryMatch(show.dj, term)) ||
        (show.collectiveOwnerUsernames && show.collectiveOwnerUsernames.some((u) => wordBoundaryMatch(u, term)))
      ) {
        matched = true;
        savedReason = "watchlist";
        break;
      }
    }
  }

  // Tier 3: direct engagement (hearted/streamed this DJ).
  if (!matched && show.stationId === "broadcast") {
    const engaged = sets.engagedByShowId.get(show.showId);
    if (engaged?.has(userId)) {
      const optOut = emailNotifications?.engagementGoLive === false;
      if (!optOut) {
        matched = true;
        engagementReason = "engaged";
      }
    }
  }

  // Tier 4: affiliation / audience bridge.
  if (!matched) {
    const affOptOut = emailNotifications?.affiliatedGoLive === false;
    if (!affOptOut) {
      const affiliatedRecipients = sets.affiliatedRecipientsByShowId.get(show.showId);
      if (affiliatedRecipients?.has(userId)) {
        matched = true;
        matchedViaAffiliation = true;
      } else if (show.stationId === "broadcast") {
        const related = sets.relatedUsernamesByShowId.get(show.showId);
        const borrowed = sets.borrowedUsernamesByShowId.get(show.showId);
        const engagedByR = sets.engagedByRelatedDjByShowId.get(show.showId);
        if (related) {
          for (const r of Array.from(related)) {
            let bridged = false;
            for (const term of searchTerms) {
              if (wordBoundaryMatch(r, term)) {
                bridged = true;
                break;
              }
            }
            if (!bridged && engagedByR?.get(r)?.has(userId)) bridged = true;
            if (bridged) {
              matched = true;
              matchedViaAffiliation = true;
              // r is the normalized username; show the DJ's raw chatUsername in
              // the caption. Falls back to r if no display is found.
              affiliationBridgeDj = sets.normalizedUsernameToDisplay.get(r) || r;
              // borrowed[] already excludes any crew member, so membership here
              // means audience-borrow; otherwise crew.
              bridgeKind = borrowed?.has(r) ? "borrow" : "crew";
              break;
            }
          }
        }
      }
    }
  }

  return matched
    ? { matchedViaAffiliation, affiliationBridgeDj, bridgeKind, engagementReason, savedReason }
    : null;
}

/**
 * Universal gates that must hold for ANY show going to a recipient. Returns
 * true if the show should be skipped for this user (muted DJ, no resolvable
 * DJ/collective, the user is the DJ, or the user is a collective owner).
 */
export function failsUniversalGates(
  show: MatchableShow,
  userId: string,
  goLiveMutes: Set<string>,
): boolean {
  if (show.djUsername && goLiveMutes.has(show.djUsername)) return true;
  if (!show.djUserId && !(show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.length > 0)) return true;
  if (show.djUserId === userId) return true;
  if (show.collectiveOwnerUserIds && show.collectiveOwnerUserIds.includes(userId)) return true;
  return false;
}

// ── Relationship-set builders ──────────────────────────────────────────────
// Pure given already-fetched DJ-role user docs. The email cron and the
// recommendation engine both call these to construct the per-show maps that
// matchUserToShow() consumes. Engagement sets (engagedByShowId /
// engagedByRelatedDjByShowId) are built differently per caller (reverse
// collection-group in the cron vs forward per-user reads in the rec engine),
// so they are NOT built here — only the affiliation/crew/audience graph is.

export interface DjUserDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface AffiliationGraph {
  affiliatedByLiveDjUid: Map<string, string>;
  affiliatesByUid: Map<string, Set<string>>;
  audienceUidsByLiveDjUid: Map<string, string[]>;
  uidToUsername: Map<string, string>;
  normalizedUsernameToDisplay: Map<string, string>;
}

/**
 * Build the affiliation / audience graph from DJ-role user docs. Pure.
 */
export function buildAffiliationGraph(djUsers: DjUserDoc[]): AffiliationGraph {
  const affiliatedByLiveDjUid = new Map<string, string>();
  const affiliatesByUid = new Map<string, Set<string>>();
  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const aff = djProfile?.affiliatedWithUid as string | undefined;
    if (!aff) continue;
    affiliatedByLiveDjUid.set(djUser.id, aff);
    const bucket = affiliatesByUid.get(aff) ?? new Set<string>();
    bucket.add(djUser.id);
    affiliatesByUid.set(aff, bucket);
  }

  const uidToUsername = new Map<string, string>();
  const normalizedUsernameToDisplay = new Map<string, string>();
  for (const djUser of djUsers) {
    const rawChatUsername = djUser.data.chatUsername as string | undefined;
    const cu = (djUser.data.chatUsernameNormalized as string | undefined) || rawChatUsername;
    if (cu) {
      const normalized = normalizeForLookup(cu);
      uidToUsername.set(djUser.id, normalized);
      if (rawChatUsername) normalizedUsernameToDisplay.set(normalized, rawChatUsername);
    }
  }

  const audienceUidsByLiveDjUid = new Map<string, string[]>();
  for (const djUser of djUsers) {
    const djProfile = djUser.data.djProfile as Record<string, unknown> | undefined;
    const aud = djProfile?.audienceDjUids;
    if (Array.isArray(aud) && aud.length > 0) {
      audienceUidsByLiveDjUid.set(
        djUser.id,
        aud.filter((u): u is string => typeof u === "string" && u.length > 0),
      );
    }
  }

  return {
    affiliatedByLiveDjUid,
    affiliatesByUid,
    audienceUidsByLiveDjUid,
    uidToUsername,
    normalizedUsernameToDisplay,
  };
}

/**
 * Per-show affiliated-recipient UID set (parent + direct affiliates + siblings,
 * minus the live DJ). Pure. Returns null if empty.
 */
export function buildAffiliatedRecipients(
  show: MatchableShow,
  graph: AffiliationGraph,
): Set<string> | null {
  if (!show.djUserId) return null;
  const recipients = new Set<string>();
  const xAffiliation = graph.affiliatedByLiveDjUid.get(show.djUserId);
  if (xAffiliation) recipients.add(xAffiliation);
  const directAffiliates = graph.affiliatesByUid.get(show.djUserId);
  if (directAffiliates) directAffiliates.forEach((uid) => recipients.add(uid));
  if (xAffiliation) {
    const siblings = graph.affiliatesByUid.get(xAffiliation);
    if (siblings) siblings.forEach((uid) => recipients.add(uid));
  }
  recipients.delete(show.djUserId);
  return recipients.size > 0 ? recipients : null;
}

/**
 * Per-show related-DJ username sets: `related` (audience-borrow ∪ crew, keyed by
 * normalized username) and `borrowed` (audience-borrow only, with crew removed
 * so crew wins the caption). Pure. Only meaningful for broadcast shows.
 */
export function buildRelatedUsernames(
  show: MatchableShow,
  graph: AffiliationGraph,
): { related: Set<string>; borrowed: Set<string> } | null {
  if (show.stationId !== "broadcast") return null;
  if (!show.djUserId || !show.djUsername) return null;
  const related = new Set<string>();
  const borrowed = new Set<string>();

  // 1. Audience-lent
  const audUids = graph.audienceUidsByLiveDjUid.get(show.djUserId);
  if (audUids) {
    audUids.forEach((uid) => {
      const name = graph.uidToUsername.get(uid);
      if (name) {
        related.add(name);
        borrowed.add(name);
      }
    });
  }

  // 2. Crew/affiliation — crew names also land in `related`; removed from
  // `borrowed` so a DJ who is both crew and audience-lent is captioned as crew.
  const addCrew = (name: string) => {
    related.add(name);
    borrowed.delete(name);
  };
  const xAffiliation = graph.affiliatedByLiveDjUid.get(show.djUserId);
  if (xAffiliation) {
    const name = graph.uidToUsername.get(xAffiliation);
    if (name) addCrew(name);
  }
  const directAffiliates = graph.affiliatesByUid.get(show.djUserId);
  if (directAffiliates) {
    directAffiliates.forEach((uid) => {
      const name = graph.uidToUsername.get(uid);
      if (name) addCrew(name);
    });
  }
  if (xAffiliation) {
    const siblings = graph.affiliatesByUid.get(xAffiliation);
    if (siblings) {
      siblings.forEach((uid) => {
        const name = graph.uidToUsername.get(uid);
        if (name) addCrew(name);
      });
    }
  }

  const selfNorm = normalizeForLookup(show.djUsername);
  related.delete(selfNorm);
  borrowed.delete(selfNorm);

  if (related.size === 0 && borrowed.size === 0) return null;
  return { related, borrowed };
}
