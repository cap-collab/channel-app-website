/**
 * Toggle `disabledForLoops` on one interstitial. Retiring it keeps the doc +
 * R2 file (so already-built loops still resolve the URL) but excludes it from
 * FUTURE loop generation (server filters on this flag at pool-load time).
 *
 *   npx tsx -r tsconfig-paths/register scripts/set-interstitial-disabled.ts \
 *     --id <docId> [--enable] [--execute]
 *
 * Default action disables; --enable re-enables. Targeted field merge only —
 * never writes the whole doc back.
 */
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

const EXECUTE = process.argv.includes('--execute');
const ENABLE = process.argv.includes('--enable');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

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
  const id = arg('id');
  if (!id) {
    console.error('Usage: --id <docId> [--enable] [--execute]');
    process.exit(1);
  }
  const disabledForLoops = !ENABLE;
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Doc id: ${id} -> disabledForLoops: ${disabledForLoops}`);

  initAdmin();
  const db = getFirestore();
  const ref = db.collection(INTERSTITIALS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Doc ${id} not found.`);
    process.exit(1);
  }
  const d = snap.data() ?? {};
  console.log(`Label: ${d.label ?? '(none)'} | current disabledForLoops: ${d.disabledForLoops ?? false}`);

  if (!EXECUTE) {
    console.log('Dry run -- re-run with --execute to apply.');
    return;
  }
  await ref.set({ disabledForLoops }, { merge: true });
  console.log(`Updated ${id}: disabledForLoops = ${disabledForLoops}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
