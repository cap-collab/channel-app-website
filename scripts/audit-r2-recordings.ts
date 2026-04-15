/**
 * R2 recordings audit (dry-run, read-only).
 *
 * Lists every object in the R2 bucket, cross-references against the Firestore
 * `archives` collection (recordingUrl + previousRecordingUrl), and classifies
 * each object as:
 *   - KEEP_CURRENT      : referenced by archives.recordingUrl (the live one)
 *   - KEEP_PREVIOUS     : referenced by archives.previousRecordingUrl (original kept for rollback)
 *   - SUPERSEDED_ORIG   : original whose archive now points to a normalized version
 *                         (candidate for deletion once you're confident rollback isn't needed)
 *   - TEST_ACCOUNT      : path contains a test account username (channelbroadcast/capba)
 *   - ORPHAN            : not referenced by any archive doc
 *   - HLS_SEGMENT       : .ts / .m3u8 / segment json (live-stream artifacts, not archives)
 *
 * Writes a CSV + summary to /tmp/r2-audit-<timestamp>/.
 *
 * Run:  npx tsx -r tsconfig-paths/register scripts/audit-r2-recordings.ts
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { S3Client, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { writeFileSync, mkdirSync } from 'fs';
import { getAdminDb } from '../src/lib/firebase-admin';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!.replace(/\\n/g, '').trim();
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID!.replace(/\\n/g, '').trim();
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY!.replace(/\\n/g, '').trim();
const R2_BUCKET = process.env.R2_BUCKET_NAME!.replace(/\\n/g, '').trim();
const R2_PUBLIC = process.env.R2_PUBLIC_URL!.replace(/\\n/g, '').trim().replace(/\/$/, '');

const TEST_ACCOUNTS = ['channelbroadcast', 'capba'];
const AUDIO_EXTS = ['.mp4', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];

type Classification =
  | 'KEEP_CURRENT'
  | 'KEEP_PREVIOUS'
  | 'SUPERSEDED_ORIG'
  | 'TEST_ACCOUNT'
  | 'ORPHAN'
  | 'HLS_SEGMENT';

interface Row {
  key: string;
  size: number;
  lastModified: string;
  classification: Classification;
  archiveId?: string;
  archiveTitle?: string;
  djUsername?: string;
  isPublic?: boolean;
  note?: string;
}

function keyFromUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith(R2_PUBLIC + '/')) return url.slice(R2_PUBLIC.length + 1);
  // tolerate other media hosts
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

function matchesTestAccount(key: string): string | null {
  const lower = key.toLowerCase();
  for (const acct of TEST_ACCOUNTS) {
    if (lower.includes(acct.toLowerCase())) return acct;
  }
  return null;
}

async function listAllObjects(s3: S3Client): Promise<_Object[]> {
  const all: _Object[] = [];
  let ContinuationToken: string | undefined = undefined;
  let page = 0;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken, MaxKeys: 1000 })
    );
    if (out.Contents) all.push(...out.Contents);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
    page++;
    process.stderr.write(`  page ${page}: ${all.length} objects so far\n`);
  } while (ContinuationToken);
  return all;
}

interface ArchiveRef {
  id: string;
  title: string;
  djUsername: string;
  isPublic: boolean;
  currentKey: string | null;
  previousKey: string | null;
}

async function loadArchiveRefs(): Promise<ArchiveRef[]> {
  const db = getAdminDb();
  const snap = await db.collection('archives').get();
  const refs: ArchiveRef[] = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    refs.push({
      id: doc.id,
      title: d.title || d.showName || '',
      djUsername: d.djUsername || d.username || d.stationId || '',
      isPublic: !!d.isPublic,
      currentKey: keyFromUrl(d.recordingUrl || ''),
      previousKey: keyFromUrl(d.previousRecordingUrl || ''),
    });
  }
  return refs;
}

async function main() {
  const outDir = `/tmp/r2-audit-${Date.now()}`;
  mkdirSync(outDir, { recursive: true });
  console.log(`Output dir: ${outDir}`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });

  console.log('Listing R2 objects…');
  const objects = await listAllObjects(s3);
  console.log(`Total R2 objects: ${objects.length}`);

  console.log('Loading Firestore archives…');
  const archives = await loadArchiveRefs();
  console.log(`Total archives: ${archives.length}`);

  const currentIndex = new Map<string, ArchiveRef>();
  const previousIndex = new Map<string, ArchiveRef>();
  for (const a of archives) {
    if (a.currentKey) currentIndex.set(a.currentKey, a);
    if (a.previousKey) previousIndex.set(a.previousKey, a);
  }

  const rows: Row[] = [];
  for (const obj of objects) {
    const key = obj.Key!;
    const size = obj.Size || 0;
    const lastModified = obj.LastModified?.toISOString() || '';

    const row: Row = { key, size, lastModified, classification: 'ORPHAN' };

    if (isHlsArtifact(key)) {
      row.classification = 'HLS_SEGMENT';
      rows.push(row);
      continue;
    }

    const curRef = currentIndex.get(key);
    if (curRef) {
      row.classification = 'KEEP_CURRENT';
      row.archiveId = curRef.id;
      row.archiveTitle = curRef.title;
      row.djUsername = curRef.djUsername;
      row.isPublic = curRef.isPublic;
      rows.push(row);
      continue;
    }

    const prevRef = previousIndex.get(key);
    if (prevRef) {
      row.classification = prevRef.currentKey === key ? 'KEEP_PREVIOUS' : 'SUPERSEDED_ORIG';
      row.archiveId = prevRef.id;
      row.archiveTitle = prevRef.title;
      row.djUsername = prevRef.djUsername;
      row.isPublic = prevRef.isPublic;
      row.note = `current now: ${prevRef.currentKey}`;
      rows.push(row);
      continue;
    }

    const acct = matchesTestAccount(key);
    if (acct) {
      row.classification = 'TEST_ACCOUNT';
      row.note = `test account: ${acct}`;
      rows.push(row);
      continue;
    }

    rows.push(row);
  }

  // CSV
  const csvHeader = 'classification,key,size_mb,last_modified,archive_id,dj,is_public,title,note\n';
  const csvLines = rows.map((r) =>
    [
      r.classification,
      r.key,
      (r.size / 1024 / 1024).toFixed(2),
      r.lastModified,
      r.archiveId || '',
      r.djUsername || '',
      r.isPublic === undefined ? '' : r.isPublic ? 'true' : 'false',
      (r.archiveTitle || '').replace(/[",\n]/g, ' '),
      (r.note || '').replace(/[",\n]/g, ' '),
    ]
      .map((v) => `"${v}"`)
      .join(',')
  );
  writeFileSync(`${outDir}/audit.csv`, csvHeader + csvLines.join('\n'));

  // Summary
  const byClass = new Map<Classification, { count: number; bytes: number }>();
  for (const r of rows) {
    const cur = byClass.get(r.classification) || { count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += r.size;
    byClass.set(r.classification, cur);
  }

  const summary: string[] = [];
  summary.push(`R2 Audit — ${new Date().toISOString()}`);
  summary.push(`Bucket: ${R2_BUCKET}`);
  summary.push(`Total objects: ${objects.length}`);
  summary.push(`Total archives in Firestore: ${archives.length}`);
  summary.push('');
  summary.push('By classification:');
  for (const cls of [
    'KEEP_CURRENT',
    'KEEP_PREVIOUS',
    'SUPERSEDED_ORIG',
    'TEST_ACCOUNT',
    'HLS_SEGMENT',
    'ORPHAN',
  ] as Classification[]) {
    const s = byClass.get(cls) || { count: 0, bytes: 0 };
    summary.push(`  ${cls.padEnd(18)} ${String(s.count).padStart(5)}  ${(s.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
  }
  summary.push('');
  summary.push('Legend:');
  summary.push('  KEEP_CURRENT    — archives.recordingUrl points here (DO NOT DELETE)');
  summary.push('  KEEP_PREVIOUS   — archives.previousRecordingUrl points here (rollback safety net)');
  summary.push('  SUPERSEDED_ORIG — original, normalized version now serves; delete only if confident');
  summary.push('  TEST_ACCOUNT    — path contains channelbroadcast/capba — likely safe to delete');
  summary.push('  HLS_SEGMENT     — .ts/.m3u8 live-stream fragments (not archives)');
  summary.push('  ORPHAN          — no archive doc references this key');
  summary.push('');
  summary.push('Top 30 ORPHAN objects by size:');
  const orphans = rows
    .filter((r) => r.classification === 'ORPHAN')
    .sort((a, b) => b.size - a.size)
    .slice(0, 30);
  for (const r of orphans) {
    summary.push(`  ${(r.size / 1024 / 1024).toFixed(1).padStart(8)} MB  ${r.lastModified.slice(0, 10)}  ${r.key}`);
  }
  summary.push('');
  summary.push('Top 30 TEST_ACCOUNT objects by size:');
  const tests = rows
    .filter((r) => r.classification === 'TEST_ACCOUNT')
    .sort((a, b) => b.size - a.size)
    .slice(0, 30);
  for (const r of tests) {
    summary.push(`  ${(r.size / 1024 / 1024).toFixed(1).padStart(8)} MB  ${r.lastModified.slice(0, 10)}  ${r.key}`);
  }

  const summaryText = summary.join('\n');
  writeFileSync(`${outDir}/summary.txt`, summaryText);
  console.log('\n' + summaryText);
  console.log(`\nFull CSV: ${outDir}/audit.csv`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
