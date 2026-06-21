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

// Effective scenes for an archive: override wins, else denormalized slugs.
function effectiveScenes(a: Archive): string[] {
  if (Array.isArray(a.sceneIdsOverride)) return a.sceneIdsOverride;
  return a.sceneSlugs ?? [];
}

/** Archive doc → normalized ContentItem. Pure. */
export function normalizeArchive(a: Archive): ContentItem {
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
    sceneSlugs: effectiveScenes(a),
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

  // Loved DJs.
  for (const d of args.loveHistory) {
    const norm = d.djUsernameNormalized || (d.djUsername ? normalizeForLookup(d.djUsername) : undefined);
    if (norm) engagedDjs.add(norm);
  }

  // Streamed DJs + scenes/tempos from the streamed archives.
  for (const d of args.streamHistory) {
    for (const n of d.djUsernamesNormalized ?? []) {
      if (n) engagedDjs.add(n);
    }
    for (const dj of d.djUsernames ?? []) {
      const handle = dj.username || dj.name;
      if (handle) engagedDjs.add(normalizeForLookup(handle));
    }
    if (d.archiveId) {
      streamedArchiveIds.add(d.archiveId);
      archiveStreamCount[d.archiveId] = d.streamCount ?? 1;
      const item = args.archiveById.get(d.archiveId);
      if (item) {
        for (const s of item.sceneSlugs) engagedScenes.add(s);
        if (item.tempo) engagedTempos.add(item.tempo);
      }
    }
  }

  // Watchlist artists (search favorites).
  for (const f of args.searchFavorites) {
    if (f.term) watchlistArtists.add(normalizeForLookup(f.term));
  }

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
    ownDjUsername: args.ownDjUsername ? normalizeForLookup(args.ownDjUsername) : undefined,
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
    };
  });
}
