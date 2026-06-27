import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getFeaturedPayload } from "@/lib/recommendations/featured-payload";

// Public (no auth): the logged-out /scene view.
//  - "Start here": a fixed 2-col grid — LEFT = spiral scene, RIGHT = star scene,
//    rows in tempo order downtempo → uptempo → very_slow (Very Chill) →
//    very_fast (Intense). One archive per scene×tempo cell (highest priority).
//  - "Coming up": all upcoming shows/events this week (no city gate).
//
// The payload is built + cached in getFeaturedPayload (shared with /me's
// no-history branch). Cache-Control lets the CDN/browser cache it too.

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const body = await getFeaturedPayload(db, Date.now());
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}
