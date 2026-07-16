import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { PLAYED_CAP } from "@/lib/played-archives";
import {
  mergeStreamHistory,
  mergeLoveHistory,
  mergeTracklistView,
  mergePlayedArchiveIds,
} from "@/lib/merge-anon-history-reducers";

/**
 * Merge an ANONYMOUS user's captured history into the real account they just
 * signed into. Called (fire-and-forget, non-fatal) by the sign-in handlers when
 * Firebase issued a new uid — i.e. the anon uid could not be kept in place.
 *
 * AUTH (two proofs, both verifyIdToken'd server-side — never trust the body):
 *   - toUid   = the caller's Authorization: Bearer token (the real account).
 *   - fromUid = proven by `fromIdToken` (the anon session's own ID token, captured
 *               in the handler just before sign-in). We require decodedFrom.uid ===
 *               fromUid AND sign_in_provider === 'anonymous'. Only the real owner
 *               of that anon session could mint that token, so it can't be forged
 *               to steal someone else's history.
 *
 * SAFETY:
 *   - Per-field merge (counts add, first=earliest, last=latest, arrays union) via
 *     compute-from-read (NOT increment) so a re-run cannot double.
 *   - Source subcollection docs are DELETED after copy — otherwise dj-engagement /
 *     show-starting-emails (both dedupe listeners by parent uid via collectionGroup)
 *     would count one human as two uids.
 *   - Idempotent: stamps mergedFrom.{fromUid}; a re-run short-circuits.
 *   - NEVER touches archive-level global tallies (already counted at anon time).
 *   - Non-fatal by contract: the caller ignores failures; sign-in already succeeded.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Firestore write-batch hard cap is 500 ops. Each merged key = 1 set + 1 delete
// = 2 ops, so flush well under 500.
const BATCH_FLUSH_AT = 400;

type Db = FirebaseFirestore.Firestore;

// Accumulates writes and flushes before the 500-op cap. `set`/`delete` are
// synchronous (just stage the op); the caller awaits `maybeFlush()` at a safe
// point between keys so a commit never races a concurrent stage.
class ChunkedBatch {
  private batch: FirebaseFirestore.WriteBatch;
  private ops = 0;
  constructor(private db: Db) {
    this.batch = db.batch();
  }
  set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData, opts?: FirebaseFirestore.SetOptions) {
    if (opts) this.batch.set(ref, data, opts);
    else this.batch.set(ref, data);
    this.ops++;
  }
  delete(ref: FirebaseFirestore.DocumentReference) {
    this.batch.delete(ref);
    this.ops++;
  }
  async maybeFlush() {
    if (this.ops >= BATCH_FLUSH_AT) {
      await this.batch.commit();
      this.batch = this.db.batch();
      this.ops = 0;
    }
  }
  async flush() {
    if (this.ops > 0) {
      await this.batch.commit();
      this.ops = 0;
    }
  }
}

type Reducer = (dest: Record<string, unknown> | undefined, src: Record<string, unknown>) => Record<string, unknown>;

// Merge one subcollection from fromUid → toUid, deleting source docs. Returns the
// number of source keys processed. Each key: read dest, compute merged, set dest,
// delete source. Compute-from-read + delete-source = idempotent & resumable.
async function mergeSubcollection(
  db: Db,
  batch: ChunkedBatch,
  fromUid: string,
  toUid: string,
  name: string,
  reducer: Reducer | null, // null = copy-only (no numeric fields, e.g. playedSlots/favorites)
): Promise<number> {
  const srcSnap = await db.collection("users").doc(fromUid).collection(name).get();
  if (srcSnap.empty) return 0;
  let n = 0;
  for (const srcDoc of srcSnap.docs) {
    const destRef = db.collection("users").doc(toUid).collection(name).doc(srcDoc.id);
    const src = srcDoc.data();
    if (reducer) {
      const destSnap = await destRef.get();
      const merged = reducer(destSnap.exists ? destSnap.data() : undefined, src);
      batch.set(destRef, merged);
    } else {
      // copy-only: keep dest if present (don't clobber), else copy source.
      const destSnap = await destRef.get();
      if (!destSnap.exists) batch.set(destRef, src);
    }
    batch.delete(srcDoc.ref);
    n++;
    await batch.maybeFlush();
  }
  return n;
}

export async function POST(request: NextRequest) {
  const db = getAdminDb();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "not-configured" }, { status: 500 });
  }

  // 1. toUid from the bearer token.
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let toUid: string;
  try {
    toUid = (await auth.verifyIdToken(authHeader.slice(7))).uid;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. fromUid proven by its own anon ID token.
  const body = await request.json().catch(() => ({}));
  const fromUid = typeof body.fromUid === "string" ? body.fromUid : "";
  const fromIdToken = typeof body.fromIdToken === "string" ? body.fromIdToken : "";
  if (!fromUid || !fromIdToken) {
    return NextResponse.json({ error: "missing-from" }, { status: 400 });
  }
  let decodedFrom: import("firebase-admin/auth").DecodedIdToken;
  try {
    decodedFrom = await auth.verifyIdToken(fromIdToken);
  } catch {
    // Expired/invalid anon token (common for late-clicked magic links). Non-fatal
    // for the caller; nothing merges.
    return NextResponse.json({ error: "from-token-invalid" }, { status: 401 });
  }
  if (decodedFrom.uid !== fromUid) {
    return NextResponse.json({ error: "from-uid-mismatch" }, { status: 403 });
  }
  if (decodedFrom.firebase?.sign_in_provider !== "anonymous") {
    // Only anon history is merged this way — never strip a real account.
    return NextResponse.json({ error: "source-not-anon" }, { status: 403 });
  }

  // 3. Guards.
  if (fromUid === toUid) {
    return NextResponse.json({ merged: false, skipped: "self" });
  }
  const toRef = db.collection("users").doc(toUid);
  const toSnap = await toRef.get();
  const alreadyMerged = (toSnap.data()?.mergedFrom as Record<string, unknown> | undefined)?.[fromUid];
  if (alreadyMerged) {
    return NextResponse.json({ merged: false, skipped: "already-merged" });
  }

  // 4. Merge each subcollection (order stable; each independently idempotent).
  try {
    const batch = new ChunkedBatch(db);
    const counts = {
      streamHistory: await mergeSubcollection(db, batch, fromUid, toUid, "streamHistory", mergeStreamHistory),
      loveHistory: await mergeSubcollection(db, batch, fromUid, toUid, "loveHistory", mergeLoveHistory),
      tracklistViews: await mergeSubcollection(db, batch, fromUid, toUid, "tracklistViews", mergeTracklistView),
      favorites: await mergeSubcollection(db, batch, fromUid, toUid, "favorites", null),
      playedSlots: await mergeSubcollection(db, batch, fromUid, toUid, "playedSlots", null),
    };

    // playedArchiveIds map field on the user docs.
    const fromDoc = await db.collection("users").doc(fromUid).get();
    const fromPlayed = (fromDoc.data()?.playedArchiveIds as Record<string, number> | undefined) ?? {};
    const toPlayed = (toSnap.data()?.playedArchiveIds as Record<string, number> | undefined) ?? {};
    const mergedPlayed = mergePlayedArchiveIds(toPlayed, fromPlayed, PLAYED_CAP);

    await batch.flush();

    // Final: write merged playedArchiveIds + idempotency stamp on the real account.
    await toRef.set(
      {
        playedArchiveIds: mergedPlayed,
        mergedFrom: { [fromUid]: { at: FieldValue.serverTimestamp(), status: "done" } },
        mergedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ merged: true, counts });
  } catch (error) {
    console.error("[merge-anon-history] failed:", error);
    // Non-fatal for the caller. A later re-run resumes (source docs remain; the
    // mergedFrom stamp was NOT written, so guards don't short-circuit).
    return NextResponse.json({ error: "merge-failed" }, { status: 500 });
  }
}
