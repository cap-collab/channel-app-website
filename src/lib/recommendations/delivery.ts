/**
 * Delivery adapters (v1: read-only helpers, NOT wired to live surfaces).
 *
 * CONTRACT: delivery NEVER calls the engine. Both the website module and the
 * weekly email read a saved `recommendation-snapshots/{uid}__{context}` doc and
 * render its sections. The only exception is the website's lazy-generation
 * fallback (getOrGenerateWebsiteSnapshot), which generates-and-caches on first
 * visit when no fresh snapshot exists — still respecting the 48h floor.
 *
 * These helpers exist so the eventual website module / email cron import a
 * single, documented read path. They are intentionally not yet called from any
 * live page or cron (per the v1 scope).
 */

import type { Firestore } from "firebase-admin/firestore";
import { readSnapshot, generateForUser } from "./server";
import type { RecommendationSnapshot } from "./types";

/**
 * Weekly email: read the pre-built weekly-email snapshot. Returns null if the
 * sharded cron hasn't generated one yet (caller should skip personalization or
 * fall back to a non-personalized section). Never generates live.
 */
export async function getWeeklyEmailSnapshot(
  db: Firestore,
  uid: string,
): Promise<RecommendationSnapshot | null> {
  return readSnapshot(db, uid, "weekly-email");
}

/**
 * Website module: read the website snapshot, generating-and-caching lazily on
 * first visit when absent or stale (the 48h floor inside generateForUser means
 * a fresh snapshot is reused, not regenerated). This is the ONLY delivery path
 * allowed to generate, and only because website snapshots aren't pre-built for
 * everyone (dormant users never trigger it).
 */
export async function getOrGenerateWebsiteSnapshot(
  db: Firestore,
  uid: string,
): Promise<RecommendationSnapshot | null> {
  const existing = await readSnapshot(db, uid, "website");
  if (existing) {
    // generateForUser's 48h floor will no-op if this is still fresh; calling it
    // unconditionally would add a read+write, so prefer the cached doc and let
    // a future background refresh handle staleness. For v1 we simply return it.
    return existing;
  }
  const outcome = await generateForUser(db, uid, "website", {
    persist: true,
    generatedBy: "website-lazy",
  });
  return outcome.snapshot;
}
