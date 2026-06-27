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
import { readSnapshot, generateForUser, loadConfig } from "./server";
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
 * Website module: read the website snapshot, regenerating lazily when ABSENT or
 * STALE (older than the 48h freshness floor). Regenerating on staleness is what
 * lets newly-created archives + fresh engagement reach a returning user's /scene
 * — without it, a user's first snapshot is frozen forever (no cron pre-builds
 * website snapshots). The 48h floor caps regeneration to at most once per 2 days
 * per user, so this never thrashes.
 */
export async function getOrGenerateWebsiteSnapshot(
  db: Firestore,
  uid: string,
): Promise<RecommendationSnapshot | null> {
  const existing = await readSnapshot(db, uid, "website");
  if (existing) {
    const cfg = await loadConfig(db);
    const ageMs = Date.now() - existing.generatedAtMs;
    if (ageMs < cfg.minRegenIntervalMs) return existing; // still fresh
    // Stale → regenerate (generateForUser re-checks the floor before writing).
    const outcome = await generateForUser(db, uid, "website", {
      persist: true,
      generatedBy: "website-lazy",
    });
    // On a benign race (another request regenerated first), generateForUser
    // returns the fresh snapshot via its floor check; fall back to existing.
    return outcome.snapshot ?? existing;
  }
  const outcome = await generateForUser(db, uid, "website", {
    persist: true,
    generatedBy: "website-lazy",
  });
  return outcome.snapshot;
}
