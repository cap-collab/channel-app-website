import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, statSync } from 'fs';

// Load .env.local manually
const envFile = readFileSync('/Users/capucine/channel-app-website/.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) {
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const PROD_URL = 'https://channel-app.com';
const CRON_SECRET = process.env.CRON_SECRET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID.replace(/\\n/g, '').trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID.replace(/\\n/g, '').trim();
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY.replace(/\\n/g, '').trim();
const R2_BUCKET = process.env.R2_BUCKET_NAME.replace(/\\n/g, '').trim();
const R2_PUBLIC = process.env.R2_PUBLIC_URL.replace(/\\n/g, '').trim();

const JOBS = [
  {
    archiveId: 'yz2P0UfOsCJTgbRZ7w68',
    name: 'INHALE',
    local: '/tmp/normalized/inhale.mp4',
    originalUrl: 'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-04-10T190008.mp4',
  },
  {
    archiveId: 'at0fmmTKhjKe8CwFjwNk',
    name: 'Past9',
    local: '/tmp/normalized/past9.mp4',
    originalUrl: 'https://media.channel-app.com/recordings/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775705157048/recording-axpIMUwbOpZ0O3sAzsn6H1bGy6C3-1775705157048-2026-04-09T032600.mp4',
  },
  {
    archiveId: '57yVl45zMDLUnwQZWdB5',
    name: 'Pictures of Infinity',
    local: '/tmp/normalized/pictures_of_infinity.mp4',
    originalUrl: 'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-04-10T210002.mp4',
  },
  {
    archiveId: 'HqUAgD9u3sOR5zNHGlgE',
    name: 'Drift',
    local: '/tmp/normalized/drift.mp4',
    originalUrl: 'https://media.channel-app.com/recordings/channel-radio/channel-radio-2026-04-10T010047.mp4',
  },
];

function originalUrlToNewKey(originalUrl) {
  const u = new URL(originalUrl);
  const origKey = u.pathname.slice(1);
  return origKey.replace(/\.mp4$/, '-normalized-v1.mp4');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function run() {
  console.log(`\n=== Deploying normalized archives ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  for (const job of JOBS) {
    job.newKey = originalUrlToNewKey(job.originalUrl);
    job.newUrl = `${R2_PUBLIC}/${job.newKey}`;
    const localSize = statSync(job.local).size;
    console.log(`[${job.name}]`);
    console.log(`  archive id:  ${job.archiveId}`);
    console.log(`  local file:  ${job.local} (${(localSize / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  new R2 key:  ${job.newKey}`);
    console.log(`  new URL:     ${job.newUrl}\n`);
  }

  if (DRY_RUN) { console.log('DRY RUN — re-run without --dry-run'); return; }

  // 1) Upload to R2
  for (const job of JOBS) {
    if (await objectExists(job.newKey)) {
      console.log(`[${job.name}] already in R2, skipping upload`);
      continue;
    }
    console.log(`[${job.name}] Uploading to R2...`);
    const body = readFileSync(job.local);
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: job.newKey, Body: body, ContentType: 'video/mp4',
    }));
    console.log(`[${job.name}] Uploaded ${(body.length / 1024 / 1024).toFixed(1)} MB.`);
  }

  // 2) Update Firestore via prod API
  for (const job of JOBS) {
    console.log(`[${job.name}] Updating Firestore via ${PROD_URL}...`);
    const res = await fetch(`${PROD_URL}/api/admin/archives/update-recording-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CRON_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ archiveId: job.archiveId, newRecordingUrl: job.newUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[${job.name}] ❌ API error:`, data);
      throw new Error(`Failed to update ${job.archiveId}`);
    }
    console.log(`[${job.name}] ✅ prev: ${data.previousUrl?.slice(-50)}`);
    console.log(`[${job.name}]    new:  ${data.newUrl.slice(-50)}`);
  }

  console.log('\n=== Done. ===');
  console.log('To rollback: set recordingUrl back to previousRecordingUrl field on each doc.');
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
