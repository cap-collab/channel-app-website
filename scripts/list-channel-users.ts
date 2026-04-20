// One-off: list DJ + listener cohorts for the next channel-wide broadcast.
// Usage: npx tsx scripts/list-channel-users.ts

import * as fs from "fs";
import * as path from "path";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Minimal .env.local loader (avoids dotenv dependency).
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

const FIRST_NAME_OVERRIDES: Record<string, string> = {
  "anthonypomije@gmail.com": "Anthony",
  "paulsboston@gmail.com": "Paul",
  "kevinlipman7@gmail.com": "Kevin",
  "drew.labarre@gmail.com": "Drew",
  "celebritybitcrush@gmail.com": "Keigo",
  "cap@beyondalgorithms.cloud": "Cap",
  "2ty7cmd5tf@privaterelay.appleid.com": "Cap",
  // Listener corrections from manual review
  "aubespin@gmail.com": "David",
  "jchatard@outlook.fr": "JP",
  "powell.oliver@me.com": "Oliver",
  "ssantos2107@gmail.com": "Sofia",
  "walidvb@gmail.com": "Walid",
  "benjaminruthven@aol.com": "Benji",
  "billyboyali@gmail.com": "Bilal",
  "cf6nq9k22f@privaterelay.appleid.com": "there",
  "emwhitenoise@gmail.com": "Emily",
  "jbektemba0711@gmail.com": "Jelani",
  "mashinerie@gmail.com": "hello",
  "t8bm2sdryx@privaterelay.appleid.com": "user1",
  "v8yykfdgbd@privaterelay.appleid.com": "cpl",
  "yaldahesh@gmail.com": "Yalda",
  "pierre.elie.fauche@gmail.com": "Pierre-Elie",
  "margot2themax@gmail.com": "Margot",
  "akumenmusic@gmail.com": "Tony",
};

const EXCLUDE_EMAILS = new Set([
  "maiii@posteo.la",
  "64j87qk747@privaterelay.appleid.com",
]);

const EXTRA_PENDING_DJS = [
  { email: "paulsboston@gmail.com", name: "Paul" },
  { email: "juniorsbl@gmail.com", name: "Junior" },
  { email: "hello@justinmiller.nyc", name: "Justin" },
  { email: "cesartoribio1@gmail.com", name: "Cesar" },
  { email: "celebritybitcrush@gmail.com", name: "Keigo" },
  { email: "dorwand@gmail.com", name: "Dor" },
  { email: "omer.almileik@gmail.com", name: "Omer" },
];

const EXTRA_LISTENERS = [
  { email: "alexandra.sentisfranco@gmail.com", name: "Alexandra" },
  { email: "charles.fages@gmail.com", name: "Charles" },
  { email: "emroseclements@gmail.com", name: "Em Rose" },
  { email: "jahichambers@gmail.com", name: "Jahi" },
];

// Recipients from the Week 3 send (pulled from /api/admin/dj-newsletter compare).
const WEEK3_EMAILS = new Set<string>([
  "anthonypomije@gmail.com",
  "paulsboston@gmail.com",
  "maxcheney@gmail.com",
  "danimunt91@gmail.com",
  "j.r.colby@gmail.com",
  "celebritybitcrush@gmail.com",
  "kevinlipman7@gmail.com",
  "stephan.kimbel@gmail.com",
  "5kyriv3r5@gmail.com",
  "bilaliwood@gmail.com",
  "drew.labarre@gmail.com",
  "akumenmusic@gmail.com",
  "qhyh7znw7y@privaterelay.appleid.com",
  "prettygayfriendly@gmail.com",
  "2ty7cmd5tf@privaterelay.appleid.com",
  "clindsay123@gmail.com",
  "toby.alden@gmail.com",
  "paulanthonychin@gmail.com",
  "juniorsbl@gmail.com",
  "hello@justinmiller.nyc",
  "cesartoribio1@gmail.com",
  "dorwand@gmail.com",
  "omer.almileik@gmail.com",
]);

