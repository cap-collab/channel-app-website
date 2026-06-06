import { NextRequest, NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { getAdminDb } from '@/lib/firebase-admin';

// Daily R2 inventory pass. Lists every object, classifies against
// archives + interstitials Firestore collections, writes summary stats
// to `system/r2-stats` for the Tech Health admin tab. Read-only on R2.
//
// Orphan = an audio file in R2 that no Firestore doc references. Most
// commonly old normalized-v1 files left behind by the 2026-06-01 pipeline
// rewrite, plus short test recordings that never produced an archive doc.

const AUDIO_EXTS = ['.mp4', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];
const TEST_ACCOUNTS = ['channelbroadcast', 'capba'];

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

function keyFromUrl(url: string, publicBase: string): string | null {
  if (!url) return null;
  const base = publicBase.replace(/\/$/, '');
  if (url.startsWith(base + '/')) return url.slice(base.length + 1);
  const m = url.match(/^https?:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}
function isAudioKey(key: string): boolean {
  const lower = key.toLowerCase();
  return AUDIO_EXTS.some((ext) => lower.endsWith(ext));
}
function isHlsArtifact(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.endsWith('.ts') || lower.endsWith('.m3u8') || lower.includes('/segments/');
}
function isTestAccount(key: string): boolean {
  const lower = key.toLowerCase();
  return TEST_ACCOUNTS.some((a) => lower.includes(a));
}

async function listAllObjects(s3: S3Client, bucket: string): Promise<_Object[]> {
  const all: _Object[] = [];
  let token: string | undefined;
  do {
    const out: { Contents?: _Object[]; IsTruncated?: boolean; NextContinuationToken?: string } =
      await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
    if (out.Contents) all.push(...out.Contents);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return all;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accountId = process.env.R2_ACCOUNT_ID?.replace(/\\n/g, '').trim() || '';
  const accessKey = process.env.R2_ACCESS_KEY_ID?.replace(/\\n/g, '').trim() || '';
  const secretKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/\\n/g, '').trim() || '';
  const bucket = process.env.R2_BUCKET_NAME?.replace(/\\n/g, '').trim() || '';
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\\n/g, '').trim() || '';
  if (!accountId || !accessKey || !secretKey || !bucket || !publicUrl) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  // Build the reference set: every key that Firestore points at via any
  // of the recording-URL fields, across archives + interstitials.
  const referenced = new Set<string>();
  const archSnap = await db.collection('archives').get();
  for (const doc of archSnap.docs) {
    const d = doc.data();
    for (const field of ['recordingUrl', 'previousRecordingUrl', 'untrimmedRecordingUrl']) {
      const k = keyFromUrl(String(d[field] || ''), publicUrl);
      if (k) referenced.add(k);
    }
  }
  const interSnap = await db.collection('interstitials').get();
  for (const doc of interSnap.docs) {
    const d = doc.data();
    for (const field of ['recordingUrl', 'url']) {
      const k = keyFromUrl(String(d[field] || ''), publicUrl);
      if (k) referenced.add(k);
    }
  }

  const objects = await listAllObjects(s3, bucket);

  let referencedCount = 0;
  let referencedBytes = 0;
  let hlsCount = 0;
  let hlsBytes = 0;
  let testCount = 0;
  let testBytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;

  for (const obj of objects) {
    const key = obj.Key!;
    const size = obj.Size || 0;
    if (isHlsArtifact(key)) { hlsCount++; hlsBytes += size; continue; }
    if (referenced.has(key)) { referencedCount++; referencedBytes += size; continue; }
    if (isTestAccount(key)) { testCount++; testBytes += size; continue; }
    if (!isAudioKey(key)) continue;
    orphanCount++; orphanBytes += size;
  }

  const stats = {
    generatedAt: Date.now(),
    totalObjects: objects.length,
    referenced: { count: referencedCount, bytes: referencedBytes },
    hls: { count: hlsCount, bytes: hlsBytes },
    test: { count: testCount, bytes: testBytes },
    orphan: { count: orphanCount, bytes: orphanBytes },
  };

  await db.collection('system').doc('r2-stats').set(stats);

  return NextResponse.json({ ok: true, stats });
}
