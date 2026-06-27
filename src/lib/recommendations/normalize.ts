/**
 * Input layer — pure normalizers.
 *
 * Turns already-fetched plain docs (Archive, a user's loveHistory/streamHistory
 * docs) into the engine's normalized inputs. No Firestore, no Date.now(), no
 * Math.random(). The taste profile is built ENTIRELY from engagement history:
 * the DJs, scenes, and tempos on the archives a user loved/streamed.
 */

import type { Archive, Tempo } from "@/types/broadcast";
import { normalizeForLookup } from "@/lib/go-live-matching";
import type {
  ContentItem,
  UserSignals,
  CandidateInput,
} from "./types";

// Normalized DJ username → scene ids (from the DJ's profile). Lets an archive
// inherit its DJ's scenes when it has no scene tag of its own — mirroring the
// app's resolveArchiveScenes. Built in the I/O layer, passed in to stay pure.
export type DjSceneMap = Map<string, string[]>;

// Build the DJ-username → profile-scenes map from already-fetched DJ docs.
// Pure. Keyed by normalizeForLookup(chatUsername) to match archive DJ keys.
export function buildDjSceneMap(
  djDocs: Array<{ data: Record<string, unknown> }>,
): DjSceneMap {
  const map: DjSceneMap = new Map();
  for (const d of djDocs) {
    const data = d.data;
    const handle =
      (data.chatUsernameNormalized as string | undefined) ||
      (data.chatUsername as string | undefined);
    if (!handle) continue;
    const profile = data.djProfile as Record<string, unknown> | undefined;
    const sceneIds = (profile?.sceneIds as string[] | undefined) || [];
    if (sceneIds.length > 0) map.set(normalizeForLookup(handle), sceneIds);
  }
  return map;
}

// Effective scenes for an archive: use what's on the ARCHIVE (override, else
// denormalized slugs); if the archive has none, inherit the DJs' profile
// scenes. This is why a spiral DJ's untagged archive still counts as spiral.
function effectiveScenes(a: Archive, djUsernamesNorm: string[], djSceneMap?: DjSceneMap): string[] {
  const own =
    a.sceneIdsOverride && a.sceneIdsOverride.length > 0
      ? a.sceneIdsOverride
      : a.sceneSlugs && a.sceneSlugs.length > 0
        ? a.sceneSlugs
        : [];
  if (own.length > 0) return own;
  if (djSceneMap) {
    const out = new Set<string>();
    for (const u of djUsernamesNorm) {
      for (const s of djSceneMap.get(u) ?? []) out.add(s);
    }
    if (out.size > 0) return Array.from(out);
  }
  return [];
}

/** Archive doc → normalized ContentItem. Pure. djSceneMap optional. */
export function normalizeArchive(a: Archive, djSceneMap?: DjSceneMap): ContentItem {
  const djUsernames: string[] = [];
  const djDisplayNames: string[] = [];
  const seen = new Set<string>();
  for (const dj of a.djs ?? []) {
    const handle = dj.username || dj.name;
    if (!handle) continue;
    const norm = normalizeForLookup(handle);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    djUsernames.push(norm);
    djDisplayNames.push(dj.name || dj.username || norm);
  }
  return {
    id: a.id,
    slug: a.slug,
    showName: a.showName,
    recordingUrl: a.recordingUrl,
    showImageUrl: a.showImageUrl,
    durationSec: a.duration,
    recordedAtMs: a.recordedAt || a.createdAt,
    createdAtMs: a.createdAt,
    priority: a.priority ?? "medium",
    tempo: a.tempo ?? null,
    sceneSlugs: effectiveScenes(a, djUsernames, djSceneMap),
    djUsernames,
    djDisplayNames,
    isPublic: a.isPublic !== false,
  };
}

// Minimal shapes of the per-user docs we read (plain, already fetched).
export interface RawLoveHistoryDoc {
  djUsername?: string;
  djUsernameNormalized?: string;
  djDisplayName?: string;
}
export interface RawStreamHistoryDoc {
  archiveId?: string;
  djUsernames?: { username?: string; name?: string }[];
  djUsernamesNormalized?: string[];
  streamCount?: number;
}
export interface RawSearchFavoriteDoc {
  term?: string;
}

export interface NormalizeUserArgs {
  uid: string;
  email: string;
  loveHistory: RawLoveHistoryDoc[];
  streamHistory: RawStreamHistoryDoc[];
  searchFavorites: RawSearchFavoriteDoc[];
  // archive id → its tempo+scenes, so we can read taste off streamed archives.
  archiveById: Map<string, ContentItem>;
  goLiveMutes?: string[];
  ownDjUsername?: string;
  // Normalized slugs of collectives the user owns. Their archives are excluded
  // from New Favorites / Discovery alongside the user's own shows.
  ownedCollectiveSlugs?: string[];
  // DJ users only: the user's OWN archives (already normalized). Their scenes
  // and tempos are folded into the taste profile AND drive the discovery boost.
  ownArchives?: ContentItem[];
}

/**
 * Build the per-user taste profile from engagement history. Pure.
 * engagedScenes/engagedTempos come from the archives the user actually streamed.
 */
