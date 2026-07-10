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
import { isListenerVisibleArchive } from "@/lib/archive-priority";
import { toPublicDj } from "@/lib/archives-enrich";
import { normalizeForLookup } from "@/lib/go-live-matching";

// Strip DJ PII (email + Firebase UID) from a hydrated card before it leaves the
// builder for the client. Recommendation cards are spread from raw Firestore
// docs, so without this they'd carry djs[].email.
const publicCard = (a: ArchiveSerialized): ArchiveSerialized => ({
  ...a,
  djs: (a.djs ?? []).map(toPublicDj),
});

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

// Canonical username normalization (strips ALL non-alphanumerics incl dots),
// shared with the archive DJ keys + mute sets this module compares against.
const normU = (u: string) => normalizeForLookup(u);

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
  // djs[].username === <slug>. Both sides normalized with the canonical
  // normU (= normalizeForLookup), the same rule as the DJ profile page.
  // Firestore can't array-contains on an array of objects, so scan the
  // archives collection once and match in memory.
  const ownedCollectiveSlugs = new Set<string>();
  for (const d of ownedCollectivesSnap.docs) {
    const slug = d.data().slug;
    if (typeof slug === "string" && slug.length > 0) ownedCollectiveSlugs.add(normU(slug));
  }
  const collectiveArchiveIds = new Set<string>();
  if (ownedCollectiveSlugs.size > 0) {
    const allArchivesSnap = await db.collection("archives").get();
    for (const snap of allArchivesSnap.docs) {
      const data = snap.data() as Omit<Archive, "id">;
      const credited = (data.djs ?? []).some(
        (dj) => typeof dj.username === "string" && ownedCollectiveSlugs.has(normU(dj.username)),
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
      // DISCOVERY drops anything already streamed OR played (belongs in "Dive back
      // in"). FAVORITES keeps STREAMED archives (a real ≥15-min listen by a
      // favorite artist → labeled "Dive back in") but still drops PLAYED-ONLY ones
      // (pressed play, any duration — a skip, not a signal). So §1 = unheard "New
      // Show" + re-listenable "Dive back in", never a played-and-bailed archive.
      if (section.id === "discovery") {
        items = items.filter(
          (it) => !streamedArchiveIds.has(it.archiveId) && !playedArchiveIds.has(it.archiveId),
        );
      } else {
        // favorite-artists: drop played-only (played but NOT streamed).
        items = items.filter(
          (it) => streamedArchiveIds.has(it.archiveId) || !playedArchiveIds.has(it.archiveId),
        );
      }
      const archives: ArchiveSerialized[] = [];
      for (const it of items) {
        const full = archiveById.get(it.archiveId);
        if (!full) continue;
        archives.push(publicCard(full));
        if (section.id === "favorite-artists") {
          // Label by state: STREAMED (already listened) → "Dive back in";
          // brand-new (never streamed) → "New Show".
          bandByArchiveId[it.archiveId] = { label: streamedArchiveIds.has(it.archiveId) ? "Dive back in" : "New Show" };
        } else {
          // Discovery: affiliation-tier picks show the reason ("Affiliated with X"
          // / "Similar to X"); otherwise glyph + tempo.
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

  // Played-but-not-streamed archives also belong in "Dive back in" (the user
  // pressed play but didn't reach the 15-min stream threshold). Fetch the full
  // docs for any played id we haven't already loaded, so they can render.
  const playedRefIds = Array.from(playedArchiveIds).filter(
    (id) => !dismissedArchiveIds.has(id) && !archiveById.has(id),
  );
  if (playedRefIds.length > 0) {
    const playedSnapsByChunk: Promise<FirebaseFirestore.DocumentSnapshot[]>[] = [];
    for (let i = 0; i < playedRefIds.length; i += CHUNK) {
      const refs = playedRefIds.slice(i, i + CHUNK).map((id) => db.collection("archives").doc(id));
      if (refs.length > 0) playedSnapsByChunk.push(db.getAll(...refs));
    }
    const playedChunks = await Promise.all(playedSnapsByChunk);
    for (const chunk of playedChunks) {
      for (const snap of chunk) {
        if (!snap.exists) continue;
        archiveById.set(snap.id, { id: snap.id, ...(snap.data() as Omit<Archive, "id">) });
      }
    }
  }

  // "Dive back in" = the DJ's own archives + their owned collectives' archives +
  // archives the user streamed + archives the user merely played. Union the id
  // sets so a DJ's (and their collective's) back-catalogue shows here even when
  // unstreamed. HIDDEN and PRIVATE archives are filtered out below regardless of
  // source — these ids come straight from stream/play history / ownership and
  // never pass through the recommendation eligibility gate (exclusionReason), so
  // they'd otherwise leak.
  const ownedIds = new Set<string>([...Array.from(ownArchiveIds), ...Array.from(collectiveArchiveIds)]);
  const diveBackInIds = new Set<string>([
    ...Array.from(ownedIds),
    ...Array.from(streamedArchiveIds),
    ...Array.from(playedArchiveIds),
  ]);
  // Ordering tiers: (a) own archives first, (b) then streamed, (c) then merely
  // played. Within a tier, streamed archives order by last-listened (oldest
  // first); owned/played have no lastStreamedAt so they keep insertion order.
  const diveRank = (id: string): number => {
    if (ownedIds.has(id)) return 0;
    if (streamedArchiveIds.has(id)) return 1;
    return 2; // played-only
  };
  const diveBackIn = Array.from(diveBackInIds)
    .filter((id) => !dismissedArchiveIds.has(id))
    .map((id) => archiveById.get(id))
    .filter((a): a is ArchiveSerialized => !!a && isListenerVisibleArchive(a))
    .sort((a, b) => {
      const rankDiff = diveRank(a.id) - diveRank(b.id);
      if (rankDiff !== 0) return rankDiff;
      return (streamedAtMs.get(a.id) ?? 0) - (streamedAtMs.get(b.id) ?? 0);
    })
    .slice(0, 50)
    .map(publicCard);

  return {
    sections,
    comingUp,
    comingUpTitle: "Coming up",
    diveBackIn,
    diveBackInTitle: "Dive back in",
  };
}
