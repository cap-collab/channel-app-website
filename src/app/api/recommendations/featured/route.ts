import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Archive, ArchiveSerialized, Tempo } from "@/types/broadcast";
import { normalizeArchive } from "@/lib/recommendations/normalize";
import { fetchComingUp, type ComingUpRow } from "@/lib/recommendations/coming-up";
import { DEFAULT_RECOMMENDATION_CONFIG } from "@/lib/recommendations/config";

// Public (no auth): the logged-out /scene view.
//  - "Start here": a fixed 2-col grid — LEFT = spiral scene, RIGHT = star scene,
//    rows in tempo order downtempo → uptempo → very_slow (Very Chill) →
//    very_fast (Intense). One archive per scene×tempo cell (latest).
//  - "Coming up": all upcoming shows/events this week (no city gate).

export const dynamic = "force-dynamic";

// Row order (tempos) and column order (scenes) for the Start-here matrix.
const TEMPO_ORDER: Tempo[] = ["downtempo", "uptempo", "very_slow", "very_fast"];
const SCENE_ORDER = ["spiral", "star"];

export async function GET() {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const nowMs = Date.now();

  const archivesSnap = await db.collection("archives").get();
  const fullById = new Map<string, ArchiveSerialized>();
  const items = archivesSnap.docs.map((doc) => {
    const full = { id: doc.id, ...(doc.data() as Omit<Archive, "id">) };
    fullById.set(doc.id, full);
    return normalizeArchive(full as Archive);
  });

  // Build the scene×tempo matrix. For each (tempo row, scene column) cell pick
  // the LATEST eligible archive of that scene + tempo. Emit in row-major order
  // (left=spiral, right=star) so a 2-col grid lays out correctly.
  const minDur = DEFAULT_RECOMMENDATION_CONFIG.eligibility.minDurationSec;
  const eligible = items
    .filter((it) => it.isPublic && it.durationSec >= minDur && it.priority !== "hidden")
    .sort((a, b) => (b.recordedAtMs !== a.recordedAtMs ? b.recordedAtMs - a.recordedAtMs : a.id < b.id ? -1 : 1));

  const pickLatest = (scene: string, tempo: Tempo) =>
    eligible.find((it) => it.tempo === tempo && it.sceneSlugs.includes(scene));

  const archives: ArchiveSerialized[] = [];
  for (const tempo of TEMPO_ORDER) {
    for (const scene of SCENE_ORDER) {
      const pick = pickLatest(scene, tempo);
      if (pick) {
        const full = fullById.get(pick.id);
        if (full) archives.push(full);
      }
    }
  }

  // Logged-out coming-up: all events this week (no city gate, no DJ reasons).
  const comingUp: ComingUpRow[] = await fetchComingUp({
    db,
    nowMs,
    userCity: null,
    engagedDjUsernames: new Set(),
  });

  return NextResponse.json({
    archives,
    comingUp,
    startHereTitle: "Start here",
    comingUpTitle: "Coming up",
  });
}
