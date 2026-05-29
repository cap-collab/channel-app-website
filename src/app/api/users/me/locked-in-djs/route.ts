import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

// GET /api/users/me/locked-in-djs
// Returns the set of DJs the current user has previously "locked in" with,
// derived from chats/{djUsername}/messages where messageType=lockedin and the
// posting username matches the user's chatUsername. Used to populate the
// engagement section of /explore "On your watchlist".
//
// Response: { djs: Array<{ djUsername: string; lastAt: string }> }

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

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function GET(request: NextRequest) {
  const { userId } = await verifyUser(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ djs: [] });
    }
    const userData = userSnap.data() || {};
    const chatUsername =
      (userData.chatUsername as string | undefined) ||
      (userData.displayName as string | undefined) ||
      "";
    if (!chatUsername) {
      return NextResponse.json({ djs: [] });
    }
    const normalizedSelf = normalize(chatUsername);

    // Collection-group query for all "lockedin" messages by this username.
    // We compare username field case-insensitively at read time because
    // chat messages store the display-form username, not the normalized one.
    const snap = await db
      .collectionGroup("messages")
      .where("messageType", "==", "lockedin")
      .where("username", "==", chatUsername)
      .limit(2000)
      .get();

    // Aggregate by DJ. The parent collection name is the DJ username.
    const byDj = new Map<string, number>(); // djUsername -> max(timestamp ms)
    for (const doc of snap.docs) {
      const ref = doc.ref;
      // path is chats/{djUsername}/messages/{id}
      const parts = ref.path.split("/");
      const idx = parts.indexOf("chats");
      const djUsername = idx >= 0 ? parts[idx + 1] : undefined;
      if (!djUsername) continue;
      if (djUsername === "channelbroadcast") continue;
      if (normalize(djUsername) === normalizedSelf) continue;
      const ts = doc.get("timestamp");
      const ms =
        ts && typeof ts.toMillis === "function" ? ts.toMillis() : Date.now();
      const prev = byDj.get(djUsername) ?? 0;
      if (ms > prev) byDj.set(djUsername, ms);
    }

    const djs = Array.from(byDj.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([djUsername, ms]) => ({
        djUsername,
        lastAt: new Date(ms).toISOString(),
      }));

    return NextResponse.json({ djs });
  } catch (err) {
    console.error("[users/me/locked-in-djs] error", err);
    return NextResponse.json(
      { error: "Failed to fetch locked-in history" },
      { status: 500 },
    );
  }
}
