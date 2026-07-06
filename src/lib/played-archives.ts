/**
 * "Played" signal — a lightweight, exclusion-only marker that a user PRESSED
 * PLAY on an archive (any duration), so the recommendation engine stops
 * re-recommending it in New Favorites / Discovery.
 *
 * Storage: a MAP on the user doc — `users/{uid}.playedArchiveIds = { [archiveId]: playedAtMs }`.
 * Mirrors `dismissedArchiveIds`' shape deliberately:
 *   - No subcollection → no new collection-group query, security rule, or index
 *     (avoids the go-live-403-class failure where a missing CG rule silently
 *     dropped everyone).
 *   - Read wholesale with the user doc the rec build already fetches.
 *   - Keyed by archiveId → replaying the same archive OVERWRITES its key (no
 *     growth, no count). Distinct-archives-played is the natural bound.
 *
 * IMPORTANT — this is NOT taste. A bare play might mean the user disliked it.
 * The engine reads these ids for EXCLUSION only; it never credits the archive's
 * DJ/scene/tempo. Taste stays keyed on the 15-min streamHistory + loveHistory.
 *
 * Cap: PLAYED_CAP most-recent entries. At the current catalog scale (dozens of
 * archives) the cap never fires, so nothing is ever evicted today; it's a
 * forward-only safety valve protecting the 1 MiB doc ceiling if the catalog
 * ever grows 100×. When it fires it evicts the OLDEST plays — exclusion markers
 * that the 60-day recency window already made irrelevant.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

// Keep well above the catalog size so it never fires at current scale, while
// hard-bounding the user doc (5000 * ~40B ≈ 200KB, far under the 1MiB limit).
export const PLAYED_CAP = 5000;

/**
 * Record that `uid` played `archiveId`, at `nowMs`. Append-only per key: it
 * NEVER erases another archive's entry. If the map would exceed PLAYED_CAP, the
 * oldest entries are pruned. Runs in a transaction so the read-modify-write
 * needed for pruning can't race or clobber concurrent plays.
 *
 * Idempotent: replaying the same archive just refreshes its timestamp.
 */
export async function recordPlay(
  db: Firestore,
  uid: string,
  archiveId: string,
  nowMs: number,
): Promise<void> {
  if (!uid || !archiveId) return;
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    // If the user doc doesn't exist we still create the field via merge — but a
    // play should always come from an authenticated existing user, so this is a
    // safety net, not the common path.
    const existing =
      (snap.data()?.playedArchiveIds as Record<string, number> | undefined) ?? {};

    // Fast path: under the cap → a single-key merge, no rewrite of the whole map.
    if (existing[archiveId] === undefined && Object.keys(existing).length >= PLAYED_CAP) {
      // At/over cap and adding a NEW key: prune oldest to make room, then write
      // the trimmed map back wholesale (the only case we rewrite the field).
      const entries = Object.entries(existing).sort((a, b) => a[1] - b[1]); // oldest first
      // Keep the newest (PLAYED_CAP - 1), then add the new one → exactly PLAYED_CAP.
      const kept = entries.slice(entries.length - (PLAYED_CAP - 1));
      const trimmed: Record<string, number> = {};
      for (const [id, ts] of kept) trimmed[id] = ts;
      trimmed[archiveId] = nowMs;
      tx.set(userRef, { playedArchiveIds: trimmed }, { merge: true });
      return;
    }

    // Normal path: merge just this one key. Deep-merge leaves all other keys
    // untouched — no data loss, no read-modify-write race on the rest of the map.
    tx.set(userRef, { playedArchiveIds: { [archiveId]: nowMs } }, { merge: true });
  });
}

/**
 * Record a LIVE/restream play, keyed by SLOT id.
 *
 * Live plays can't go straight into the playedArchiveIds map: the exclusion map
 * is keyed by ARCHIVE id, but at play-time we only have the slot id (and for an
 * original live show the archive doesn't exist yet). So — exactly like the
 * 15-min stream signal — a live play is written as a SLOT-KEYED DOCUMENT that
 * the daily reconcile cron discovers (collection-group query) and transfers into
 * the user's playedArchiveIds map once the archive exists.
 *
 * `users/{uid}/playedSlots/{slotId}` — minimal shape; `sourceType:'live'` +
 * `playedAt` mirror the fields reconcile filters/keys on for streamHistory.
 * Idempotent (merge on a fixed doc id). Exclusion-only: NO DJ/scene fields, so
 * it can never leak into the go-live cron's engagement queries.
 */
export async function recordLivePlay(
  db: Firestore,
  uid: string,
  slotId: string,
): Promise<void> {
  if (!uid || !slotId) return;
  await db
    .collection("users")
    .doc(uid)
    .collection("playedSlots")
    .doc(slotId)
    .set(
      {
        slotId,
        sourceType: "live",
        playedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
