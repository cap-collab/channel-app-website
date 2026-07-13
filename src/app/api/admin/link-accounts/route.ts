import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { MAX_LINKED_UIDS } from "@/lib/account-links";
import { migrateAliasToPrimary } from "@/lib/account-link-migrate";

// Admin-only account linking (alias-uid model). Operated from the Users tab's
// per-row "Add alias" dropdown: attach `aliasUid` as an alias of `primaryUid`.
// See src/lib/account-links.ts for the data model and invariants.

async function verifyAdmin(request: NextRequest): Promise<{ ok: boolean; uid?: string }> {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return { ok: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { ok: false };
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { ok: false };
    const role = (await db.collection("users").doc(decoded.uid).get()).data()?.role;
    if (role === "admin" || role === "broadcaster") return { ok: true, uid: decoded.uid };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// POST — link aliasUid as an alias of primaryUid.
export async function POST(request: NextRequest) {
  const { ok, uid: adminUid } = await verifyAdmin(request);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const { primaryUid, aliasUid, dryRun } = await request.json();
  if (!primaryUid || !aliasUid) {
    return NextResponse.json({ error: "primaryUid and aliasUid are required" }, { status: 400 });
  }
  if (primaryUid === aliasUid) {
    return NextResponse.json({ error: "Cannot link a user to itself" }, { status: 400 });
  }

  const primaryRef = db.collection("users").doc(primaryUid);
  const aliasRef = db.collection("users").doc(aliasUid);
  const [primarySnap, aliasSnap] = await Promise.all([primaryRef.get(), aliasRef.get()]);

  if (!primarySnap.exists) return NextResponse.json({ error: "Primary user not found" }, { status: 404 });
  if (!aliasSnap.exists) return NextResponse.json({ error: "Alias user not found" }, { status: 404 });

  const primaryData = primarySnap.data() || {};
  const aliasData = aliasSnap.data() || {};

  // Invariants: strict depth-1 star topology.
  if (primaryData.primaryUid) {
    return NextResponse.json(
      { error: "The chosen primary is itself an alias of another account. Pick its primary instead." },
      { status: 409 },
    );
  }
  if (Array.isArray(aliasData.aliasUids) && aliasData.aliasUids.length > 0) {
    return NextResponse.json(
      { error: "That account is a primary with its own aliases; it can't become an alias." },
      { status: 409 },
    );
  }
  if (aliasData.primaryUid && aliasData.primaryUid !== primaryUid) {
    return NextResponse.json(
      { error: "That account is already linked to a different primary. Unlink it first." },
      { status: 409 },
    );
  }
  const existingAliases: string[] = Array.isArray(primaryData.aliasUids) ? primaryData.aliasUids : [];
  if (!existingAliases.includes(aliasUid) && existingAliases.length + 2 > MAX_LINKED_UIDS) {
    return NextResponse.json(
      { error: `Linked set would exceed ${MAX_LINKED_UIDS} accounts.` },
      { status: 409 },
    );
  }

  // Preview mode: report what WOULD move, write nothing. The UI calls this first
  // so the admin sees the alias's history before committing to the link.
  if (dryRun) {
    const preview = await migrateAliasToPrimary(db, aliasUid, primaryUid, { dryRun: true });
    return NextResponse.json({ ok: true, dryRun: true, primaryUid, aliasUid, migration: preview });
  }

  const batch = db.batch();
  batch.update(aliasRef, {
    primaryUid,
    aliasLinkedAt: Timestamp.now(),
    aliasLinkedBy: adminUid,
  });
  batch.update(primaryRef, { aliasUids: FieldValue.arrayUnion(aliasUid) });

  // Fan the alias's owned-collective rights onto the primary BEFORE migration
  // strips them off the alias, so collective access follows the person.
  const aliasSlugs = (aliasData.ownedCollectiveSlugs as string[] | undefined) ?? [];
  if (aliasSlugs.length > 0) {
    batch.update(primaryRef, { ownedCollectiveSlugs: FieldValue.arrayUnion(...aliasSlugs) });
  }
  await batch.commit();

  // Add the primary uid to each collective's owners[] (mirrors reconcile).
  for (const slug of aliasSlugs) {
    const collSnap = await db.collection("collectives").where("slug", "==", slug).limit(1).get();
    if (!collSnap.empty) {
      await collSnap.docs[0].ref.update({ owners: FieldValue.arrayUnion(primaryUid) });
    }
  }

  // The alias is only a LOGIN — move everything it accumulated onto the primary
  // and strip its identity, so signing in with it simply makes you the primary.
  const migration = await migrateAliasToPrimary(db, aliasUid, primaryUid);

  return NextResponse.json({ ok: true, primaryUid, aliasUid, migration });
}

// DELETE — unlink aliasUid from its primary. Backfilled content stays on the
// primary; only the pointer/reverse-index fields are removed.
export async function DELETE(request: NextRequest) {
  const { ok } = await verifyAdmin(request);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 500 });

  const { aliasUid } = await request.json();
  if (!aliasUid) return NextResponse.json({ error: "aliasUid is required" }, { status: 400 });

  const aliasRef = db.collection("users").doc(aliasUid);
  const aliasSnap = await aliasRef.get();
  if (!aliasSnap.exists) return NextResponse.json({ error: "Alias user not found" }, { status: 404 });

  const primaryUid = aliasSnap.data()?.primaryUid as string | undefined;
  if (!primaryUid) return NextResponse.json({ error: "That account is not an alias" }, { status: 400 });

  const batch = db.batch();
  batch.update(aliasRef, {
    primaryUid: FieldValue.delete(),
    aliasLinkedAt: FieldValue.delete(),
    aliasLinkedBy: FieldValue.delete(),
  });
  batch.update(db.collection("users").doc(primaryUid), {
    aliasUids: FieldValue.arrayRemove(aliasUid),
  });
  await batch.commit();

  return NextResponse.json({ ok: true, unlinked: aliasUid, primaryUid });
}
