/**
 * One-shot: import past Palm Reader episodes.
 *
 * For each past show:
 *   1. Emit a ShowV2 into public/vpn-history.json:
 *        p:"newpalm" (primary link to the collective)
 *        ap:["<guestNormalized>"] (additional link to the guest DJ)
 *        u:<palm-reader cover>
 *        l:"https://www.virtualpublic.net/palm-reader"
 *   2. If the guest has no Firestore profile, create a minimal pending-dj-profiles
 *      doc: just chatUsername + chatUsernameNormalized + status:"pending" + createdBy.
 *      NO source:"auto", NO autoSources — so the auto-generated banner stays off.
 *      Reserve usernames/<guest>.
 *   3. Append each guest to collectives/btcNzs...newpalm.residentDJs (deduped).
 *
 * Usage:
 *   npx tsx scripts/import-vpn-history.ts --dry-run
 *   npx tsx scripts/import-vpn-history.ts
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch (e) {
    console.error("Could not load env file:", path, e);
  }
}
loadEnv(resolve(__dirname, "../.env.production"));

const DRY_RUN = process.argv.includes("--dry-run");

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY!;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
    }),
  });
}
const db = getFirestore();

const PALM_READER_IMAGE =
  "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/f238b6b0-3dc8-4c03-a3d3-dc15e38b1a7a/PALMREADER_SHOWIMAGE.jpg";
const PALM_READER_URL = "https://www.virtualpublic.net/palm-reader";
const NEW_PALM_COLLECTIVE_ID = "tvPwfO2opjvhVcJO1S5G";
const TZ = "America/Los_Angeles";

// All past Palm Reader episodes. The recurring slot is "Monthly 3rd Thursday 9-10 PM PST",
// so each historical entry uses the same hour window (21:00-22:00 PST) on the listed date.
interface HistoryEntry {
  date: string;       // YYYY-MM-DD (Los Angeles wall date)
  guestName: string;
}
const HISTORY: HistoryEntry[] = [
  { date: "2025-08-07", guestName: "Israel Vines" },
  { date: "2025-02-20", guestName: "Seung L" },
  { date: "2025-02-20", guestName: "Spillman" },
  { date: "2025-01-23", guestName: "Radha" },
  { date: "2024-12-18", guestName: "David Grunzweig" },
  { date: "2024-08-15", guestName: "Seiji Fujiwara" },
  { date: "2024-07-18", guestName: "Lena Deen" },
  { date: "2024-05-16", guestName: "DJ SAD" },
  { date: "2024-04-18", guestName: "Matt Sussman" },
  { date: "2024-02-15", guestName: "Max Ellington" },
  { date: "2024-01-18", guestName: "Seung L" },
];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Wall-clock-in-tz → UTC ISO. Same iterative refine pattern as import-vpn.ts.
function wallTimeToUtcISO(year: number, monthZeroBased: number, day: number, hour: number, minute: number, tz: string): string {
  let utcGuess = Date.UTC(year, monthZeroBased, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(utcGuess));
    const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
    let h = get("hour");
    if (h === 24) h = 0;
    const tzWall = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"));
    const wanted = Date.UTC(year, monthZeroBased, day, hour, minute);
    const diff = wanted - tzWall;
    if (diff === 0) break;
    utcGuess += diff;
  }
  return new Date(utcGuess).toISOString();
}

interface ShowV2 {
  n: string;
  s: string;
  e: string;
  d?: string | null;
  j?: string;
  u?: string | null;
  t?: string;
  p?: string;
  ap?: string[];
  pName?: string;     // display name for p (web-app extension)
  apNames?: string[]; // display names parallel to ap (web-app extension)
  l?: string;
}

async function ensurePendingProfile(guestName: string, normalizedId: string): Promise<string> {
  // Already a user? leave it
  const u = await db.collection("users").where("chatUsernameNormalized", "==", normalizedId).limit(1).get();
  if (!u.empty) return `existing user ${u.docs[0].id}`;
  // Already a pending profile? leave it
  const p = await db.collection("pending-dj-profiles").where("chatUsernameNormalized", "==", normalizedId).limit(1).get();
  if (!p.empty) return `existing pending ${p.docs[0].id}`;

  // Create a bare pending profile — NO source:"auto", NO autoSources
  const profileRef = db.collection("pending-dj-profiles").doc(normalizedId);
  const usernameRef = db.collection("usernames").doc(normalizedId);
  const now = new Date();
  const newProfile = {
    djName: guestName,
    chatUsername: guestName,
    chatUsernameNormalized: normalizedId,
    normalizedName: guestName.toLowerCase(),
    status: "pending",
    djProfile: {
      bio: null,
      photoUrl: null,
      location: null,
      genres: [],
      socialLinks: {},
    },
    createdAt: now,
    updatedAt: now,
    createdBy: "vpn-history-import",
  };
  if (DRY_RUN) return `(dry-run) would create pending-dj-profiles/${normalizedId}`;
  await profileRef.set(newProfile);
  const usernameSnap = await usernameRef.get();
  if (!usernameSnap.exists) {
    await usernameRef.set({
      displayName: guestName,
      usernameHandle: normalizedId,
      uid: `pending:${normalizedId}`,
      isPending: true,
      claimedAt: FieldValue.serverTimestamp(),
    });
  }
  return `created pending-dj-profiles/${normalizedId} + username`;
}

async function appendToNewPalmResidents(guests: Array<{ djName: string; djUsername: string; djUserId?: string }>) {
  const collRef = db.collection("collectives").doc(NEW_PALM_COLLECTIVE_ID);
  const snap = await collRef.get();
  if (!snap.exists) {
    console.error("New Palm collective doc missing!");
    return;
  }
  const data = snap.data() || {};
  const existing: Array<{ djName: string; djUsername?: string; djUserId?: string; djPhotoUrl?: string }> = data.residentDJs || [];
  const existingUsernames = new Set(existing.map((r) => r.djUsername).filter(Boolean));

  const toAdd = guests.filter((g) => !existingUsernames.has(g.djUsername));
  if (toAdd.length === 0) {
    console.log(`New Palm residents: all ${guests.length} already present, nothing to add`);
    return;
  }

  const updated = [...existing, ...toAdd];
  console.log(`New Palm residents: appending ${toAdd.length} → ${toAdd.map((g) => g.djName).join(", ")}`);
  if (DRY_RUN) return;
  await collRef.update({ residentDJs: updated, updatedAt: new Date() });
}

async function main() {
  console.log(`VPN history import. ${DRY_RUN ? "DRY RUN" : "LIVE"}. ${HISTORY.length} past shows.\n`);

  // 1. Ensure profiles for each unique guest
  const uniqueGuests = Array.from(new Map(HISTORY.map((h) => [normalize(h.guestName), h.guestName])).entries());
  const guestResolvedUsernames: Record<string, string> = {};
  const residentEntries: Array<{ djName: string; djUsername: string; djUserId?: string }> = [];

  for (const [normalizedId, displayName] of uniqueGuests) {
    const result = await ensurePendingProfile(displayName, normalizedId);
    guestResolvedUsernames[normalizedId] = normalizedId;
    // Fetch the canonical djUserId / djPhotoUrl for the resident entry if it exists
    const u = await db.collection("users").where("chatUsernameNormalized", "==", normalizedId).limit(1).get();
    if (!u.empty) {
      const uData = u.docs[0].data();
      residentEntries.push({
        djName: uData.chatUsername || displayName,
        djUsername: normalizedId,
        djUserId: u.docs[0].id,
      });
    } else {
      residentEntries.push({ djName: displayName, djUsername: normalizedId });
    }
    console.log(`  ${displayName.padEnd(22)} → ${result}`);
  }

  // 2. Append guests to New Palm residentDJs (idempotent)
  await appendToNewPalmResidents(residentEntries);

  // 3. Emit ShowV2 entries
  const v2: ShowV2[] = HISTORY.map((h) => {
    const [y, m, d] = h.date.split("-").map(Number);
    const startISO = wallTimeToUtcISO(y, m - 1, d, 21, 0, TZ);
    const endISO = wallTimeToUtcISO(y, m - 1, d, 22, 0, TZ);
    return {
      n: `Palm Reader w/ ${h.guestName}`,
      s: startISO,
      e: endISO,
      d: null,
      // j is a legacy free-text host label kept around for older shows. We don't use it
      // to drive chip rendering — chips are built from (p, pName) + (ap[], apNames[]).
      u: PALM_READER_IMAGE,
      t: "monthly",
      p: "newpalm",
      pName: "New Palm",
      ap: [normalize(h.guestName)],
      apNames: [h.guestName],
      l: PALM_READER_URL,
    };
  });
  v2.sort((a, b) => new Date(a.s).getTime() - new Date(b.s).getTime());

  const outPath = resolve(__dirname, "..", "public", "vpn-history.json");
  if (DRY_RUN) {
    console.log(`\n(DRY RUN) Would write ${v2.length} past show entries to ${outPath}`);
    console.log("First 2:");
    console.log(JSON.stringify(v2.slice(0, 2), null, 2));
  } else {
    await writeFile(outPath, JSON.stringify(v2, null, 2), "utf8");
    console.log(`\nWrote ${v2.length} past show entries to ${outPath}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Importer failed:", e);
  process.exit(1);
});
