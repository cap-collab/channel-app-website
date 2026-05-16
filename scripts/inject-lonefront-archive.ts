/**
 * One-off: inject Lonefront's externally-supplied recording as a DJ archive.
 *
 * Loads .env.prod so the upload lands on the prod R2 bucket / prod Firestore.
 *
 * Pipeline:
 *   1. Transcode src/recording/channel-LA-lonefront_ep1_2026may16.wav → MP3 320k 48kHz stereo.
 *   2. PUT to R2 at recordings/upload-{uid}-{ts}/upload-{uid}-{ts}.mp3
 *   3. Create Firestore archives doc (mirrors /api/recording/upload schema, uploadStatus='ready').
 *   4. Fire RESTREAM_WORKER /normalize with callback to /api/recording/normalize-callback.
 *
 * Run:
 *   npx tsx -r tsconfig-paths/register scripts/inject-lonefront-archive.ts
 *   npx tsx -r tsconfig-paths/register scripts/inject-lonefront-archive.ts --execute
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Load .env.prod BEFORE any import that reads process.env at module top-level.
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
    // Strip trailing literal "\n" artifacts from the prod dump.
    v = v.replace(/\\n$/, '').replace(/\n$/, '');
    process.env[m[1]] = v;
  }
}
loadEnvProd();

// .env.prod has a stale R2_PUBLIC_URL (raw r2.dev). Prod archives use the CDN domain.
process.env.R2_PUBLIC_URL = 'https://media.channel-app.com';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EXECUTE = process.argv.includes('--execute');
const STATION_ID = 'channel-main';

const USER_ID = 'JN63hUt3s2MbWyjOZ3N8dLivL3p2';
const CHAT_USERNAME = 'Lonefront';
const EMAIL = 'io@uncoiled.us';
const PHOTO_URL =
  'https://firebasestorage.googleapis.com/v0/b/channel-97386.firebasestorage.app/o/dj-photos%2FJN63hUt3s2MbWyjOZ3N8dLivL3p2%2Fprofile.jpg?alt=media&token=c877bab9-24ce-4313-9188-4ca66d21e155';

const SHOW_NAME = 'Lonefront — Episode 1';
const SRC_WAV = path.resolve('src/recording/channel-LA-lonefront_ep1_2026may16.wav');

function initAdmin() {
  if (getApps().length > 0) return;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey && privateKey.includes('BEGIN PRIVATE KEY')) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    console.log('Firebase admin: cert');
  } else if (projectId) {
    initializeApp({ credential: applicationDefault(), projectId });
    console.log('Firebase admin: ADC');
  } else {
    throw new Error('Firebase admin not configured');
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

function buildR2(): { client: S3Client; bucket: string; publicUrl: string } {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;
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

async function transcode(src: string, dst: string): Promise<void> {
  console.log(`Transcoding → ${dst}`);
  await new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i', src,
      '-vn',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      dst,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    ff.on('error', reject);
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
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

async function uniqueSlug(db: FirebaseFirestore.Firestore, base: string): Promise<string> {
  const snap = await db
    .collection('archives')
    .where('slug', '>=', base)
    .where('slug', '<=', base + '')
    .get();
  if (snap.empty) return base;
  let max = 0;
  for (const d of snap.docs) {
    const s = d.data().slug as string;
    if (s === base) max = Math.max(max, 1);
    else {
      const m = s.match(new RegExp(`^${base}-(\\d+)$`));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return max > 0 ? `${base}-${max + 1}` : base;
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Source: ${SRC_WAV}`);
  if (!fs.existsSync(SRC_WAV)) throw new Error(`Missing source file: ${SRC_WAV}`);

  initAdmin();
  const db = getFirestore();

  const userDoc = await db.collection('users').doc(USER_ID).get();
  if (!userDoc.exists) throw new Error(`User ${USER_ID} not found`);
  console.log(`User: ${userDoc.data()?.chatUsername} (${USER_ID})`);

  const timestamp = Date.now();
  const r2Key = `recordings/upload-${USER_ID}-${timestamp}/upload-${USER_ID}-${timestamp}.mp3`;
  const mp3Path = path.resolve(`/tmp/lonefront-ep1-${timestamp}.mp3`);

  const baseSlug = slugify(SHOW_NAME);
  const slug = await uniqueSlug(db, baseSlug);
  console.log(`Slug: ${slug}`);
  console.log(`R2 key: ${r2Key}`);
  console.log(`R2 bucket: ${process.env.R2_BUCKET_NAME}`);
  console.log(`R2 public: ${process.env.R2_PUBLIC_URL}`);
  console.log(`Project: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);

  if (!EXECUTE) {
    console.log('Dry run — re-run with --execute to proceed.');
    return;
  }

  await transcode(SRC_WAV, mp3Path);
  const duration = Math.ceil(await probeDuration(mp3Path));
  const size = fs.statSync(mp3Path).size;
  console.log(`MP3: ${(size / 1024 / 1024).toFixed(1)} MB, ${duration}s`);

  const { client, bucket, publicUrl } = buildR2();
  console.log(`Uploading to R2 bucket ${bucket}…`);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    Body: fs.createReadStream(mp3Path),
    ContentType: 'audio/mpeg',
    ContentLength: size,
  }));
  console.log('R2 upload OK');

  const recordingUrl = `${publicUrl}/${r2Key}`;
  const archiveData: Record<string, unknown> = {
    slug,
    showName: SHOW_NAME,
    djs: [{
      name: CHAT_USERNAME,
      username: CHAT_USERNAME,
      userId: USER_ID,
      email: EMAIL,
      photoUrl: PHOTO_URL,
    }],
    recordingUrl,
    duration,
    recordedAt: timestamp,
    createdAt: timestamp,
    stationId: STATION_ID,
    isPublic: true,
    sourceType: 'recording',
    publishedAt: timestamp,
    priority: 'low',
    uploadStatus: 'ready',
    uploadFilePath: r2Key,
    uploadedBy: USER_ID,
  };
  const archiveRef = await db.collection('archives').add(archiveData);
  console.log(`Firestore archive created: ${archiveRef.id}`);

  const workerUrl = process.env.RESTREAM_WORKER_URL;
  const cronSecret = process.env.CRON_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (workerUrl && cronSecret && appUrl) {
    try {
      const res = await fetch(`${workerUrl}/normalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cronSecret}`,
        },
        body: JSON.stringify({
          r2Key,
          callbackUrl: `${appUrl}/api/recording/normalize-callback`,
          callbackContext: { archiveId: archiveRef.id },
        }),
      });
      console.log(`Normalize worker: ${res.status}`);
    } catch (e) {
      console.warn('Normalize worker fire failed (non-fatal):', e);
    }
  } else {
    console.warn('Skipping normalize (RESTREAM_WORKER_URL/CRON_SECRET/NEXT_PUBLIC_APP_URL missing in .env.prod)');
  }

  try { fs.unlinkSync(mp3Path); } catch {}
  console.log(`\nDONE. archiveId=${archiveRef.id}  slug=${slug}`);
  console.log(`Public URL: ${recordingUrl}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