export function normalizeUser(args: NormalizeUserArgs): UserSignals {
  const engagedDjs = new Set<string>();
  const engagedScenes = new Set<string>();
  const engagedTempos = new Set<Tempo>();
  const watchlistArtists = new Set<string>();
  const streamedArchiveIds = new Set<string>();
  const archiveStreamCount: Record<string, number> = {};

  // Display-name + count collectors for the taste summary.
  const lovedDjNames = new Set<string>();
  const streamedDjNames = new Set<string>();
  const streamedArchiveNames = new Map<string, string>(); // archiveId → showName
  const watchlistTerms: string[] = [];
  const sceneCount = new Map<string, number>();
  const tempoCount = new Map<Tempo, number>();

  // Loved DJs.
  for (const d of args.loveHistory) {
    const norm = d.djUsernameNormalized || (d.djUsername ? normalizeForLookup(d.djUsername) : undefined);
    if (norm) engagedDjs.add(norm);
    const display = d.djDisplayName || d.djUsername;
    if (display) lovedDjNames.add(display);
  }

  // Streamed DJs + scenes/tempos from the streamed archives.
  for (const d of args.streamHistory) {
    for (const n of d.djUsernamesNormalized ?? []) {
      if (n) engagedDjs.add(n);
    }
    for (const dj of d.djUsernames ?? []) {
      const handle = dj.username || dj.name;
      if (handle) engagedDjs.add(normalizeForLookup(handle));
      if (dj.name) streamedDjNames.add(dj.name);
    }
    if (d.archiveId) {
      streamedArchiveIds.add(d.archiveId);
      const streams = d.streamCount ?? 1;
      archiveStreamCount[d.archiveId] = streams;
      const item = args.archiveById.get(d.archiveId);
      if (item) {
        if (item.showName) streamedArchiveNames.set(d.archiveId, item.showName);
        for (const s of item.sceneSlugs) {
          engagedScenes.add(s);
          sceneCount.set(s, (sceneCount.get(s) ?? 0) + 1);
        }
        if (item.tempo) {
          engagedTempos.add(item.tempo);
          tempoCount.set(item.tempo, (tempoCount.get(item.tempo) ?? 0) + 1);
        }
      }
    }
  }

  // Watchlist artists (search favorites).
  for (const f of args.searchFavorites) {
    if (f.term) {
      watchlistArtists.add(normalizeForLookup(f.term));
      watchlistTerms.push(f.term);
    }
  }

  // DJ self-taste: a DJ's OWN archives' scenes/tempos count as taste (a
  // priority). Folded into the engaged sets so they drive matching, kept
  // separately (selfScenes/selfTempos) so the scorer can boost matching picks,
  // AND merged into the scene/tempo counts so they (a) show in the admin taste
  // summary and (b) feed the affinity ranking just like streamed archives do.
  // Each distinct own archive counts DOUBLE (+2 per scene/tempo vs. a streamed
  // archive's +1) — a DJ's own catalog is the strongest taste signal, regardless
  // of whether the archive was a live recording or a pre-recording (own = own).
  // Merged silently — indistinguishable from streamed taste in the counts.
  const SELF_WEIGHT = 2;
  const selfScenes = new Set<string>();
  const selfTempos = new Set<Tempo>();
  for (const own of args.ownArchives ?? []) {
    for (const s of own.sceneSlugs) {
      selfScenes.add(s);
      engagedScenes.add(s);
      sceneCount.set(s, (sceneCount.get(s) ?? 0) + SELF_WEIGHT);
    }
    if (own.tempo) {
      selfTempos.add(own.tempo);
      engagedTempos.add(own.tempo);
      tempoCount.set(own.tempo, (tempoCount.get(own.tempo) ?? 0) + SELF_WEIGHT);
    }
  }

  const tasteSummary = {
    lovedDjs: Array.from(lovedDjNames),
    streamedDjs: Array.from(streamedDjNames),
    watchlistDjs: watchlistTerms,
    archivesStreamed: streamedArchiveIds.size,
    streamedArchives: Array.from(streamedArchiveNames.values()).sort((a, b) => a.localeCompare(b)),
    sceneCounts: Array.from(sceneCount.entries())
      .map(([scene, count]) => ({ scene, count }))
      .sort((a, b) => b.count - a.count || a.scene.localeCompare(b.scene)),
    tempoCounts: Array.from(tempoCount.entries())
      .map(([tempo, count]) => ({ tempo, count }))
      .sort((a, b) => b.count - a.count),
  };

  const ownDjUsername = args.ownDjUsername ? normalizeForLookup(args.ownDjUsername) : undefined;
  // Never show the user their OWN archives or their OWN collective's archives in
  // New Favorites / Discovery. (Affiliated DJs are NOT excluded.)
  const excludedDjUsernames = new Set<string>();
  if (ownDjUsername) excludedDjUsernames.add(ownDjUsername);
  for (const slug of args.ownedCollectiveSlugs ?? []) excludedDjUsernames.add(normalizeForLookup(slug));

  return {
    uid: args.uid,
    email: args.email,
    engagedDjs,
    engagedScenes,
    engagedTempos,
    watchlistArtists,
    streamedArchiveIds,
    archiveStreamCount,
    goLiveMutes: new Set((args.goLiveMutes ?? []).map((m) => normalizeForLookup(m))),
    ownDjUsername,
    excludedDjUsernames,
    selfScenes,
    selfTempos,
    tasteSummary,
  };
}

