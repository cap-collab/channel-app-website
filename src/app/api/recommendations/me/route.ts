import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";
import { getFeaturedPayload, DEFAULT_FEATURED_CITY } from "@/lib/recommendations/featured-payload";
import { getCityFromTimezone } from "@/lib/city-detection";

// Per-user /scene recommendations. All section rules live in buildScenePayload
// (shared with the admin preview so the dashboard mirrors /scene exactly).
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

export async function POST(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  // No-history users get the cached featured grid (like logged-out) instead of a
  // full snapshot generation — a brand-new user pays ~0ms, not ~2s, and still
  // upgrades to personalized recs once they engage. Cheap check: any one of
  // stream / love / search-favorite docs present = "has history".
  const [streamOne, loveOne, favOne] = await Promise.all([
    db.collection("users").doc(userId).collection("streamHistory").limit(1).get(),
    db.collection("users").doc(userId).collection("loveHistory").limit(1).get(),
    db.collection("users").doc(userId).collection("favorites").where("type", "==", "search").limit(1).get(),
  ]);
  const hasHistory = !streamOne.empty || !loveOne.empty || !favOne.empty;

  if (!hasHistory) {
    // City-gate the featured coming-up to the recipient's city: their own
    // irlCity, else timezone-derived, else the global default (LA).
    const userData = (await db.collection("users").doc(userId).get()).data() || {};
    const userCity =
      (userData.irlCity as string | undefined) ||
      getCityFromTimezone((userData.timezone as string) || "") ||
      DEFAULT_FEATURED_CITY;
    const featured = await getFeaturedPayload(db, Date.now(), userCity);
    // MeResponse shape: featured archives surface via `startHere`; no personalized
    // sections / dive-back-in yet.
    return NextResponse.json({
      sections: [],
      startHere: featured.archives,
      comingUp: featured.comingUp,
      comingUpTitle: featured.comingUpTitle,
      diveBackIn: [],
      diveBackInTitle: "Dive back in",
    });
  }

  const payload = await buildScenePayload(db, userId);
  return NextResponse.json(payload);
}
