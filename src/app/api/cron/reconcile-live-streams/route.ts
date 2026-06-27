import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// Weekly reconcile: a LIVE/restream listen is recorded under the broadcast
// SLOT id (users/{uid}/streamHistory/{slotId}, sourceType:'live'). Once the show
// is archived, that listen should also count as a stream on the ARCHIVE so the
// listener is credited (and the rec engine can resolve the archive's
// scene/tempo). This job links them for recently-active users.
//
// Per active live doc whose slotId now has an archive: create the archive-keyed
// streamHistory doc (sourceType:'archive') if absent, and bump archive.streamCount
// by that doc's streamCount. IDEMPOTENT — the archive-keyed doc's existence is
// the guard, so re-runs never double-count. Additive only: never deletes the
// original live doc or any archive.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Runs DAILY (vercel.json). 25h window = the last day's live listens + 1h overlap
// so a listen right at the run boundary is never missed between consecutive runs.
// Idempotent (archive-keyed doc existence guard), so the overlap can't
// double-count. Narrow window keeps the per-run collection-group scan cheap.
const ACTIVE_WINDOW_MS = 25 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  // Cheap pre-check FIRST: the only thing that can need reconciling is a LIVE
  // listen within the window. If there were none (a day with no live listens),
  // bail before the expensive archives + slots scans. This is also the correct
  // trigger for restreams (whose archive may be old but whose listen is new) —
  // gating on "recently-archived shows" would miss those.
  const liveSnap = await db
    .collectionGroup("streamHistory")
    .where("sourceType", "==", "live")
    .where("lastStreamedAt", ">=", cutoff)
    .get();

  if (liveSnap.empty) {
    try {
      await db.collection("system").doc("reconcile-live-streams-status").set({
        lastRunAt: Date.now(),
        liveDocsChecked: 0,
        linksCreated: 0,
        streamCountAdded: 0,
        skippedExisting: 0,
        skippedNoArchive: 0,
        errorCount: 0,
        skippedNoLiveActivity: true,
      });
    } catch {
      // non-fatal
    }
    return NextResponse.json({
      liveDocsChecked: 0,
      linksCreated: 0,
      streamCountAdded: 0,
      skippedExisting: 0,
      skippedNoArchive: 0,
      errors: [],
      skippedNoLiveActivity: true,
    });
  }

  // One archives scan → two lookups:
  //   archiveBySlot: broadcastSlotId → archive  (the show's ORIGINAL live slot)
  //   archiveById:   archiveId        → archive  (for restream resolution below)
  const archivesSnap = await db.collection("archives").get();
  const archiveBySlot = new Map<string, { id: string; data: FirebaseFirestore.DocumentData }>();
  const archiveById = new Map<string, { id: string; data: FirebaseFirestore.DocumentData }>();
  for (const doc of archivesSnap.docs) {
    const entry = { id: doc.id, data: doc.data() };
    archiveById.set(doc.id, entry);
    const slotId = doc.data().broadcastSlotId as string | undefined;
    if (slotId) archiveBySlot.set(slotId, entry);
  }

  // Restream slots REPLAY an existing archive — their doc carries archiveId.
  // A "live" listen to a restream is keyed by the restream slot id, which won't
  // match any archive's broadcastSlotId; resolve those via slot.archiveId so
  // restream listeners are credited to the archive they actually heard.
  // slotId → archiveId for slots that point at an archive.
  const archiveIdBySlot = new Map<string, string>();
  const slotsSnap = await db.collection("broadcast-slots").get();
  for (const doc of slotsSnap.docs) {
    const aId = doc.data().archiveId as string | undefined;
    if (aId) archiveIdBySlot.set(doc.id, aId);
  }

  // liveSnap (active LIVE stream docs in the window) was fetched in the
  // pre-check above and is non-empty here.
  const result = { liveDocsChecked: liveSnap.size, linksCreated: 0, streamCountAdded: 0, skippedExisting: 0, skippedNoArchive: 0, errors: [] as string[] };

  for (const liveDoc of liveSnap.docs) {
    try {
      const data = liveDoc.data();
      const slotId = (data.archiveId as string) || liveDoc.id; // live docs key archiveId = slotId
      // Resolve the archive: original live show (broadcastSlotId === slotId), OR
      // a restream slot that replays an archive (slot.archiveId).
      const restreamArchiveId = archiveIdBySlot.get(slotId);
      const archive = archiveBySlot.get(slotId) ?? (restreamArchiveId ? archiveById.get(restreamArchiveId) : undefined);
      if (!archive) {
        result.skippedNoArchive++;
        continue;
      }

      // Parent user id from the doc path: users/{uid}/streamHistory/{slotId}
      const uid = liveDoc.ref.parent.parent?.id;
      if (!uid) continue;

      const archiveStreamRef = db
        .collection("users")
        .doc(uid)
        .collection("streamHistory")
        .doc(archive.id);
      const archiveRef = db.collection("archives").doc(archive.id);

      const liveCount = typeof data.streamCount === "number" && data.streamCount > 0 ? data.streamCount : 1;

      // Transaction: the existence-guard read AND both writes are atomic, so the
      // archive.streamCount increment happens IF AND ONLY IF the per-user doc is
      // created in the same commit. This prevents both double-counting (re-runs /
      // overlapping runs) and under-counting (crash between the two writes).
      // The archive write is a single additive streamCount increment — it never
      // overwrites or deletes any archive field.
      const created = await db.runTransaction(async (tx) => {
        const existing = await tx.get(archiveStreamRef);
        if (existing.exists) return false; // already reconciled

        tx.set(archiveStreamRef, {
          archiveId: archive.id,
          slug: archive.data.slug ?? null,
          showName: archive.data.showName ?? data.showName ?? "",
          djs: data.djs ?? archive.data.djs ?? [],
          djUsernames: data.djUsernames ?? [],
          djUsernamesNormalized: data.djUsernamesNormalized ?? [],
          stationId: archive.data.stationId ?? data.stationId ?? "channel-main",
          showImageUrl: archive.data.showImageUrl ?? data.showImageUrl ?? null,
          sourceType: "archive",
          streamCount: liveCount,
          firstStreamedAt: data.firstStreamedAt ?? FieldValue.serverTimestamp(),
          lastStreamedAt: data.lastStreamedAt ?? FieldValue.serverTimestamp(),
          reconciledFromLive: true,
        });
        // Additive single-field increment; archive doc is otherwise untouched.
        tx.update(archiveRef, { streamCount: FieldValue.increment(liveCount) });
        return true;
      });

      if (!created) {
        result.skippedExisting++;
        continue; // already reconciled → no double-count
      }
      result.linksCreated++;
      result.streamCountAdded += liveCount;
    } catch (e) {
      result.errors.push(`${liveDoc.ref.path}: ${String(e)}`);
    }
  }

  // Status doc for the Tech Health admin readout (best-effort).
  try {
    await db.collection("system").doc("reconcile-live-streams-status").set({
      lastRunAt: Date.now(),
      liveDocsChecked: result.liveDocsChecked,
      linksCreated: result.linksCreated,
      streamCountAdded: result.streamCountAdded,
      skippedExisting: result.skippedExisting,
      skippedNoArchive: result.skippedNoArchive,
      errorCount: result.errors.length,
    });
  } catch {
    // non-fatal
  }

  return NextResponse.json(result);
}
