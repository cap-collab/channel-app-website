import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

// Admin "Users" tab data source. Lists every user, grouped into DJs / listeners,
// with per-user engagement stats read cheaply from the precomputed
// system/user-stats/entries subcollection (written by the weekly-recs backfill,
// which already reads each user's loveHistory + streamHistory — so the stats
// cost ~nothing extra). This route does NO collection-group scans.

export const dynamic = "force-dynamic";

// Mirrors isDJ() in useUserRole (inlined to avoid pulling the client Firebase
// SDK, which that hook module imports at top level, into a server route).
const isDJRole = (role: string) => role === "dj" || role === "broadcaster" || role === "admin";

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

interface UserRow {
  uid: string;
  label: string;
  email: string;
  role: string;
  isDJ: boolean;
  ownsCollective: boolean;
  lastSeenAtMs: number | null;
  lovesGiven: number;
  archivesStreamed: number;
  hasStats: boolean; // false → counts never computed yet (show "—")
}

function labelFor(data: FirebaseFirestore.DocumentData): string {
  const chatUsername = (data.chatUsername as string) || "";
  const displayName = (data.displayName as string) || "";
  const email = (data.email as string) || "";
  return chatUsername || displayName || email;
}

// Coerce a Firestore Timestamp / {_seconds} shape / ms number to millis, or null.
function seenMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const o = v as { toMillis?: () => number; _seconds?: number; seconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o._seconds === "number") return o._seconds * 1000;
  if (typeof o.seconds === "number") return o.seconds * 1000;
  return null;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdminAccess(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  // Doc-only reads: user docs (identity/role) + precomputed stats.
  const [usersSnap, statsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("system").doc("user-stats").collection("entries").get(),
  ]);

  interface StatEntry {
    lovesGiven: number;
    archivesStreamed: number;
  }
  const statsByUid = new Map<string, StatEntry>();
  statsSnap.forEach((d) => {
    const s = d.data();
    statsByUid.set(d.id, {
      lovesGiven: (s.lovesGiven as number) ?? 0,
      archivesStreamed: (s.archivesStreamed as number) ?? 0,
    });
  });

  const rows: UserRow[] = [];
  let skippedNoEmail = 0;
  usersSnap.forEach((doc) => {
    const data = doc.data();
    // Email-less docs are waitlist/phantom rows (no name, no activity, nothing
    // to show) — they'd render blank. Same filter the recommendations picker
    // uses. Surfaced as a count so they're not silently hidden.
    if (!data.email) {
      skippedNoEmail++;
      return;
    }

    const role = (data.role as string) || "user";
    const ownedSlugs = data.ownedCollectiveSlugs as string[] | undefined;
    const stats = statsByUid.get(doc.id);

    rows.push({
      uid: doc.id,
      label: labelFor(data),
      email: (data.email as string) || "",
      role,
      isDJ: isDJRole(role),
      ownsCollective: Array.isArray(ownedSlugs) && ownedSlugs.length > 0,
      lastSeenAtMs: seenMs(data.lastSeenAt),
      lovesGiven: stats?.lovesGiven ?? 0,
      archivesStreamed: stats?.archivesStreamed ?? 0,
      hasStats: !!stats,
    });
  });

  rows.sort((a, b) => a.label.localeCompare(b.label));

  return NextResponse.json({
    djs: rows.filter((r) => r.isDJ),
    nonDjs: rows.filter((r) => !r.isDJ),
    statsComputed: statsSnap.size > 0,
    skippedNoEmail,
  });
}
