// One-off: dump the user doc + any pending-dj-profile for a given email.
// Usage: npx tsx scripts/lookup-user.ts <email>

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
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/lookup-user.ts <email>");
    process.exit(1);
  }

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

  const userSnap = await db.collection("users").where("email", "==", email).get();
  console.log(`=== users (${userSnap.size}) ===`);
  userSnap.forEach((doc) => {
    console.log("id:", doc.id);
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  const pendingSnap = await db
    .collection("pending-dj-profiles")
    .where("email", "==", email)
    .get();
  console.log(`\n=== pending-dj-profiles (${pendingSnap.size}) ===`);
  pendingSnap.forEach((doc) => {
    console.log("id:", doc.id);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
