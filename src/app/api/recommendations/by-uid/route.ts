import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";

// Public, READ-ONLY personalized /scene for a KNOWN recipient — powers the
// weekly email's "Explore the scene" CTA, which carries a non-credential uid
// token (?u=<base64url uid>). No auth: knowledge of the link reveals "what this
// person follows," not account access (same trust model as the unsubscribe /
// go-live-mute email links). Editing on /scene still requires a real session.
//
// Returns the exact same payload shape as POST /api/recommendations/me — both
// call the shared buildScenePayload(db, uid) builder.

export const maxDuration = 60;

// Edge-cache the response. This endpoint is public, read-only, and keyed
// entirely by ?u= — the same token always yields the same payload — so it is
// safe to serve from the CDN.
//
// Worth it because building the payload costs ~1s even fully warm: the snapshot
// read is fast, but serving it still re-fetches the user doc, BOTH history
// subcollections (~390ms), the "Dive back in" queries (~315ms), and the
// referenced archive docs. Email links get opened, re-opened, and prefetched by
// mail clients, so only the first hit should pay that.
//
// 5 min fresh + 1 h stale-while-revalidate: a click storm right after the send
// hits the edge, and the recs themselves only regenerate daily anyway, so the
// window is far tighter than the underlying data changes.
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get("u");
  if (!u) return NextResponse.json({ error: "u required" }, { status: 400 });

  let uid: string;
  try {
    uid = Buffer.from(u, "base64url").toString("utf-8");
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }
  // Firebase UIDs are short alphanumeric strings; reject anything implausible
  // so a garbage token fails fast (the page falls back to featured).
  if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]+$/.test(uid)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const payload = await buildScenePayload(db, uid);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
