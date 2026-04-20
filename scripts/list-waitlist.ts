// One-off: list radio-notify-waitlist entries and flag which are already
// in the users collection (DJ or listener).
// Usage: npx tsx scripts/list-waitlist.ts

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

  // Build set of emails already in users collection
  const usersSnap = await db.collection("users").get();
  const userEmails = new Set<string>();
  for (const doc of usersSnap.docs) {
    const e = doc.data().email;
    if (e) userEmails.add(e.toLowerCase());
  }

  const waitlistSnap = await db.collection("radio-notify-waitlist").get();
  const rows: Array<{
    email: string;
    city?: string;
    unsubscribed?: boolean;
    inUsers: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const doc of waitlistSnap.docs) {
    const data = doc.data();
    const email = (data.email || "").toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({
      email,
      city: data.city,
      unsubscribed: data.unsubscribed === true,
      inUsers: userEmails.has(email),
    });
  }
  rows.sort((a, b) => a.email.localeCompare(b.email));

  console.log(`Total waitlist docs: ${waitlistSnap.size}`);
  console.log(`Unique emails: ${rows.length}`);
  console.log(`Unsubscribed: ${rows.filter((r) => r.unsubscribed).length}`);
  console.log(`Already in users collection: ${rows.filter((r) => r.inUsers).length}`);
  console.log(`Waitlist-only (not in users): ${rows.filter((r) => !r.inUsers).length}`);
  console.log();
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
