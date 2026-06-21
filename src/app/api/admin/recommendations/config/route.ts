import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { loadConfig } from "@/lib/recommendations/server";
import { DEFAULT_RECOMMENDATION_CONFIG } from "@/lib/recommendations/config";

// Read-only in v1: returns the merged config (defaults + Firestore overrides)
// plus the defaults, so the admin tab can show effective values. Editing the
// weights/editorial lists is done by editing app-config/recommendations directly.

export const dynamic = "force-dynamic";

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

export async function GET(request: NextRequest) {
  if (!(await verifyAdminAccess(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const config = await loadConfig(db);
  return NextResponse.json({ config, defaults: DEFAULT_RECOMMENDATION_CONFIG });
}
