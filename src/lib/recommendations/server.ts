/**
 * Recommendation I/O layer — the ONLY file here that touches firebase-admin.
 *
 * Mirrors the archive-schedule-server.ts pattern: fetch shared data once, build
 * the per-user taste profile from their own subcollections, run the PURE engine
 * (engine.ts), build the coming-up section from the shared go-live matcher over
 * next-week slots, and persist a snapshot. nowMs / Date.now() live only here.
 *
 * Generation scope + load (per the plan):
 *   - cron generates for EMAIL-ENABLED users only, sharded by uid prefix.
 *   - website generates lazily on first visit.
 *   - a global 48h freshness floor (config.minRegenIntervalMs) skips users whose
 *     snapshot is younger than the floor (force/preview bypass it).
 */

import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Archive } from "@/types/broadcast";
import {
  normalizeForLookup,
  buildAffiliationGraph,
  buildAffiliatedRecipients,
  buildRelatedUsernames,
  matchUserToShow,
  failsUniversalGates,
  type AffiliationGraph,
  type CollectiveForGraph,
  type DjUserDoc,
  type MatchableShow,
  type RelationshipSets,
} from "@/lib/go-live-matching";

import type {
  RecommendationContext,
  RecommendationSnapshot,
  RecommendationResult,
  RecommendationConfig,
  ContentItem,
  ComingUpItem,
  TasteSummary,
} from "./types";
import { DEFAULT_RECOMMENDATION_CONFIG, mergeConfig } from "./config";
import { normalizeArchive, normalizeUser, type AffiliationLookup } from "./normalize";
import { generateRecommendations } from "./engine";
import { buildSnapshot, snapshotDocId } from "./snapshot";

const CONFIG_DOC_PATH = { collection: "app-config", id: "recommendations" };
const SNAPSHOT_COLLECTION = "recommendation-snapshots";
const NEXT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Firestore rejects `undefined`. Deep-strip undefined fields before writing a
// snapshot (optional fields like showImageUrl are absent on some archives).
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

// ── Config ───────────────────────────────────────────────────────────────────
export async function loadConfig(db: Firestore): Promise<RecommendationConfig> {
  try {
    const doc = await db.collection(CONFIG_DOC_PATH.collection).doc(CONFIG_DOC_PATH.id).get();
    return mergeConfig(DEFAULT_RECOMMENDATION_CONFIG, doc.exists ? doc.data() : undefined);
  } catch {
    return DEFAULT_RECOMMENDATION_CONFIG;
  }
}

// ── Shared data fetched once per run ──────────────────────────────────────────
export interface SharedData {
  items: ContentItem[];
  archiveById: Map<string, ContentItem>;
  affiliationGraph: AffiliationGraph;
  // normalized DJ username → set of related (crew/borrow) normalized usernames,
  // built once. Per user, an archive DJ U is "affiliated" for Section 2 iff
  // relatedByDj.get(U) intersects the user's engagedDjs.
  relatedByDj: Map<string, Set<string>>;
  // Next-week scheduled shows for the coming-up section.
  upcomingShows: MatchableShow[];
  upcomingStartMsByShowId: Map<string, number>;
  upcomingDjNameByShowId: Map<string, string | undefined>;
  // Effective scenes per upcoming show (override, else the DJ's archive scenes)
  // — used to surface slots from the user's most-engaged scene.
  upcomingScenesByShowId: Map<string, string[]>;
}

function slotStartMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  const ts = value as { toMillis?: () => number; toDate?: () => Date } | undefined;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  const fromToDate = ts?.toDate?.()?.getTime();
  if (typeof fromToDate === "number") return fromToDate;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

