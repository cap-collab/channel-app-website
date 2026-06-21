import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

// Returns the list of users the admin can preview recommendations for. Used to
// populate the picker in the Recommendations tab. Returns lightweight rows only.

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

  const snap = await db.collection("users").get();
  const users = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        uid: d.id,
        email: (data.email as string) || "",
        displayName: (data.displayName as string) || (data.chatUsername as string) || "",
      };
    })
    .filter((u) => u.email)
    .sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ users });
}
