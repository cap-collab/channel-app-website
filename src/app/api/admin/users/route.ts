import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

// Mirrors isDJ() in useUserRole (inlined to avoid pulling the client Firebase
// SDK, which that hook module imports at top level, into a server route).
const isDJRole = (role: string) => role === "dj" || role === "broadcaster" || role === "admin";

// Admin "Users" tab data source. Lists every UNIQUE user (aliases fold into
// their primary and never appear standalone), grouped into DJs / non-DJs, with
// per-user engagement stats read cheaply from the precomputed
// system/user-stats/entries subcollection (written by the weekly-recs backfill).
// This route does NO collection-group scans of loveHistory/streamHistory.

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

interface AliasSummary {
  uid: string;
  label: string;
  email: string;
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
  aliases: AliasSummary[];
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

  // Doc-only reads: user docs (identity/role/aliases) + precomputed stats.
  const [usersSnap, statsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("system").doc("user-stats").collection("entries").get(),
  ]);

  interface StatEntry {
    lovesGiven: number;
    archivesStreamed: number;
    lastSeenAtMs: number | null;
  }
  const statsByUid = new Map<string, StatEntry>();
  statsSnap.forEach((d) => {
    const s = d.data();
    statsByUid.set(d.id, {
      lovesGiven: (s.lovesGiven as number) ?? 0,
      archivesStreamed: (s.archivesStreamed as number) ?? 0,
      lastSeenAtMs: (s.lastSeenAtMs as number | null) ?? null,
    });
  });

  // Index every user doc; separate aliases (have primaryUid) from primaries.
  const docs = new Map<string, FirebaseFirestore.DocumentData>();
  usersSnap.forEach((d) => docs.set(d.id, d.data()));

  const rows: UserRow[] = [];
  let skippedNoEmail = 0;
  for (const [uid, data] of Array.from(docs.entries())) {
    if (data.primaryUid) continue; // alias → folded into its primary below
    // Email-less docs are waitlist/phantom rows (no name, no activity, nothing
    // to link) — they'd render blank. Same filter the recommendations picker
    // uses. Surfaced as a count so they're not silently hidden.
    if (!data.email) {
      skippedNoEmail++;
      continue;
    }

    const role = (data.role as string) || "user";
    const ownedSlugs = data.ownedCollectiveSlugs as string[] | undefined;
    const aliasUids = (data.aliasUids as string[] | undefined) ?? [];

    // Base stats from the primary's own entry. lastSeen uses the live user doc
    // (fresher than the periodic stats snapshot), maxed across the linked set.
    const own = statsByUid.get(uid);
    let lovesGiven = own?.lovesGiven ?? 0;
    let archivesStreamed = own?.archivesStreamed ?? 0;
    let lastSeenAtMs = seenMs(data.lastSeenAt);
    let hasStats = !!own;

    // Fold each alias: sum its stats into the primary, list it under the row.
    const aliases: AliasSummary[] = [];
    for (const aliasUid of aliasUids) {
      const aliasData = docs.get(aliasUid);
      if (!aliasData) continue;
      aliases.push({
        uid: aliasUid,
        label: labelFor(aliasData),
        email: (aliasData.email as string) || "",
      });
      const aStats = statsByUid.get(aliasUid);
      if (aStats) {
        lovesGiven += aStats.lovesGiven;
        archivesStreamed += aStats.archivesStreamed;
        hasStats = true;
      }
      // Most-recent lastSeen across the linked set (from the live alias doc).
      const aliasSeen = seenMs(aliasData.lastSeenAt);
      if (aliasSeen && (!lastSeenAtMs || aliasSeen > lastSeenAtMs)) {
        lastSeenAtMs = aliasSeen;
      }
    }

    rows.push({
      uid,
      label: labelFor(data),
      email: (data.email as string) || "",
      role,
      isDJ: isDJRole(role),
      ownsCollective: Array.isArray(ownedSlugs) && ownedSlugs.length > 0,
      lastSeenAtMs,
      lovesGiven,
      archivesStreamed,
      hasStats,
      aliases,
    });
  }

  rows.sort((a, b) => a.label.localeCompare(b.label));
  const djs = rows.filter((r) => r.isDJ);
  const nonDjs = rows.filter((r) => !r.isDJ);

  return NextResponse.json({
    djs,
    nonDjs,
    statsComputed: statsSnap.size > 0,
    skippedNoEmail,
  });
}