export async function loadSharedData(db: Firestore, nowMs: number): Promise<SharedData> {
  // Archives.
  const archiveSnap = await db.collection("archives").get();
  const items: ContentItem[] = [];
  const archiveById = new Map<string, ContentItem>();
  // normalized DJ username → union of scenes across their archives. Used to
  // resolve an upcoming slot's scene when the slot has no scene override.
  const scenesByDj = new Map<string, Set<string>>();
  for (const doc of archiveSnap.docs) {
    const a = { id: doc.id, ...(doc.data() as Omit<Archive, "id">) } as Archive;
    const item = normalizeArchive(a);
    items.push(item);
    archiveById.set(item.id, item);
    for (const dj of item.djUsernames) {
      const set = scenesByDj.get(dj) ?? new Set<string>();
      for (const s of item.sceneSlugs) set.add(s);
      scenesByDj.set(dj, set);
    }
  }

  // DJ-role users + collectives → affiliation graph. A collective's owners form a
  // crew led by the collective itself, so engaging an owner bridges to the
  // collective's content and vice-versa (the existing crew/affiliation tier).
  const [djSnap, collectiveSnap] = await Promise.all([
    db.collection("users").where("role", "==", "dj").get(),
    db.collection("collectives").get(),
  ]);
  const djUsers: DjUserDoc[] = djSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const collectives: CollectiveForGraph[] = collectiveSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      slug: (data.slug as string) || "",
      name: (data.name as string) || "",
      owners: Array.isArray(data.owners) ? (data.owners as string[]).filter(Boolean) : [],
    };
  });
  // slug (normalized) → owner usernames (normalized), for expanding a collective
  // slot's owners in the coming-up matcher.
  const collectiveBySlug = new Map<string, CollectiveForGraph>();
  for (const c of collectives) if (c.slug) collectiveBySlug.set(normalizeForLookup(c.slug), c);

  const affiliationGraph = buildAffiliationGraph(djUsers, collectives);

  // Per-DJ related map, built ONCE: normalized DJ username → its related
  // (crew + audience-borrow) normalized usernames. Per-user Section-2
  // affiliation = intersect this with the user's engagedDjs (cheap).
  const relatedByDj = new Map<string, Set<string>>();
  for (const dj of djUsers) {
    const username = affiliationGraph.uidToUsername.get(dj.id);
    if (!username) continue;
    const fakeShow: MatchableShow = {
      name: "",
      stationId: "broadcast",
      showId: `graph-${dj.id}`,
      djUsername: username,
      djUserId: dj.id,
    };
    const rel = buildRelatedUsernames(fakeShow, affiliationGraph);
    if (rel && rel.related.size > 0) relatedByDj.set(username, rel.related);
  }

  // Collective slug nodes: a collective archive/slot credits the slug (no
  // djUserId), so buildRelatedUsernames can't build its related set. Add it
  // directly = the collective's owner usernames. This is what makes "engage the
  // collective → its owners' content" surface (and the slug appears in a user's
  // engagedDjs when they engaged the collective itself).
  for (const c of collectives) {
    if (!c.slug) continue;
    const slugNorm = normalizeForLookup(c.slug);
    const ownerUsernames = new Set<string>();
    for (const owner of c.owners) {
      const name = affiliationGraph.uidToUsername.get(owner);
      if (name) ownerUsernames.add(name);
    }
    ownerUsernames.delete(slugNorm);
    if (ownerUsernames.size > 0) {
      const existing = relatedByDj.get(slugNorm) ?? new Set<string>();
      for (const n of Array.from(ownerUsernames)) existing.add(n);
      relatedByDj.set(slugNorm, existing);
    }
  }

  // Next-week scheduled shows (broadcast slots).
  const upcomingShows: MatchableShow[] = [];
  const upcomingStartMsByShowId = new Map<string, number>();
  const upcomingDjNameByShowId = new Map<string, string | undefined>();
  const upcomingScenesByShowId = new Map<string, string[]>();
  const slotSnap = await db.collection("broadcast-slots").where("status", "==", "scheduled").get();
  for (const doc of slotSnap.docs) {
    const data = doc.data();
    if (data.djUsername === "channelbroadcast") continue;
    if (data.goLiveEmailsDisabled === true) continue;
    const startMs = slotStartMs(data.startTime);
    if (typeof startMs !== "number") continue;
    if (startMs < nowMs || startMs > nowMs + NEXT_WEEK_MS) continue;
    const showId = `broadcast-${doc.id}`;
    const djUsername = data.djUsername as string | undefined;
    // If the slot's djUsername is a collective slug, expand its owners so the
    // matcher can bridge the slot to fans of any owner.
    const collectiveForSlot = djUsername ? collectiveBySlug.get(normalizeForLookup(djUsername)) : undefined;
    const ownerUsernamesForSlot = collectiveForSlot
      ? collectiveForSlot.owners
          .map((o) => affiliationGraph.uidToUsername.get(o))
          .filter((n): n is string => !!n)
      : undefined;
    upcomingShows.push({
      name: data.showName as string,
      dj: data.djName as string | undefined,
      stationId: "broadcast",
      showId,
      djUsername,
      djUserId: (data.liveDjUserId as string) || (data.djUserId as string) || undefined,
      collectiveOwnerUserIds: collectiveForSlot?.owners.length ? collectiveForSlot.owners : undefined,
      collectiveOwnerUsernames: ownerUsernamesForSlot?.length ? ownerUsernamesForSlot : undefined,
    });
    upcomingStartMsByShowId.set(showId, startMs);
    upcomingDjNameByShowId.set(showId, data.djName as string | undefined);
    // Effective scenes: slot override, else the DJ's archive scenes.
    const override = data.sceneIdsOverride;
    let scenes: string[] = [];
    if (Array.isArray(override)) {
      scenes = override.filter((s): s is string => typeof s === "string");
    } else if (djUsername) {
      scenes = Array.from(scenesByDj.get(normalizeForLookup(djUsername)) ?? []);
    }
    upcomingScenesByShowId.set(showId, scenes);
  }

  return {
    items,
    archiveById,
    affiliationGraph,
    relatedByDj,
    upcomingShows,
    upcomingStartMsByShowId,
    upcomingDjNameByShowId,
    upcomingScenesByShowId,
  };
}