// Priority: manual override → Firebase name → chatUsername → "there".
// Overrides are the canonical "internal" first name used only for newsletter
// greetings — they intentionally beat the Firebase `name` field, which
// often holds a DJ/chat handle rather than a real first name.
function resolveFirstName(email: string, name?: string, chatUsername?: string): string {
  const override = FIRST_NAME_OVERRIDES[email];
  if (override) return override;
  if (name && name.trim()) return name.trim().split(/\s+/)[0];
  if (chatUsername && chatUsername.trim()) return chatUsername.trim();
  return "there";
}

async function main() {
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

  // DJ cohort
  const djSnap = await db.collection("users").where("role", "==", "dj").get();
  const djRows: Array<{
    email: string;
    firstName: string;
    cohort: "dj";
    receivedLastWeek: boolean;
  }> = [];
  for (const doc of djSnap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    if (EXCLUDE_EMAILS.has(data.email)) continue;
    if (!data.emailNotifications?.djInsiders) continue;
    djRows.push({
      email: data.email,
      firstName: resolveFirstName(data.email, data.name, data.chatUsername),
      cohort: "dj",
      receivedLastWeek: WEEK3_EMAILS.has(data.email),
    });
  }
  for (const p of EXTRA_PENDING_DJS) {
    if (EXCLUDE_EMAILS.has(p.email)) continue;
    if (djRows.some((r) => r.email === p.email)) continue;
    djRows.push({
      email: p.email,
      firstName: p.name,
      cohort: "dj",
      receivedLastWeek: WEEK3_EMAILS.has(p.email),
    });
  }

  const djEmails = new Set(djRows.map((r) => r.email));

  // Listener cohort = users who are NOT dj/broadcaster/admin and have an email
  const allSnap = await db.collection("users").get();
  const seen = new Set<string>();
  const listenerRows: Array<{
    email: string;
    firstName: string;
    cohort: "listener";
    receivedLastWeek: boolean;
    role?: string;
  }> = [];
  for (const doc of allSnap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    const email = data.email as string;
    if (EXCLUDE_EMAILS.has(email)) continue;
    if (djEmails.has(email)) continue;
    if (data.role === "dj" || data.role === "broadcaster" || data.role === "admin") continue;
    if (seen.has(email)) continue;
    seen.add(email);
    listenerRows.push({
      email,
      firstName: resolveFirstName(email, data.name, data.chatUsername),
      cohort: "listener",
      receivedLastWeek: false,
      role: data.role,
    });
  }

  // Radio-notify waitlist signups without a users doc
  for (const extra of EXTRA_LISTENERS) {
    if (EXCLUDE_EMAILS.has(extra.email)) continue;
    if (djEmails.has(extra.email)) continue;
    if (listenerRows.some((r) => r.email === extra.email)) continue;
    listenerRows.push({
      email: extra.email,
      firstName: extra.name,
      cohort: "listener",
      receivedLastWeek: false,
    });
  }

  // Sort for readability
  djRows.sort((a, b) => a.email.localeCompare(b.email));
  listenerRows.sort((a, b) => a.email.localeCompare(b.email));

  const all = [...djRows, ...listenerRows];
  const unresolved = all.filter((r) => r.firstName === "there").map((r) => r.email);

  const summary = {
    djCount: djRows.length,
    listenerCount: listenerRows.length,
    totalCount: all.length,
    unresolvedGreetingCount: unresolved.length,
    unresolvedGreetings: unresolved,
    djNewSinceLastWeek: djRows.filter((r) => !r.receivedLastWeek).map((r) => r.email),
    djMissingSinceLastWeek: Array.from(WEEK3_EMAILS).filter((e) => !djEmails.has(e)),
  };

  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log();
  console.log("=== DJ COHORT ===");
  console.table(djRows);
  console.log();
  console.log("=== LISTENER COHORT ===");
  console.table(listenerRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
