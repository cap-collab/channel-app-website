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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  return NextResponse.json(payload);
}