// Build the per-cron relationship sets for the upcoming shows (used by the
// coming-up matcher). Engagement sets are built per-user (forward) below.
function buildUpcomingRelationshipSets(
  shared: SharedData,
): {
  affiliatedRecipientsByShowId: Map<string, Set<string>>;
  relatedUsernamesByShowId: Map<string, Set<string>>;
  borrowedUsernamesByShowId: Map<string, Set<string>>;
} {
  const affiliatedRecipientsByShowId = new Map<string, Set<string>>();
  const relatedUsernamesByShowId = new Map<string, Set<string>>();
  const borrowedUsernamesByShowId = new Map<string, Set<string>>();
  for (const show of shared.upcomingShows) {
    const recipients = buildAffiliatedRecipients(show, shared.affiliationGraph);
    if (recipients) affiliatedRecipientsByShowId.set(show.showId, recipients);
    const rel = buildRelatedUsernames(show, shared.affiliationGraph);
    if (rel) {
      if (rel.related.size > 0) relatedUsernamesByShowId.set(show.showId, rel.related);
      if (rel.borrowed.size > 0) borrowedUsernamesByShowId.set(show.showId, rel.borrowed);
    }
    // Collective slots have no djUserId so buildRelatedUsernames returns null —
    // their crew = the collective's owners, which we pre-built in relatedByDj
    // keyed by the slug. Surface it so fans of an owner match the slot (tier-4
    // affiliation bridge in the matcher).
    if (!relatedUsernamesByShowId.has(show.showId) && show.djUsername) {
      const ownersRelated = shared.relatedByDj.get(normalizeForLookup(show.djUsername));
      if (ownersRelated && ownersRelated.size > 0) {
        relatedUsernamesByShowId.set(show.showId, ownersRelated);
      }
    }
  }
  return { affiliatedRecipientsByShowId, relatedUsernamesByShowId, borrowedUsernamesByShowId };
}

// ── Per-user generation ───────────────────────────────────────────────────────
interface RawUserDoc {
  id: string;
  data: Record<string, unknown>;
}

async function fetchUserDoc(db: Firestore, uid: string): Promise<RawUserDoc | null> {
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) return null;
  return { id: doc.id, data: doc.data() as Record<string, unknown> };
}

