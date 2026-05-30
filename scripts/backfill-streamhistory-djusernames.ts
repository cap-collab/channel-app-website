// Backfill the flat `djUsernames: string[]` field on every existing
// users/{uid}/streamHistory/* doc.
//
// Why: the go-live cron uses array_contains on djUsernames to find streamers
// of a given DJ. Existing docs only have the structured `djs: [{ username }]`
// field, which Firestore can't index inside array-of-objects, so they don't
// match the query until the flat mirror exists.
//
// This script is idempotent — docs that already have djUsernames are skipped
// (or rewritten only if the derived value differs).
//
// Usage: npx tsx scripts/backfill-streamhistory-djusernames.ts [--dry]

import * as fs from "fs";
import * as path from "path";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

function deriveDjUsernames(djs: unknown): string[] {
  if (!Array.isArray(djs)) return [];
  const out = new Set<string>();
  for (const d of djs) {
    if (!d || typeof d !== "object") continue;
    const u = (d as { username?: unknown }).username;
    if (typeof u === "string") {
      const trimmed = u.trim();
      if (trimmed.length > 0) out.add(trimmed);
    }
  }
  return Array.from(out);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  for (const x of a) if (!sb.has(x)) return false;
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  if (!getApps().length) {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    if (privateKey && privateKey.includes("BEGIN PRIVATE KEY") && clientEmail) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.includes("\\n")
            ? privateKey.replace(/\\n/g, "\n")
            : privateKey,
        }),
      });
    } else {
      initializeApp({ credential: applicationDefault(), projectId });
    }
  }

  const db = getFirestore();
  console.log(`[backfill] dryRun=${dryRun}`);

  const snap = await db.collectionGroup("streamHistory").get();
  console.log(`[backfill] read ${snap.size} streamHistory docs`);

  let scanned = 0;
  let alreadyOk = 0;
  let toWrite = 0;
  let skippedNoUsernames = 0;
  let writes = 0;

  // Firestore batches max 500 writes
  let batch = db.batch();
  let batchCount = 0;
  const FLUSH = 400;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data();
    const derived = deriveDjUsernames(data.djs);

    if (derived.length === 0) {
      skippedNoUsernames++;
      continue;
    }

    const existing = Array.isArray(data.djUsernames)
      ? (data.djUsernames as string[]).filter((x) => typeof x === "string")
      : null;

    if (existing && arraysEqual(existing, derived)) {
      alreadyOk++;
      continue;
    }

    toWrite++;
    if (dryRun) continue;

    batch.update(doc.ref, { djUsernames: derived });
    batchCount++;

    if (batchCount >= FLUSH) {
      await batch.commit();
      writes += batchCount;
      console.log(`[backfill] committed ${writes} writes…`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
    writes += batchCount;
  }

  console.log(`[backfill] done`);
  console.log(`  scanned:             ${scanned}`);
  console.log(`  already ok:          ${alreadyOk}`);
  console.log(`  no djs to derive:    ${skippedNoUsernames}`);
  console.log(`  needed write:        ${toWrite}`);
  console.log(`  actual writes:       ${dryRun ? 0 : writes} ${dryRun ? "(dry run)" : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
