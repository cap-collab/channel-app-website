/**
 * Shared "featured / Start here" payload — the logged-out /scene view, ALSO
 * served to logged-in users who have NO engagement yet (so a brand-new user gets
 * the cached featured grid instantly instead of paying for a full snapshot
 * generation). Single source of truth + a short in-process cache so both the
 * /featured route and /me's no-history branch reuse the same result.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Archive, ArchiveSerialized } from "@/types/broadcast";
import { buildFeaturedMatrix } from "./featured-matrix";
import { fetchComingUp, type ComingUpRow } from "./coming-up";

export interface FeaturedPayload {
  archives: ArchiveSerialized[];
  comingUp: ComingUpRow[];
  startHereTitle: string;
  comingUpTitle: string;
}

// Global default featured city when no recipient/device city is available.
export const DEFAULT_FEATURED_CITY = "Los Angeles";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
// The featured ARCHIVE grid is city-agnostic, so cache it. Coming-up varies by
// city, but fetchComingUp has its OWN shared-data cache, so the per-city filter
// is cheap and runs fresh each call.
let archivesCache: { at: number; archives: ArchiveSerialized[] } | null = null;

export function isFeaturedCacheWarm(nowMs: number): boolean {
  return !!archivesCache && nowMs - archivesCache.at < CACHE_TTL_MS;
}

/**
 * Build (or return cached) the featured payload, city-gated for the given
 * viewer. `userCity` null → no city gate (all IRL events). The featured grid is
 * cached; coming-up is computed per-city (cheap via fetchComingUp's own cache).
 */
export async function getFeaturedPayload(
  db: Firestore,
  nowMs: number,
  userCity: string | null = DEFAULT_FEATURED_CITY,
): Promise<FeaturedPayload> {
  let archives: ArchiveSerialized[];
  if (archivesCache && nowMs - archivesCache.at < CACHE_TTL_MS) {
    archives = archivesCache.archives;
  } else {
    const archivesSnap = await db.collection("archives").get();
    const docs: ArchiveSerialized[] = archivesSnap.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Omit<Archive, "id">) }) as ArchiveSerialized,
    );
    archives = buildFeaturedMatrix(docs);
    archivesCache = { at: nowMs, archives };
  }

  const comingUp = await fetchComingUp({ db, nowMs, userCity, engagedDjUsernames: new Set() });

  return {
    archives,
    comingUp,
    startHereTitle: "Start here",
    comingUpTitle: "Coming up",
  };
}
