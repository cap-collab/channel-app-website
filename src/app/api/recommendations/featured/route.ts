import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Archive, ArchiveSerialized } from "@/types/broadcast";
import { fetchComingUp, type ComingUpRow } from "@/lib/recommendations/coming-up";
import { buildFeaturedMatrix } from "@/lib/recommendations/featured-matrix";

// Public (no auth): the logged-out /scene view.
//  - "Start here": a fixed 2-col grid — LEFT = spiral scene, RIGHT = star scene,
//    rows in tempo order downtempo → uptempo → very_slow (Very Chill) →
//    very_fast (Intense). One archive per scene×tempo cell (latest).
//  - "Coming up": all upcoming shows/events this week (no city gate).
//
// The result is the same for every logged-out visitor and changes slowly, so we
// cache it: a short in-process memo (instant warm hits) + Cache-Control so the
// CDN/browser cache it too. This keeps logged-out /scene snappy.

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  // Warm in-process hit → return instantly.
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const nowMs = Date.now();

  const archivesSnap = await db.collection("archives").get();
  const docs: ArchiveSerialized[] = archivesSnap.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as Omit<Archive, "id">) }) as ArchiveSerialized,
  );

  // Latest-per-(scene×tempo) matrix, row-major (left=spiral, right=star) for a
  // 2-col grid. Logged-out grid uses ALL tempos (no exclusions).
  const archives = buildFeaturedMatrix(docs);

  // Logged-out coming-up: all events this week (no city gate, no DJ reasons).
  const comingUp: ComingUpRow[] = await fetchComingUp({
    db,
    nowMs,
    userCity: null,
    engagedDjUsernames: new Set(),
  });

  const body = {
    archives,
    comingUp,
    startHereTitle: "Start here",
    comingUpTitle: "Coming up",
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}