async function buildUserResultAndComingUp(
  db: Firestore,
  user: RawUserDoc,
  shared: SharedData,
  config: RecommendationConfig,
  context: RecommendationContext,
  nowMs: number,
  upcomingSets: ReturnType<typeof buildUpcomingRelationshipSets>,
): Promise<{ result: RecommendationResult; comingUp: ComingUpItem[]; tasteSummary: TasteSummary }> {
  const uid = user.id;

  // User's own engagement subcollections (forward reads).
  const [loveSnap, streamSnap, favSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("loveHistory").get(),
    db.collection("users").doc(uid).collection("streamHistory").get(),
    db.collection("users").doc(uid).collection("favorites").where("type", "==", "search").get(),
  ]);

  const loveHistory = loveSnap.docs.map((d) => d.data());
  const streamHistory = streamSnap.docs.map((d) => d.data());
  const searchFavorites = favSnap.docs.map((d) => ({ term: d.data().term as string | undefined }));

  const ownChatUsername =
    (user.data.chatUsernameNormalized as string | undefined) ||
    (user.data.chatUsername as string | undefined);
  const ownDjUsernameNorm = ownChatUsername ? normalizeForLookup(ownChatUsername) : undefined;

  // DJ users: their OWN archives (where they're credited) feed self-taste +
  // the discovery rank boost. Empty for non-DJ users.
  const isDj = (user.data.role as string | undefined) === "dj";
  const ownArchives =
    isDj && ownDjUsernameNorm
      ? shared.items.filter((it) => it.djUsernames.includes(ownDjUsernameNorm))
      : [];

  const signals = normalizeUser({
    uid,
    email: (user.data.email as string) || "",
    loveHistory,
    streamHistory,
    searchFavorites,
    archiveById: shared.archiveById,
    goLiveMutes: (user.data.goLiveMutes as string[] | undefined) || [],
    ownDjUsername: ownChatUsername,
    ownArchives,
  });

  // Section-2 affiliation lookup for THIS user: an archive DJ U is
  // "affiliated/crew" iff U has a related DJ R (from the once-built relatedByDj
  // map) that the user engaged with. Cheap per-user intersection.
  const relatedDisplayForUser = new Map<string, string>();
  for (const [djUsername, relatedSet] of Array.from(shared.relatedByDj.entries())) {
    for (const r of Array.from(relatedSet)) {
      if (signals.engagedDjs.has(r)) {
        relatedDisplayForUser.set(
          djUsername,
          shared.affiliationGraph.normalizedUsernameToDisplay.get(r) || r,
        );
        break;
      }
    }
  }
  const affiliation: AffiliationLookup = { relatedDisplayByDjUsername: relatedDisplayForUser };

  const result = generateRecommendations(signals, shared.items, affiliation, config, {
    context,
    nowMs,
  });

  // Coming-up: run the shared matcher over next-week shows for this user. The
  // matcher's watchlist tier reads raw search terms, so thread them through.
  const searchTerms = searchFavorites.map((f) => f.term || "").filter(Boolean);
  const comingUp = buildComingUp(user, signals, shared, upcomingSets, searchTerms);

  return { result, comingUp, tasteSummary: signals.tasteSummary };
}

