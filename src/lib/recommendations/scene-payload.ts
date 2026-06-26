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
import type { SnapshotSection } from "./types";

export interface RecBand {
  glyphSlug?: string;
  tempo?: string;
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
  "favorite-artists": "New Favorites",
  discovery: "In Your Scene",
};

const normU = (u: string) => u.replace(/[\s-]+/g, "").toLowerCase();

export async function buildScenePayload(db: Firestore, uid: string): Promise<ScenePayload> {
  const nowMs = Date.now();

  const snapshot = await getOrGenerateWebsiteSnapshot(db, uid);

  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data() || {};
  const userCity =
    (userData.irlCity as string | undefined) ||
    getCityFromTimezone((userData.timezone as string) || "") ||
    null;
  const dismissedArchiveIds = new Set(
    Object.keys((userData.dismissedArchiveIds as Record<string, unknown>) || {}),
  );
  const goLiveMutes = new Set(((userData.goLiveMutes as string[] | undefined) || []).map(normU));
  const ownDjUsername = userData.chatUsernameNormalized
    ? (userData.chatUsernameNormalized as string)
    : userData.chatUsername
      ? normU(userData.chatUsername as string)
      : undefined;

  const [streamSnap, loveSnap] = await Promise.all([
    db.collection("users").doc(uid).collection("streamHistory").get(),
    db.collection("users").doc(uid).collection("loveHistory").get(),
  ]);
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

  const archivesSnap = await db.collection("archives").get();
  const archiveById = new Map<string, ArchiveSerialized>();
  for (const doc of archivesSnap.docs) {
    archiveById.set(doc.id, { id: doc.id, ...(doc.data() as Omit<Archive, "id">) });
  }

  const sections = (snapshot?.sections ?? [])
    .filter((s): s is SnapshotSection => s.id === "favorite-artists" || s.id === "discovery")
    .map((section): RecSectionOut => {
      const bandByArchiveId: Record<string, RecBand> = {};
      let items = section.items.filter((it) => !dismissedArchiveIds.has(it.archiveId));
      // Already-streamed archives belong in "Dive back in", not in the
      // recommendation sections — drop them from both favorite-artists and
      // discovery so a just-listened archive doesn't appear in two places.
      items = items.filter((it) => !streamedArchiveIds.has(it.archiveId));
      const archives: ArchiveSerialized[] = [];
      for (const it of items) {
        const full = archiveById.get(it.archiveId);
        if (!full) continue;
        archives.push(full);
        if (section.id === "discovery") {
          const sceneSlugs =
            (full.sceneIdsOverride && full.sceneIdsOverride.length ? full.sceneIdsOverride : full.sceneSlugs) || [];
          bandByArchiveId[it.archiveId] = {
            glyphSlug: sceneSlugs.find((s) => s !== "grid"),
            tempo: full.tempo ?? undefined,
          };
        }
      }
      return { id: section.id, title: SECTION_TITLE[section.id] ?? section.title, archives, bandByArchiveId };
    })
    .filter((s) => s.archives.length > 0);

  const comingUp = await fetchComingUp({
    db,
    nowMs,
    userCity,
    engagedDjUsernames,
    goLiveMutes,
    ownDjUsername,
  });

  const diveBackIn = Array.from(streamedArchiveIds)
    .filter((id) => !dismissedArchiveIds.has(id))
    .map((id) => archiveById.get(id))
    .filter((a): a is ArchiveSerialized => !!a && a.priority !== "hidden")
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
