/**
 * Shared /scene payload builder — the SINGLE source of truth for what a user
 * sees on /scene (sections, gates, order). Used by both /api/recommendations/me
 * (the live page) and the admin preview, so the dashboard mirrors /scene exactly.
 *
 * Sections, in /scene order:
 *   1. "Your Scene"        — favorite-artist archives NOT yet streamed.
 *   2. "Beyond Your Scene" — discovery (strict tiers), with scene+tempo band.
 *   3. "Coming up"         — all upcoming online shows (excl muted/own/test) +
 *                            city-gated IRL events.
 *   4. "Dive back in"      — streamed archives, oldest-last-listened first.
 * Dismissed archives are dropped from the archive sections everywhere.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Archive, ArchiveSerialized } from "@/types/broadcast";
import { getOrGenerateWebsiteSnapshot } from "./delivery";
import { fetchComingUp, type ComingUpRow } from "./coming-up";
import { getCityFromTimezone } from "@/lib/city-detection";
import type { SnapshotSection, RecommendationSnapshot } from "./types";

export interface RecBand {
  glyphSlug?: string;
  tempo?: string;
  // When set, the card banner shows this text INSTEAD of glyph+tempo — used for
  // affiliation-tier discovery picks ("Affiliated with X" / "Similar to X").
  label?: string;
}
export interface RecSectionOut {
  id: string;
  title: string;
  archives: ArchiveSerialized[];
  bandByArchiveId: Record<string, RecBand>;
}
export interface ScenePayload {
  sections: RecSectionOut[];
  comingUp: ComingUpRow[];
  comingUpTitle: string;
  diveBackIn: ArchiveSerialized[];
  diveBackInTitle: string;
}

const SECTION_TITLE: Record<string, string> = {
  "favorite-artists": "Your favorites",
  discovery: "In Your Scene",
};

const normU = (u: string) => u.replace(/[\s-]+/g, "").toLowerCase();

export async function buildScenePayload(
  db: Firestore,
  uid: string,
  // Optional: a snapshot the caller already generated (e.g. the admin preview,
  // which runs generateForUser first). Passing it skips a second full
  // generation inside getOrGenerateWebsiteSnapshot — the main cost on a cold
  // (uncached) preview.
  prebuiltSnapshot?: RecommendationSnapshot | null,
): Promise<ScenePayload> {
  const nowMs = Date.now();

  // Stage A — these three are independent of each other (the snapshot read does
  // NOT depend on the user doc or the history subcollections), so fetch them
  // concurrently instead of in series.
  const [snapshot, userDoc, [streamSnap, loveSnap]] = await Promise.all([
    prebuiltSnapshot !== undefined
      ? Promise.resolve(prebuiltSnapshot)
      : getOrGenerateWebsiteSnapshot(db, uid),
    db.collection("users").doc(uid).get(),
    Promise.all([
      db.collection("users").doc(uid).collection("streamHistory").get(),
      db.collection("users").doc(uid).collection("loveHistory").get(),
    ]),
  ]);

  const userData = userDoc.data() || {};
  const userCity =
    (userData.irlCity as string | undefined) ||
    getCityFromTimezone((userData.timezone as string) || "") ||
    null;
  const dismissedArchiveIds = new Set(
    Object.keys((userData.dismissedArchiveIds as Record<string, unknown>) || {}),
  );
  // Played archives (play-start marker, exclusion-only). Read at SERVE time so a
  // show the user played TODAY drops out of the recs immediately — the cached
  // snapshot may be up to the freshness-floor stale, but this filter reflects the
  // live playedArchiveIds map on the user doc, so exclusion isn't gated on regen.
  const playedArchiveIds = new Set(
    Object.keys((userData.playedArchiveIds as Record<string, unknown>) || {}),
  );
  const goLiveMutes = new Set(((userData.goLiveMutes as string[] | undefined) || []).map(normU));
  const ownDjUsername = userData.chatUsernameNormalized
    ? (userData.chatUsernameNormalized as string)
    : userData.chatUsername
      ? normU(userData.chatUsername as string)
      : undefined;

  const streamedArchiveIds = new Set<string>();
  const engagedDjUsernames = new Set<string>();
  const streamedAtMs = new Map<string, number>();
  for (const d of streamSnap.docs) {
    const data = d.data();
    if (data.archiveId) {
      streamedArchiveIds.add(data.archiveId as string);
      const ts = data.lastStreamedAt;
      const ms =
        typeof ts?.toMillis === "function" ? ts.toMillis() : typeof ts?._seconds === "number" ? ts._seconds * 1000 : 0;
      streamedAtMs.set(data.archiveId as string, ms);
    }
    for (const n of (data.djUsernamesNormalized as string[] | undefined) ?? []) engagedDjUsernames.add(n);
  }
  for (const d of loveSnap.docs) {
    const data = d.data();
    const norm =
      (data.djUsernameNormalized as string | undefined) ||
      (data.djUsername ? normU(data.djUsername as string) : undefined);
    if (norm) engagedDjUsernames.add(norm);
  }

  // Collect ONLY the archive IDs we'll actually render — the snapshot section
  // items + the dive-back-in candidates (streamed, not dismissed) — and fetch
  // just those via getAll, instead of scanning the entire archives collection.
  // The snapshot lacks the full card fields (djs[], tempo, priority), so we do
  // need the full docs, but only for referenced IDs (≤ ~16 section + N streamed).
  const refIds = new Set<string>();
  for (const section of snapshot?.sections ?? []) {
    if (section.id !== "favorite-artists" && section.id !== "discovery") continue;
    for (const it of section.items) refIds.add(it.archiveId);
  }
  for (const id of Array.from(streamedArchiveIds)) {
    if (!dismissedArchiveIds.has(id)) refIds.add(id);
  }

  // getAll (a new pattern in this repo) is variadic and returns snapshots in ref
  // order with exists=false for missing/deleted docs (not omitted). Chunk
  // defensively to stay well within the gRPC message size. Run concurrently with
  // the coming-up fetch — they're independent.
  const archiveById = new Map<string, ArchiveSerialized>();
  const idList = Array.from(refIds);
  const CHUNK = 300;
  const archiveSnapsByChunk: Promise<FirebaseFirestore.DocumentSnapshot[]>[] = [];
  for (let i = 0; i < idList.length; i += CHUNK) {
    const refs = idList.slice(i, i + CHUNK).map((id) => db.collection("archives").doc(id));
    if (refs.length > 0) archiveSnapsByChunk.push(db.getAll(...refs));
  }

  const [archiveChunks, comingUp, ownArchiveSnap, ownedCollectivesSnap] = await Promise.all([
    Promise.all(archiveSnapsByChunk),
    fetchComingUp({ db, nowMs, userCity, engagedDjUsernames, goLiveMutes, ownDjUsername }),
    // The signed-in DJ's OWN archives — uploaded OR live-recorded, both stamp
    // uploadedBy with the DJ's uid. These join "Dive back in" regardless of
    // priority (low/medium included; hidden filtered below), so a DJ always sees
    // their own back-catalogue there even if they never streamed it themselves.
    db.collection("archives").where("uploadedBy", "==", uid).get(),
    // Collectives this user owns — their archives (credited via djs[].username ===
    // <collective slug>) also join "Dive back in".
    db.collection("collectives").where("owners", "array-contains", uid).get(),
  ]);
  for (const chunk of archiveChunks) {
    for (const snap of chunk) {
      if (!snap.exists) continue;
      archiveById.set(snap.id, { id: snap.id, ...(snap.data() as Omit<Archive, "id">) });
    }
  }
  const ownArchiveIds = new Set<string>();
  for (const snap of ownArchiveSnap.docs) {
    ownArchiveIds.add(snap.id);
    archiveById.set(snap.id, { id: snap.id, ...(snap.data() as Omit<Archive, "id">) });
  }

  // Owned-collective archives: an archive credits a collective under
  // djs[].username === <slug> (slug compared lowercased, hyphens preserved — same
  // rule as the DJ profile page). Firestore can't array-contains on an array of
  // objects, so scan the archives collection once and match in memory.
  const ownedCollectiveSlugs = new Set<string>();
  for (const d of ownedCollectivesSnap.docs) {
    const slug = d.data().slug;
    if (typeof slug === "string" && slug.length > 0) ownedCollectiveSlugs.add(slug.toLowerCase());
  }
  const collectiveArchiveIds = new Set<string>();
  if (ownedCollectiveSlugs.size > 0) {
    const allArchivesSnap = await db.collection("archives").get();
    for (const snap of allArchivesSnap.docs) {
      const data = snap.data() as Omit<Archive, "id">;
      const credited = (data.djs ?? []).some(
        (dj) => typeof dj.username === "string" && ownedCollectiveSlugs.has(dj.username.toLowerCase()),
      );
      if (!credited) continue;
      collectiveArchiveIds.add(snap.id);
      archiveById.set(snap.id, { id: snap.id, ...data });
    }
  }

  const sections = (snapshot?.sections ?? [])
    .filter((s): s is SnapshotSection => s.id === "favorite-artists" || s.id === "discovery")
    .map((section): RecSectionOut => {
      const bandByArchiveId: Record<string, RecBand> = {};
      let items = section.items.filter((it) => !dismissedArchiveIds.has(it.archiveId));
      // Already-streamed archives belong in "Dive back in", not in the
      // recommendation sections — drop them from both favorite-artists and
      // discovery so a just-listened archive doesn't appear in two places.
      // Played archives (pressed play, any duration) are likewise dropped here at
      // serve time, so a show played TODAY vanishes from the recs on the next
      // load without waiting for the snapshot to regenerate.
      items = items.filter(
        (it) => !streamedArchiveIds.has(it.archiveId) && !playedArchiveIds.has(it.archiveId),
      );
      const archives: ArchiveSerialized[] = [];
      for (const it of items) {
        const full = archiveById.get(it.archiveId);
        if (!full) continue;
        archives.push(full);
        if (section.id === "discovery") {
          // Affiliation-tier picks show the reason ("Affiliated with X" /
          // "Similar to X") in the banner instead of glyph+tempo. The engine put
          // that exact string in reasons[0] for those tiers.
          const reason = it.reasons?.[0];
          const isAffiliationReason =
            !!reason && (reason.startsWith("Affiliated with ") || reason.startsWith("Similar to "));
          if (isAffiliationReason) {
            bandByArchiveId[it.archiveId] = { label: reason };
          } else {
            const sceneSlugs =
              (full.sceneIdsOverride && full.sceneIdsOverride.length ? full.sceneIdsOverride : full.sceneSlugs) || [];
            bandByArchiveId[it.archiveId] = {
              glyphSlug: sceneSlugs.find((s) => s !== "grid"),
              tempo: full.tempo ?? undefined,
            };
          }
        }
      }
      return { id: section.id, title: SECTION_TITLE[section.id] ?? section.title, archives, bandByArchiveId };
    })
    .filter((s) => s.archives.length > 0);

  // "Dive back in" = archives the user streamed + the DJ's own archives + their
  // owned collectives' archives. Union the id sets so a DJ's (and their
  // collective's) back-catalogue shows here even when unstreamed. HIDDEN archives
  // are filtered out below regardless of source.
  const diveBackInIds = new Set<string>([
    ...Array.from(streamedArchiveIds),
    ...Array.from(ownArchiveIds),
    ...Array.from(collectiveArchiveIds),
  ]);
  const diveBackIn = Array.from(diveBackInIds)
    .filter((id) => !dismissedArchiveIds.has(id))
    .map((id) => archiveById.get(id))
    .filter((a): a is ArchiveSerialized => !!a && a.priority !== "hidden")
    // Streamed archives order by last-listened (oldest first). Own archives that
    // were never streamed have no lastStreamedAt (0) → they sort to the front.
    .sort((a, b) => (streamedAtMs.get(a.id) ?? 0) - (streamedAtMs.get(b.id) ?? 0))
    .slice(0, 50);

  return {
    sections,
    comingUp,
    comingUpTitle: "Coming up",
    diveBackIn,
    diveBackInTitle: "Dive back in",
  };
}