function buildComingUp(
  user: RawUserDoc,
  signals: ReturnType<typeof normalizeUser>,
  shared: SharedData,
  upcomingSets: ReturnType<typeof buildUpcomingRelationshipSets>,
  searchTerms: string[],
): ComingUpItem[] {
  const uid = user.id;

  // Forward engagement sets for the matcher: per show, did THIS user engage the
  // live DJ (engagedByShowId) or any related DJ (engagedByRelatedDjByShowId)?
  const engagedByShowId = new Map<string, Set<string>>();
  const engagedByRelatedDjByShowId = new Map<string, Map<string, Set<string>>>();
  for (const show of shared.upcomingShows) {
    if (!show.djUsername) continue;
    const xUser = normalizeForLookup(show.djUsername);
    if (signals.engagedDjs.has(xUser)) engagedByShowId.set(show.showId, new Set([uid]));
    const related = upcomingSets.relatedUsernamesByShowId.get(show.showId);
    if (related) {
      const m = new Map<string, Set<string>>();
      for (const r of Array.from(related)) {
        if (signals.engagedDjs.has(r)) m.set(r, new Set([uid]));
      }
      if (m.size > 0) engagedByRelatedDjByShowId.set(show.showId, m);
    }
  }

  const sets: RelationshipSets = {
    affiliatedRecipientsByShowId: upcomingSets.affiliatedRecipientsByShowId,
    relatedUsernamesByShowId: upcomingSets.relatedUsernamesByShowId,
    borrowedUsernamesByShowId: upcomingSets.borrowedUsernamesByShowId,
    engagedByShowId,
    engagedByRelatedDjByShowId,
    normalizedUsernameToDisplay: shared.affiliationGraph.normalizedUsernameToDisplay,
  };

  // showFavorites (exact-show-name tier) is email-specific; engagement +
  // watchlist + affiliation cover the recommendation use-case for coming-up.
  const userState = {
    userId: uid,
    showFavorites: [] as Array<{ data: Record<string, unknown> }>,
    searchTerms,
    emailNotifications: user.data.emailNotifications as Record<string, unknown> | undefined,
    goLiveMutes: signals.goLiveMutes,
  };

  const out: ComingUpItem[] = [];
  for (const show of shared.upcomingShows) {
    if (failsUniversalGates(show, uid, signals.goLiveMutes)) continue;
    const m = matchUserToShow(show, userState, sets);
    if (!m) continue;
    const reason = m.affiliationBridgeDj
      ? `${m.bridgeKind ?? "crew"} (${m.affiliationBridgeDj})`
      : m.engagementReason
      ? "engaged"
      : m.matchedViaAffiliation
      ? "affiliated"
      : m.savedReason ?? "favorite";
    out.push({
      showId: show.showId,
      showName: show.name,
      djName: shared.upcomingDjNameByShowId.get(show.showId),
      djUsername: show.djUsername,
      startTimeMs: shared.upcomingStartMsByShowId.get(show.showId) ?? 0,
      reason,
    });
  }

  // Also surface upcoming slots in the user's MOST-engaged scene (only if they
  // add — i.e. not already matched above), tagged so the reason is visible.
  const topScene = signals.tasteSummary.sceneCounts[0]?.scene;
  if (topScene) {
    const already = new Set(out.map((o) => o.showId));
    for (const show of shared.upcomingShows) {
      if (already.has(show.showId)) continue;
      if (failsUniversalGates(show, uid, signals.goLiveMutes)) continue;
      const scenes = shared.upcomingScenesByShowId.get(show.showId) ?? [];
      if (!scenes.includes(topScene)) continue;
      out.push({
        showId: show.showId,
        showName: show.name,
        djName: shared.upcomingDjNameByShowId.get(show.showId),
        djUsername: show.djUsername,
        startTimeMs: shared.upcomingStartMsByShowId.get(show.showId) ?? 0,
        reason: `In your top scene: ${topScene}`,
      });
    }
  }

  out.sort((a, b) => a.startTimeMs - b.startTimeMs);
  return out;
}

// ── Public generate API ───────────────────────────────────────────────────────
export interface GenerateOptions {
  persist: boolean;
  generatedBy: RecommendationSnapshot["generatedBy"];
  force?: boolean; // bypass the 48h freshness floor
  nowMs?: number; // injectable for tests; defaults to Date.now()
}

export interface GenerateForUserOutcome {
  snapshot: RecommendationSnapshot | null;
  // The full engine result, including dropped candidates with excludedReason —
  // surfaced for the admin preview's "Excluded (N)" panel. Absent on skip.
  dropped?: RecommendationResult["dropped"];
  skipped?: "fresh" | "no-user";
}

/**
 * Generate (and optionally persist) a snapshot for one user. Respects the 48h
 * freshness floor unless force is set. persist:false → live preview, no write.
 */
