import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import type { Archive, ArchiveSerialized } from "@/types/broadcast";
import { getOrGenerateWebsiteSnapshot } from "@/lib/recommendations/delivery";
import { fetchComingUp, type ComingUpRow } from "@/lib/recommendations/coming-up";
import { getCityFromTimezone } from "@/lib/city-detection";
import type { SnapshotSection } from "@/lib/recommendations/types";

// Per-user recommendations for /scene. Returns FULLY-JOINED archives so the
// client renders the real ArchiveCard with no second fetch.
//  - §1 favorite-artists: drops archives the user already streamed.
//  - §2 discovery: as-is.
//  - §3 coming-up: city-gated IRL events through next Sunday 7am PT.
// Auth = any logged-in user (non-admin) via verifyIdToken.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function verifyUser(request: NextRequest): Promise<{ userId?: string }> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return {};
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return {};
    const decoded = await auth.verifyIdToken(token);
    return { userId: decoded.uid };
  } catch {
    return {};
  }
}

export interface RecBand {
  glyphSlug?: string; // scene glyph to render (§2)
  tempo?: string; // tempo id (rendered as a label next to the glyph)
}
export interface RecSectionOut {
  id: string;
  title: string;
  archives: ArchiveSerialized[];
  // §2 only: per-archive band (scene glyph + tempo). §1 sends none (no band).
  bandByArchiveId: Record<string, RecBand>;
}

const SECTION_TITLE: Record<string, string> = {
  "favorite-artists": "Your Scene",
  discovery: "Beyond Your Scene",
};

export async function POST(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const nowMs = Date.now();

  // 1. Snapshot (lazy-generate on first visit, respecting the 48h floor).
  const snapshot = await getOrGenerateWebsiteSnapshot(db, userId);

  // 2. User doc → city + engaged DJ set (for §3 reasons) + streamed ids (§1 filter).
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data() || {};
  const userCity =
    (userData.irlCity as string | undefined) ||
    getCityFromTimezone((userData.timezone as string) || "") ||
    null;
  // Archives the user explicitly removed on /scene — never re-show them.
  const dismissedArchiveIds = new Set(
    Object.keys((userData.dismissedArchiveIds as Record<string, unknown>) || {}),
  );

  const [streamSnap, loveSnap] = await Promise.all([
    db.collection("users").doc(userId).collection("streamHistory").get(),
    db.collection("users").doc(userId).collection("loveHistory").get(),
  ]);
  const streamedArchiveIds = new Set<string>();
  const engagedDjUsernames = new Set<string>();
  for (const d of streamSnap.docs) {
    const data = d.data();
    if (data.archiveId) streamedArchiveIds.add(data.archiveId as string);
    for (const n of (data.djUsernamesNormalized as string[] | undefined) ?? []) engagedDjUsernames.add(n);
  }
  for (const d of loveSnap.docs) {
    const data = d.data();
    const norm =
      (data.djUsernameNormalized as string | undefined) ||
      (data.djUsername ? (data.djUsername as string).replace(/[\s-]+/g, "").toLowerCase() : undefined);
    if (norm) engagedDjUsernames.add(norm);
  }

  // 3. Join snapshot archive ids → full Archive docs (one read of the pool).
  const archivesSnap = await db.collection("archives").get();
  const archiveById = new Map<string, ArchiveSerialized>();
  for (const doc of archivesSnap.docs) {
    archiveById.set(doc.id, { id: doc.id, ...(doc.data() as Omit<Archive, "id">) });
  }

  const archiveSections = (snapshot?.sections ?? [])
    .filter((s): s is SnapshotSection => s.id === "favorite-artists" || s.id === "discovery")
    .map((section): RecSectionOut => {
      const bandByArchiveId: Record<string, RecBand> = {};
      // Drop anything the user explicitly removed on /scene.
      let items = section.items.filter((it) => !dismissedArchiveIds.has(it.archiveId));
      // §1: not-yet-streamed only.
      if (section.id === "favorite-artists") {
        items = items.filter((it) => !streamedArchiveIds.has(it.archiveId));
      }
      const archives: ArchiveSerialized[] = [];
      for (const it of items) {
        const full = archiveById.get(it.archiveId);
        if (!full) continue;
        archives.push(full);
        // Only §2 (Suggestions) gets a band: scene glyph + tempo. §1 = none.
        if (section.id === "discovery") {
          const sceneSlugs = (full.sceneIdsOverride && full.sceneIdsOverride.length
            ? full.sceneIdsOverride
            : full.sceneSlugs) || [];
          const glyphSlug = sceneSlugs.find((s) => s !== "grid");
          bandByArchiveId[it.archiveId] = {
            glyphSlug,
            tempo: full.tempo ?? undefined,
          };
        }
      }
      return {
        id: section.id,
        title: SECTION_TITLE[section.id] ?? section.title,
        archives,
        bandByArchiveId,
      };
    })
    .filter((s) => s.archives.length > 0);

  // 4. §3 coming-up (city-gated IRL events).
  const comingUp: ComingUpRow[] = await fetchComingUp({
    db,
    nowMs,
    userCity,
    engagedDjUsernames,
  });

  return NextResponse.json({
    sections: archiveSections,
    comingUp,
    comingUpTitle: "Coming up",
  });
}
