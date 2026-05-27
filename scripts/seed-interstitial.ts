/**
 * Seed an interlude clip into the `interstitials` Firestore collection. The
 * archive-radio loop builder picks randomly from this collection at generation
 * time and interleaves one entry between each pair of consecutive archive shows.
 *
 * Loads .env.prod so the upload lands on the prod R2 bucket / prod Firestore.
 *
 * Two modes:
 *
 * 1) Upload-from-local: hands the script a local audio file. It probes the
 *    duration with ffprobe, uploads to R2 under interludes/, and writes the
 *    Firestore doc using the public URL.
 *
 *      npx tsx -r tsconfig-paths/register scripts/seed-interstitial.ts \
 *        --file "public/interludes/toilet therapist.m4a" \
 *        --label "toilet therapist" \
 *        --execute
 *
 * 2) URL-passthrough: file is already hosted somewhere with CORS allowing the
 *    site origin. Just registers it in Firestore.
 *
 *      npx tsx -r tsconfig-paths/register scripts/seed-interstitial.ts \
 *        --url https://media.channel-app.com/interludes/jingle.mp3 \
 *        --duration 30 \
 *        --label "channel jingle" \
 *        --execute
 *
 * After seeding, force-regenerate the currently playing loop to pick up the
 * new interludes:
 *   curl -X POST https://<host>/api/admin/archive-radio-loop/<N>/regenerate
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Load .env.prod BEFORE any import that reads process.env at module top-level.
// Mirrors inject-lonefront-archive.ts (the proven prod-upload pattern).
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

// .env.prod has a stale R2_PUBLIC_URL (raw r2.dev). Prod archives use the CDN.
process.env.R2_PUBLIC_URL = 'https://media.channel-app.com';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { INTERSTITIALS_COLLECTION } from '../src/lib/archive-schedule';

const EXECUTE = process.argv.includes('--execute');

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
  // Vercel-dumped env values often have literal "\n" sequences mid-string;
  // strip them and trim whitespace. Matches audit-r2-recordings normalization.
  const norm = (s: string | undefined) => (s ?? '').replace(/\\n/g, '').trim();
  const accountId = norm(process.env.R2_ACCOUNT_ID);
  const accessKey = norm(process.env.R2_ACCESS_KEY_ID);
  const secretKey = norm(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = norm(process.env.R2_BUCKET_NAME);
  const publicUrl = norm(process.env.R2_PUBLIC_URL).replace(/\/$/, '');
  if (!accountId || !accessKey || !secretKey || !bucket || !publicUrl) {
    throw new Error('R2 env vars missing — check .env.prod');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  return { client, bucket, publicUrl };
}

async function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    let out = '';
    ff.stdout.on('data', (b) => (out += b.toString()));
    ff.on('error', reject);
    ff.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}`));
      const d = parseFloat(out.trim());
      if (!Number.isFinite(d) || d <= 0) return reject(new Error('bad duration'));
      resolve(d);
    });
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50) || 'interlude';
}

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a':
    case '.aac': return 'audio/mp4';
    case '.ogg': return 'audio/ogg';
    case '.wav': return 'audio/wav';
    default: return 'application/octet-stream';
  }
}

async function uploadToR2(localFile: string, label?: string): Promise<{ url: string; durationSec: number }> {
  if (!fs.existsSync(localFile)) throw new Error(`file not found: ${localFile}`);

  const durationSec = Math.ceil(await probeDuration(localFile));
  const size = fs.statSync(localFile).size;
  const ext = path.extname(localFile);
  const baseSlug = slugify(label ?? path.basename(localFile, ext));
  const r2Key = `interludes/${baseSlug}-${Date.now()}${ext}`;

  console.log(`Local file: ${localFile} (${(size / 1024 / 1024).toFixed(2)} MB, ${durationSec}s)`);
  console.log(`R2 key: ${r2Key}`);
  console.log(`R2 bucket: ${process.env.R2_BUCKET_NAME}`);
  console.log(`R2 public: ${process.env.R2_PUBLIC_URL}`);

  if (!EXECUTE) {
    console.log('Dry run — re-run with --execute to upload.');
    process.exit(0);
  }

  const { client, bucket, publicUrl } = buildR2();
  console.log(`Uploading to R2…`);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    Body: fs.createReadStream(localFile),
    ContentType: contentTypeFor(ext),
    ContentLength: size,
  }));
  const url = `${publicUrl}/${r2Key}`;
  console.log(`Uploaded: ${url}`);
  return { url, durationSec };
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);

  const fileArg = arg('file');
  const urlArg = arg('url');
  const label = arg('label');

  let url: string;
  let durationSec: number;

  if (fileArg) {
    const result = await uploadToR2(fileArg, label);
    url = result.url;
    durationSec = result.durationSec;
  } else if (urlArg) {
    const durationStr = arg('duration');
    if (!durationStr) {
      console.error('--duration required when using --url');
      process.exit(1);
    }
    const d = Number(durationStr);
    if (!Number.isFinite(d) || d <= 0) {
      console.error(`invalid --duration: ${durationStr}`);
      process.exit(1);
    }
    url = urlArg;
    durationSec = Math.ceil(d);
  } else {
    console.error('Usage:');
    console.error('  --file <path> [--label <label>] [--execute]');
    console.error('  --url <url> --duration <sec> [--label <label>] [--execute]');
    process.exit(1);
  }

  initAdmin();
  const db = getFirestore();

  const doc: Record<string, unknown> = {
    url,
    durationSec,
    uploadedAtMs: Date.now(),
  };
  if (label) doc.label = label;

  if (!EXECUTE) {
    console.log('Would write Firestore doc:');
    console.log(JSON.stringify(doc, null, 2));
    console.log(`Collection: ${INTERSTITIALS_COLLECTION}`);
    console.log('Dry run — re-run with --execute to seed.');
    return;
  }

  const ref = await db.collection(INTERSTITIALS_COLLECTION).add(doc);
  console.log(`Seeded interstitial: ${ref.id}`);
  console.log(JSON.stringify(doc, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
