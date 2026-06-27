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

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — same shared body for every visitor
let cache: { at: number; body: FeaturedPayload } | null = null;

export function isFeaturedCacheWarm(nowMs: number): boolean {
  return !!cache && nowMs - cache.at < CACHE_TTL_MS;
}

/**
 * Build (or return cached) the featured payload. Same result for every visitor,
 * changes slowly → cached 5 min in-process.
 */
export async function getFeaturedPayload(db: Firestore, nowMs: number): Promise<FeaturedPayload> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.body;

  const archivesSnap = await db.collection("archives").get();
  const docs: ArchiveSerialized[] = archivesSnap.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as Omit<Archive, "id">) }) as ArchiveSerialized,
  );
  const archives = buildFeaturedMatrix(docs);

  // No city gate / no DJ reasons (same as the logged-out coming-up).
  const comingUp = await fetchComingUp({ db, nowMs, userCity: null, engagedDjUsernames: new Set() });

  const body: FeaturedPayload = {
    archives,
    comingUp,
    startHereTitle: "Start here",
    comingUpTitle: "Coming up",
  };
  cache = { at: nowMs, body };
  return body;
}