// A lookup the engine passes in for Section-2 affiliation ties: normalized DJ
// username → true if the user is affiliated/crew-related to a DJ they engaged
// with, plus the display name of that related DJ. Built in server.ts from the
// go-live affiliation graph; kept as a plain map so normalize stays pure.
export interface AffiliationLookup {
  // item DJ username (normalized) → display name of the engaged/related DJ
  // this archive bridges from. Presence = affiliated/crew tie.
  relatedDisplayByDjUsername: Map<string, string>;
}

/**
 * Build one CandidateInput per archive for a given user. Pure: pre-derives the
 * per-(user,item) cross-products so the scorer is plain arithmetic.
 */
export function buildCandidateInputs(
  user: UserSignals,
  items: ContentItem[],
  affiliation: AffiliationLookup,
): CandidateInput[] {
  // Per-user engagement strength by scene + tempo (from the taste summary), and
  // the max combined strength, so each candidate's scene+tempo affinity can be
  // normalized to 0..1. A user's most-engaged scene+tempo → affinity ~1.
  const sceneCount = new Map(user.tasteSummary.sceneCounts.map((s) => [s.scene, s.count]));
  const tempoCount = new Map(user.tasteSummary.tempoCounts.map((t) => [t.tempo, t.count]));
  let maxAffinity = 0;
  for (const item of items) {
    const sc = Math.max(0, ...item.sceneSlugs.map((s) => sceneCount.get(s) ?? 0));
    const tc = item.tempo ? tempoCount.get(item.tempo) ?? 0 : 0;
    if (sc + tc > maxAffinity) maxAffinity = sc + tc;
  }
  // The user's single TOP engaged scene + tempo (for discovery tiers 3 & 4).
  const topScene = user.tasteSummary.sceneCounts[0]?.scene;
  const topTempo = user.tasteSummary.tempoCounts[0]?.tempo;
  const notLowHidden = (p: ContentItem["priority"]) => p !== "low" && p !== "hidden";
  const isHighFeatured = (p: ContentItem["priority"]) => p === "featured" || p === "high";

  return items.map((item) => {
    const matchedEngagedDjs = item.djUsernames.filter((u) => user.engagedDjs.has(u));
    const matchedWatchlistDjs = item.djUsernames.filter((u) => user.watchlistArtists.has(u));

    let isAffiliated = false;
    let affiliatedTo: string | undefined;
    for (const u of item.djUsernames) {
      const display = affiliation.relatedDisplayByDjUsername.get(u);
      if (display) {
        isAffiliated = true;
        affiliatedTo = display;
        break;
      }
    }

    const matchedScenes = item.sceneSlugs.filter((s) => user.engagedScenes.has(s));
    const tempoEngaged = item.tempo != null && user.engagedTempos.has(item.tempo);
    const sceneTempoMatch = matchedScenes.length > 0 && tempoEngaged;

    // DJ self-taste: archive shares a scene OR tempo with the DJ's own archives.
    const matchesSelfTaste =
      item.sceneSlugs.some((s) => user.selfScenes.has(s)) ||
      (item.tempo != null && user.selfTempos.has(item.tempo));

    // Engagement strength for this candidate's scene+tempo, normalized 0..1.
    const sc = Math.max(0, ...item.sceneSlugs.map((s) => sceneCount.get(s) ?? 0));
    const tc = item.tempo ? tempoCount.get(item.tempo) ?? 0 : 0;
    const sceneTempoAffinity = maxAffinity > 0 ? (sc + tc) / maxAffinity : 0;

    // Strict discovery tier (Suggestions). First matching tier wins.
    let discoveryTier: 1 | 2 | 3 | 4 | null = null;
    if (sceneTempoMatch && notLowHidden(item.priority)) {
      discoveryTier = 1; // engaged this EXACT scene+tempo
    } else if (isAffiliated && notLowHidden(item.priority)) {
      discoveryTier = 2; // affiliated / same crew / same audience
    } else if (isHighFeatured(item.priority) && topScene && item.sceneSlugs.includes(topScene)) {
      discoveryTier = 3; // featured/high in the user's top scene
    } else if (isHighFeatured(item.priority) && topTempo && item.tempo === topTempo) {
      discoveryTier = 4; // featured/high in the user's top tempo
    }

    return {
      item,
      alreadyStreamedCount: user.archiveStreamCount[item.id] ?? 0,
      matchedEngagedDjs,
      matchedWatchlistDjs,
      isAffiliated,
      affiliatedTo,
      sceneTempoMatch,
      matchedScenes,
      matchedTempo: tempoEngaged ? item.tempo : null,
      sceneTempoAffinity,
      discoveryTier,
      matchesSelfTaste,
    };
  });
}
