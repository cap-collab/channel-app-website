import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { getFeaturedPayload, DEFAULT_FEATURED_CITY } from "@/lib/recommendations/featured-payload";
import { getCityFromTimezone } from "@/lib/city-detection";

// Public (no auth): the logged-out /scene view.
//  - "Start here": a fixed 2-col grid — LEFT = spiral scene, RIGHT = star scene,
//    rows in tempo order downtempo → uptempo → very_slow (Very Chill) →
//    very_fast (Intense). One archive per scene×tempo cell (highest priority).
//  - "Coming up": upcoming shows + IRL events for the viewer's city (from their
//    DEVICE timezone via ?tz=), defaulting to LA when unknown.
//
// The featured grid is cached in getFeaturedPayload; Cache-Control lets the CDN
// cache per distinct ?tz= (a small, finite set of timezones).

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  // Device timezone → city, else the global default (LA).
  const tz = request.nextUrl.searchParams.get("tz") || "";
  const city = getCityFromTimezone(tz) || DEFAULT_FEATURED_CITY;

  const body = await getFeaturedPayload(db, Date.now(), city);
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
  });
}
