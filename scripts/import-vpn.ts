/**
 * One-shot VPN ingest. Hand-curated input. Two outputs:
 *   1. Firestore pending-dj-profiles + usernames for the 5 DJs we own.
 *   2. public/vpn-shows.json — ShowV2[] through 2026-12-31.
 *
 * Usage:
 *   npx tsx scripts/import-vpn.ts --dry-run     # show what would happen, no writes
 *   npx tsx scripts/import-vpn.ts               # actually write
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

const SCHEDULE_UNTIL = new Date("2026-12-31T23:59:59Z");
const TZ = "America/Los_Angeles";

// Weekday: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
type Slot =
  | { kind: "monthly-nth"; weekday: number; nth: 1 | 2 | 3 | 4; startHour: number; endHour: number }
  | { kind: "weekly"; weekday: number; startHour: number; endHour: number };

interface ShowInput {
  showName: string;
  showUrl: string;
  showImageUrl?: string | null;   // cover art for the SHOW, goes to ShowV2.u
  djDisplayName: string;
  djUsername: string;
  slots: Slot[];
  bio: string;                    // show description (also seeded into new pending profiles)
  socials: { instagram?: string; soundcloud?: string };
  profileAction: "create" | "fillMissingExisting" | "appendAutoSource" | "skip";
  existingPendingDocId?: string;
}

const SHOWS: ShowInput[] = [
  {
    showName: "Suite Serenade",
    showUrl: "https://www.virtualpublic.net/suite-serenade",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/c45795cd-f9f9-48f9-8428-388c5ab31be1/SUITESERENADE.jpg",
    djDisplayName: "Abbyliciouss",
    djUsername: "abbyliciouss",
    slots: [{ kind: "monthly-nth", weekday: 1, nth: 1, startHour: 19, endHour: 21 }],
    bio: "A monthly dive into deep, soulful club sounds from LA’s underground. The show explores new and exciting club sounds while diving into the underground, blending them with timeless classics.",
    socials: { instagram: "https://www.instagram.com/abbyliciouss.xoxo", soundcloud: "https://soundcloud.com/abbyliciouss_0" },
    profileAction: "create",
  },
  {
    showName: "Soft Terrain",
    showUrl: "https://www.virtualpublic.net/soft-terrain",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/2053524a-c94a-4eca-99aa-2e62180623d7/VPN_SHOW_SOFTTERRAIN.jpg",
    djDisplayName: "Naomi Green",
    djUsername: "naomigreen",
    slots: [{ kind: "monthly-nth", weekday: 3, nth: 3, startHour: 20, endHour: 21 }],
    bio: "Soft Terrain drifts through dubby textures, leftfield rhythms, and slow-burn atmospheres ~ a monthly invitation to melt, wander, and recalibrate.",
    socials: { instagram: "https://www.instagram.com/naomigreeen", soundcloud: "https://soundcloud.com/itsnaomigreen" },
    profileAction: "skip",
  },
  {
    showName: "Surrealchemistry",
    showUrl: "https://www.virtualpublic.net/surrealchemistry",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/99d6c0d8-9e0d-46b1-980f-012c20d37444/VPN_Show_Surrealchemistry.jpg",
    djDisplayName: "Max Ellington",
    djUsername: "maxellington",
    slots: [{ kind: "monthly-nth", weekday: 2, nth: 2, startHour: 13, endHour: 15 }],
    bio: "Exploring the spectrum of psychedelia in dance music.",
    socials: { instagram: "https://www.instagram.com/max__ellington/", soundcloud: "https://soundcloud.com/berrmax" },
    profileAction: "skip",
  },
  {
    showName: "Jes Grew",
    showUrl: "https://www.virtualpublic.net/jes-grew",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/61004902-f6df-4f6a-9146-66af2abff8d3/2024_VPN_WEBSITE_SHOW_JESGREW.jpg",
    djDisplayName: "Drew LaBarre",
    djUsername: "drewlabarre",
    slots: [{ kind: "monthly-nth", weekday: 2, nth: 1, startHour: 18, endHour: 20 }],
    bio: "Two hours of house, dance, rhythmic expression and beyond!",
    socials: { instagram: "https://www.instagram.com/_drew_labarre_", soundcloud: "https://soundcloud.com/centricdancer" },
    profileAction: "skip",
  },
  {
    showName: "etc radio",
    showUrl: "https://www.virtualpublic.net/etc-radio",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/6d4fdf55-ebfb-463a-aadc-49c82a9332e4/VPN_SHOW_TEMPLATE_2026.02.20_3_bg_only.JPG",
    djDisplayName: "m50",
    djUsername: "m50",
    slots: [
      { kind: "weekly", weekday: 5, startHour: 20, endHour: 24 }, // Fridays 8PM-12AM
      { kind: "weekly", weekday: 0, startHour: 8, endHour: 12 },  // Sundays 8AM-12PM
    ],
    bio: "A long-running four hour expansive exploration of music, bordering ambitious experimental sound on one side & full-throttle club music on the other.",
    socials: { instagram: "https://www.instagram.com/kimochisound/", soundcloud: "https://soundcloud.com/m50/sets/etc-radio/" },
    profileAction: "create",
  },
  {
    showName: "Love Affair Radio",
    showUrl: "https://www.virtualpublic.net/love-affair-radio",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/7a8d2e68-ee1d-4589-aa15-94f4346ecce1/2024_VPN_WEBSITE_SHOW_LOVEAFFAIR.jpg",
    djDisplayName: "Pretty Gay Friendly",
    djUsername: "prettygayfriendly",
    slots: [{ kind: "monthly-nth", weekday: 3, nth: 4, startHour: 12, endHour: 14 }],
    bio: "Welcome to Love Affair where we fuse the sounds of the underground with the nostalgic vibes of yesteryear.",
    socials: { instagram: "https://www.instagram.com/love.affair.la/", soundcloud: "https://soundcloud.com/prettygayfriendly" },
    profileAction: "skip",
  },
  {
    showName: "Palm Reader",
    showUrl: "https://www.virtualpublic.net/palm-reader",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/f238b6b0-3dc8-4c03-a3d3-dc15e38b1a7a/PALMREADER_SHOWIMAGE.jpg",
    djDisplayName: "New Palm",
    djUsername: "newpalm",
    slots: [{ kind: "monthly-nth", weekday: 4, nth: 3, startHour: 21, endHour: 22 }],
    bio: "A monthly experimental series dedicated to off-trail & left-field excursions, away from the dance-floor and into the ether.",
    socials: { instagram: "https://www.instagram.com/new.palm/", soundcloud: "https://soundcloud.com/newpalm" },
    profileAction: "skip",
  },
  {
    showName: "Room Service",
    showUrl: "https://www.virtualpublic.net/room-service",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/8e424a33-0b6b-4368-8164-2194bc4a8deb/2024_VPN_WEBSITE_SHOW_ROOMSERVICE.jpg",
    djDisplayName: "MTHRMTHRMTHRMTHR",
    djUsername: "mthrmthrmthrmthr",
    slots: [{ kind: "monthly-nth", weekday: 6, nth: 1, startHour: 17, endHour: 19 }],
    bio: "Streaming from Berlin. Bass music and beyond.",
    socials: { instagram: "https://www.instagram.com/mthrmthrmthrmthr/", soundcloud: "https://soundcloud.com/mthrmthrmthrmthr" },
    profileAction: "create",
  },
  {
    showName: "Cathedral Cove",
    showUrl: "https://www.virtualpublic.net/cathedral-cove",
    showImageUrl: "https://images.squarespace-cdn.com/content/v1/65d2bcdc7cec604faf22a41a/6dec9354-4bee-45dc-9332-0b201ea64e36/IMG_3183+%281%29.jpeg",
    djDisplayName: "DJ AA",
    djUsername: "djaa",
    slots: [{ kind: "monthly-nth", weekday: 5, nth: 1, startHour: 15, endHour: 16 }],
    bio: "Presenting and connecting disparate sounds from the past 100 years of electronically recorded music.",
    socials: { instagram: "https://www.instagram.com/therealaaronaldorisioofficial/" },
    profileAction: "create",
  },
];

interface ShowV2 {
  n: string;
  s: string;
  e: string;
  d?: string;
  j?: string;
  u?: string | null;
  t?: string;
  p?: string;
  l?: string;
}

// Wall-clock-in-tz → UTC ISO. Iterative refine.
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

function nthWeekdayOfMonth(year: number, monthZeroBased: number, weekday: number, nth: number): number | null {
  const firstDow = new Date(Date.UTC(year, monthZeroBased, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
  return day > daysInMonth ? null : day;
}

function expandSlot(slot: Slot, from: Date, until: Date): { s: string; e: string }[] {
  const out: { s: string; e: string }[] = [];
  const emit = (y: number, m: number, d: number) => {
    let endHour = slot.endHour;
    let endDay = d;
    if (endHour === 24) { endHour = 0; endDay = d + 1; }
    const startISO = wallTimeToUtcISO(y, m, d, slot.startHour, 0, TZ);
    const endISO = wallTimeToUtcISO(y, m, endDay, endHour, 0, TZ);
    if (new Date(startISO) >= from && new Date(startISO) <= until) {
      out.push({ s: startISO, e: endISO });
    }
  };
  if (slot.kind === "weekly") {
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    const dow = cursor.getUTCDay();
    cursor.setUTCDate(cursor.getUTCDate() + ((slot.weekday - dow + 7) % 7));
    while (cursor <= until) {
      emit(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate());
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  } else {
    const startMonth = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const endMonth = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1));
    for (let m = new Date(startMonth); m <= endMonth; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const day = nthWeekdayOfMonth(m.getUTCFullYear(), m.getUTCMonth(), slot.weekday, slot.nth);
      if (day) emit(m.getUTCFullYear(), m.getUTCMonth(), day);
    }
  }
  return out;
}

async function writeProfile(show: ShowInput) {
  if (show.profileAction === "skip") {
    return `skip (claimed/collective)`;
  }
  const now = new Date();
  const autoSource = { stationId: "vpn", showName: show.showName, lastSeen: now };
  const socials: Record<string, string> = {};
  if (show.socials.instagram) socials.instagram = show.socials.instagram;
  if (show.socials.soundcloud) socials.soundcloud = show.socials.soundcloud;

  // Append-only: existing pending-dj-profiles/<username> doc, append VPN to autoSources.
  // No bio/photo/socials touched — those are owned by the dublab sync / user's own edits.
  if (show.profileAction === "appendAutoSource") {
    const ref = db.collection("pending-dj-profiles").doc(show.djUsername);
    const snap = await ref.get();
    if (!snap.exists) return `error: pending-dj-profiles/${show.djUsername} not found`;
    const data = snap.data() || {};
    const existingSources: Array<{ stationId: string; showName: string }> = data.autoSources || [];
    const hasVpn = existingSources.some((s) => s.stationId === "vpn" && s.showName === show.showName);
    if (hasVpn) return `noop pending-dj-profiles/${show.djUsername} (VPN already in autoSources)`;
    const updates = {
      autoSources: [...existingSources, autoSource],
      updatedAt: now,
    };
    if (DRY_RUN) return `append vpn to pending-dj-profiles/${show.djUsername} (existing: ${existingSources.map(s => s.stationId).join(",")})`;
    await ref.update(updates);
    return `appended vpn to pending-dj-profiles/${show.djUsername}`;
  }

  if (show.profileAction === "fillMissingExisting" && show.existingPendingDocId) {
    const ref = db.collection("pending-dj-profiles").doc(show.existingPendingDocId);
    const snap = await ref.get();
    if (!snap.exists) return `error: pending doc ${show.existingPendingDocId} not found`;
    const data = snap.data() || {};
    const existingSources: Array<{ stationId: string; showName: string }> = data.autoSources || [];
    const hasVpn = existingSources.some((s) => s.stationId === "vpn" && s.showName === show.showName);
    const updates: Record<string, unknown> = {
      autoSources: hasVpn ? existingSources : [...existingSources, autoSource],
      source: "auto",
      validatedFrom: data.validatedFrom || show.showUrl,
      updatedAt: now,
    };
    // Fill missing only
    if (!data.djProfile?.bio && show.bio) updates["djProfile.bio"] = show.bio;
    // We deliberately don't fill djProfile.photoUrl from VPN — VPN gives us SHOW cover art,
    // not DJ portraits. Show art belongs on the show instance (ShowV2.u), not on the DJ profile.
    if (Object.keys(socials).length > 0) {
      const existingSocials = data.djProfile?.socialLinks || {};
      const merged = { ...existingSocials };
      for (const [k, v] of Object.entries(socials)) {
        if (!merged[k]) merged[k] = v;
      }
      updates["djProfile.socialLinks"] = merged;
    }
    if (DRY_RUN) return `update existing pending-dj-profiles/${show.existingPendingDocId} (fill-missing)`;
    await ref.update(updates);
    return `updated pending-dj-profiles/${show.existingPendingDocId}`;
  }

  // create — keyed by normalized username (lowercase alphanumeric)
  const docId = show.djUsername;
  const ref = db.collection("pending-dj-profiles").doc(docId);
  const newDoc = {
    djName: show.djDisplayName,
    chatUsername: show.djDisplayName,
    chatUsernameNormalized: docId,
    normalizedName: show.djDisplayName.toLowerCase(),
    source: "auto",
    status: "pending",
    autoSources: [autoSource],
    djProfile: {
      bio: show.bio,
      photoUrl: null,
      location: null,
      genres: [],
      socialLinks: socials,
    },
    validatedFrom: show.showUrl,
    createdAt: now,
    updatedAt: now,
  };
  if (DRY_RUN) return `create pending-dj-profiles/${docId}`;
  await ref.set(newDoc, { merge: false });

  // Reserve username
  const usernameRef = db.collection("usernames").doc(docId);
  const usernameSnap = await usernameRef.get();
  if (!usernameSnap.exists) {
    await usernameRef.set({
      displayName: show.djDisplayName,
      usernameHandle: docId,
      uid: `pending:${docId}`,
      isPending: true,
      claimedAt: FieldValue.serverTimestamp(),
    });
  }
  return `created pending-dj-profiles/${docId} + username`;
}

async function main() {
  console.log(`VPN one-shot ingest. ${DRY_RUN ? "DRY RUN" : "LIVE"}. ${SHOWS.length} shows.\n`);

  const v2: ShowV2[] = [];
  const now = new Date();

  for (const show of SHOWS) {
    const result = await writeProfile(show);
    let instanceCount = 0;
    for (const slot of show.slots) {
      for (const inst of expandSlot(slot, now, SCHEDULE_UNTIL)) {
        v2.push({
          n: show.showName,
          s: inst.s,
          e: inst.e,
          j: show.djDisplayName,
          p: show.djUsername,
          u: show.showImageUrl || null,
          t: slot.kind === "weekly" ? "weekly" : "monthly",
          l: show.showUrl,
          d: show.bio,
        });
        instanceCount++;
      }
    }
    console.log(`  ${show.showName.padEnd(20)} → ${result}, ${instanceCount} instances → /dj/${show.djUsername}`);
  }

  v2.sort((a, b) => new Date(a.s).getTime() - new Date(b.s).getTime());

  const outPath = resolve(__dirname, "..", "public", "vpn-shows.json");
  if (DRY_RUN) {
    console.log(`\n(DRY RUN) Would write ${v2.length} show instances to ${outPath}`);
    console.log(`First 2 instances:`);
    console.log(JSON.stringify(v2.slice(0, 2), null, 2));
  } else {
    await writeFile(outPath, JSON.stringify(v2, null, 2), "utf8");
    console.log(`\nWrote ${v2.length} show instances to ${outPath}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Importer failed:", e);
  process.exit(1);
});
