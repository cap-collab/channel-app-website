import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { generateForUser } from "@/lib/recommendations/server";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";
import type { RecommendationContext } from "@/lib/recommendations/types";

// Live recommendation preview for any user, BEFORE anything is sent. By default
// runs the engine and returns the result WITHOUT persisting (so it never
// touches the 48h floor or the saved snapshot). With { force: true } it
// persists a fresh snapshot (admin-force), bypassing the 48h floor — for
// testing/tuning what the email cron will consume.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return false;
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return false;
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return false;
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return role === "admin" || role === "broadcaster";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!(await verifyAdminAccess(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  let body: { uid?: string; context?: RecommendationContext; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const uid = body.uid;
  if (!uid || typeof uid !== "string") {
    return NextResponse.json({ error: "uid required" }, { status: 400 });
  }
  const context: RecommendationContext = body.context === "weekly-email" ? "weekly-email" : "website";
  const force = body.force === true;

  const outcome = await generateForUser(db, uid, context, {
    persist: force,
    generatedBy: force ? "admin-force" : "admin-preview",
    force,
  });

  if (outcome.skipped === "no-user") {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // The exact /scene payload for this user (same builder as the live page), so
  // the dashboard mirrors /scene order + rules across all sections.
  const scene = await buildScenePayload(db, uid);

  return NextResponse.json({
    snapshot: outcome.snapshot,
    dropped: outcome.dropped ?? [],
    scene,
    persisted: force,
    context,
  });
}
