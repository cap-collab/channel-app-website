import fs from 'node:fs';
import path from 'node:path';

function loadEnvProd() {
  const file = path.resolve('.env.prod');
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    v = v.replace(/\\n$/, '').replace(/\n$/, '');
    process.env[m[1]] = v;
  }
}
loadEnvProd();

import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { INTERSTITIALS_COLLECTION } from '../src/lib/archive-schedule';

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } else {
    initializeApp({ credential: applicationDefault(), projectId });
  }
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const snap = await db.collection(INTERSTITIALS_COLLECTION).get();
  console.log(`${snap.size} interstitials in ${INTERSTITIALS_COLLECTION}:\n`);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(`${doc.id}  |  ${d.label ?? '(no label)'}  |  ${d.durationSec}s`);
    console.log(`    ${d.url}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