export async function generateForUser(
  db: Firestore,
  uid: string,
  context: RecommendationContext,
  opts: GenerateOptions,
  shared?: SharedData,
  config?: RecommendationConfig,
): Promise<GenerateForUserOutcome> {
  const nowMs = opts.nowMs ?? Date.now();
  const cfg = config ?? (await loadConfig(db));

  // 48h freshness floor (skip only when persisting; preview/force ignore it).
  if (opts.persist && !opts.force) {
    const existing = await db.collection(SNAPSHOT_COLLECTION).doc(snapshotDocId(uid, context)).get();
    const prev = existing.data() as RecommendationSnapshot | undefined;
    if (prev && nowMs - prev.generatedAtMs < cfg.minRegenIntervalMs) {
      return { snapshot: prev, skipped: "fresh" };
    }
  }

  const sharedData = shared ?? (await loadSharedData(db, nowMs));
  const upcomingSets = buildUpcomingRelationshipSets(sharedData);

  const user = await fetchUserDoc(db, uid);
  if (!user) return { snapshot: null, skipped: "no-user" };

  const { result, comingUp, tasteSummary } = await buildUserResultAndComingUp(
    db,
    user,
    sharedData,
    cfg,
    context,
    nowMs,
    upcomingSets,
  );

  const snapshot = buildSnapshot(result, {
    uid,
    context,
    generatedAtMs: nowMs,
    generatedBy: opts.generatedBy,
    comingUp,
    tasteSummary,
  });

  if (opts.persist) {
    await db.collection(SNAPSHOT_COLLECTION).doc(snapshotDocId(uid, context)).set(stripUndefined(snapshot));
  }
  return { snapshot, dropped: result.dropped };
}

export async function readSnapshot(
  db: Firestore,
  uid: string,
  context: RecommendationContext,
): Promise<RecommendationSnapshot | null> {
  const doc = await db.collection(SNAPSHOT_COLLECTION).doc(snapshotDocId(uid, context)).get();
  return doc.exists ? (doc.data() as RecommendationSnapshot) : null;
}

// ── All-users (sharded) generation for the cron ───────────────────────────────
export interface GenerateAllResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ uid: string; error: string }>;
  shard: number | null;
}

// Email-enabled eligibility mirrors the newsletter/go-live cohorts: any user
// with showStarting OR djInsiders email notifications on is a candidate.
function isEmailEnabled(data: Record<string, unknown>): boolean {
  const en = data.emailNotifications as Record<string, unknown> | undefined;
  if (!en) return false;
  return en.showStarting === true || en.djInsiders === true || en.watchlistMatch === true;
}

// Cheap deterministic shard by first hex char of the uid.
function uidInShard(uid: string, shard: number, shardCount: number): boolean {
  if (shardCount <= 1) return true;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h % shardCount === shard;
}

export async function generateForAllUsers(
  context: RecommendationContext,
  shard: number | null,
  shardCount: number,
): Promise<GenerateAllResult> {
  const db = getAdminDb();
  if (!db) {
    return { sent: 0, failed: 0, skipped: 0, errors: [{ uid: "-", error: "Firestore not configured" }], shard };
  }
  const nowMs = Date.now();
  const config = await loadConfig(db);
  const shared = await loadSharedData(db, nowMs);
  const upcomingSets = buildUpcomingRelationshipSets(shared);

  const usersSnap = await db.collection("users").get();
  const result: GenerateAllResult = { sent: 0, failed: 0, skipped: 0, errors: [], shard };

  for (const doc of usersSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!data.email) continue;
    if (!isEmailEnabled(data)) continue;
    if (shard != null && !uidInShard(doc.id, shard, shardCount)) continue;

    try {
      // 48h floor check.
      const existing = await db.collection(SNAPSHOT_COLLECTION).doc(snapshotDocId(doc.id, context)).get();
      const prev = existing.data() as RecommendationSnapshot | undefined;
      if (prev && nowMs - prev.generatedAtMs < config.minRegenIntervalMs) {
        result.skipped++;
        continue;
      }

      const { result: recResult, comingUp, tasteSummary } = await buildUserResultAndComingUp(
        db,
        { id: doc.id, data },
        shared,
        config,
        context,
        nowMs,
        upcomingSets,
      );
      const snapshot = buildSnapshot(recResult, {
        uid: doc.id,
        context,
        generatedAtMs: nowMs,
        generatedBy: "cron",
        comingUp,
        tasteSummary,
      });
      await db.collection(SNAPSHOT_COLLECTION).doc(snapshotDocId(doc.id, context)).set(stripUndefined(snapshot));
      result.sent++;
    } catch (e) {
      result.failed++;
      result.errors.push({ uid: doc.id, error: String(e) });
    }
  }

  return result;
}
