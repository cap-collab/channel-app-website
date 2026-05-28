/**
 * Delete a single interstitial: removes the Firestore doc and (optionally)
 * the R2 object it points at.
 *
 * Loads .env.prod -- targets prod R2 + prod Firestore.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register scripts/delete-interstitial.ts \
 *     --id <docId> [--keep-r2] [--execute]
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
process.env.R2_PUBLIC_URL = 'https://media.channel-app.com';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { INTERSTITIALS_COLLECTION } from '../src/lib/archive-schedule';

const EXECUTE = process.argv.includes('--execute');
const KEEP_R2 = process.argv.includes('--keep-r2');

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
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

function buildR2(): { client: S3Client; bucket: string; publicUrl: string } {
  const norm = (s: string | undefined) => (s ?? '').replace(/\\n/g, '').trim();
  const accountId = norm(process.env.R2_ACCOUNT_ID);
  const accessKey = norm(process.env.R2_ACCESS_KEY_ID);
  const secretKey = norm(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = norm(process.env.R2_BUCKET_NAME);
  const publicUrl = norm(process.env.R2_PUBLIC_URL).replace(/\/$/, '');
  if (!accountId || !accessKey || !secretKey || !bucket || !publicUrl) {
    throw new Error('R2 env vars missing -- check .env.prod');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  return { client, bucket, publicUrl };
}

async function main() {
  const id = arg('id');
  if (!id) {
    console.error('Usage: delete-interstitial.ts --id <docId> [--keep-r2] [--execute]');
    process.exit(1);
  }

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
  console.log(`Doc id: ${id}`);

  initAdmin();
  const db = getFirestore();
  const ref = db.collection(INTERSTITIALS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Doc ${id} not found in ${INTERSTITIALS_COLLECTION}.`);
    process.exit(1);
  }
  const data = snap.data() ?? {};
  console.log('Will delete Firestore doc with data:');
  console.log(JSON.stringify(data, null, 2));

  const url = String(data.url ?? '');
  const { client, bucket, publicUrl } = buildR2();
  let r2Key: string | null = null;
  if (!KEEP_R2 && url.startsWith(publicUrl + '/')) {
    r2Key = url.slice(publicUrl.length + 1);
    console.log(`Will also delete R2 object: ${bucket}/${r2Key}`);
  } else if (KEEP_R2) {
    console.log('R2 object will be kept (--keep-r2).');
  } else {
    console.log(`R2 URL ${url} doesn't start with ${publicUrl}/, skipping R2 delete.`);
  }

  if (!EXECUTE) {
    console.log('Dry run -- re-run with --execute to apply.');
    return;
  }

  if (r2Key) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: r2Key }));
    console.log(`Deleted R2 object: ${r2Key}`);
  }
  await ref.delete();
  console.log(`Deleted Firestore doc: ${id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
