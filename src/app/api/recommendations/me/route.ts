import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";

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

  const payload = await buildScenePayload(db, userId);
  return NextResponse.json(payload);
}
