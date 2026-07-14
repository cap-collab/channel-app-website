import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// Remove a recommended archive from /scene: permanently hide that archive id from
// the user's future recommendations (dismissedArchiveIds on the user doc) and
// drop the artist from their watchlist (search-type favorites). Any logged-in
// user (non-admin auth).

export const dynamic = "force-dynamic";

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

const normUser = (u: string) => u.replace(/[\s-]+/g, "").toLowerCase();

export async function POST(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const { archiveId, djUsername, djName } = (await request.json().catch(() => ({}))) as {
    archiveId?: string;
    djUsername?: string;
    djName?: string;
  };
  if (!archiveId) return NextResponse.json({ error: "archiveId required" }, { status: 400 });

  const userRef = db.collection("users").doc(userId);

  // 1. Permanently hide this archive from future recs.
  await userRef.set(
    { dismissedArchiveIds: { [archiveId]: FieldValue.serverTimestamp() } },
    { merge: true },
  );

  // 2. Drop the artist from the watchlist (search-type favorites matching the
  //    DJ's normalized username or display name).
  const wanted = new Set<string>();
  if (djUsername) wanted.add(normUser(djUsername));
  if (djName) wanted.add(normUser(djName));
  if (wanted.size > 0) {
    const favs = await userRef.collection("favorites").where("type", "==", "search").get();
    const deletes: Promise<unknown>[] = [];
    for (const d of favs.docs) {
      const term = (d.data().term as string | undefined) || "";
      const u = (d.data().djUsername as string | undefined) || "";
      if (wanted.has(normUser(term)) || (u && wanted.has(normUser(u)))) {
        deletes.push(d.ref.delete());
      }
    }
    await Promise.all(deletes);
  }

  return NextResponse.json({ ok: true });
}
