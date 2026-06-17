import {
  S3Client,
  CopyObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  _Object,
} from '@aws-sdk/client-s3';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * R2 ORIGINAL-RECORDING BACKUP — COPY-ONLY.
 *
 * ⚠️ This module NEVER deletes or destructively overwrites anything. It only
 * issues CopyObject (server-side R2→R2). A backup that can delete is not a
 * backup. There is intentionally no DeleteObject / DeleteObjects anywhere here.
 *
 * What it backs up: ONLY the *original* recording for each archive — the file as
 * it existed BEFORE the normalize/trim worker processed it. That is, per archive:
 *   1. uploadFilePath            — a DJ upload (the raw uploaded file), else
 *   2. previousRecordingUrl      — the live-egress original the normalize
 *                                  pipeline stashed before replacing recordingUrl, else
 *   3. recordingUrl              — only when no processing has happened yet
 *                                  (still the original).
 * Derivatives (normalized / trimmed / v2 / youtube-renders / hls) are NOT backed up.
 *
 * Incremental: an object already present in the backup bucket with the same size
 * is skipped — so each run copies only newly-produced originals.
 */

export interface R2Config {
  accountId: string;
  accessKey: string;
  secretKey: string;
  sourceBucket: string;
  backupBucket: string;
  publicUrl: string;
}

export function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.replace(/\\n/g, '').trim() || '';
  const accessKey = process.env.R2_ACCESS_KEY_ID?.replace(/\\n/g, '').trim() || '';
  const secretKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/\\n/g, '').trim() || '';
  const sourceBucket = process.env.R2_BUCKET_NAME?.replace(/\\n/g, '').trim() || '';
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\\n/g, '').trim() || '';
  // Backup bucket name is fixed; overridable via env if ever needed.
  const backupBucket = process.env.R2_BACKUP_BUCKET_NAME?.replace(/\\n/g, '').trim() || 'channel-broadcast-backup';
  if (!accountId || !accessKey || !secretKey || !sourceBucket || !publicUrl) return null;
  return { accountId, accessKey, secretKey, sourceBucket, backupBucket, publicUrl };
}

export function makeS3(cfg: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

function keyFromUrl(url: string, publicBase: string): string | null {
  if (!url) return null;
  const base = publicBase.replace(/\/$/, '');
  if (url.startsWith(base + '/')) return url.slice(base.length + 1);
  const m = url.match(/^https?:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

/** Resolve the set of ORIGINAL recording keys across all archives. */
export async function resolveOriginalKeys(publicUrl: string): Promise<Map<string, string>> {
  const db = getAdminDb();
  if (!db) throw new Error('Database not configured');
  // key -> archiveId (for logging/traceability)
  const keys = new Map<string, string>();
  const snap = await db.collection('archives').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    let key: string | null = null;
    if (d.uploadFilePath) {
      key = String(d.uploadFilePath);
    } else if (d.previousRecordingUrl) {
      key = keyFromUrl(String(d.previousRecordingUrl), publicUrl);
    } else if (d.recordingUrl) {
      // Only an original if nothing has processed it yet (no previous/untrimmed set).
      if (!d.previousRecordingUrl && !d.untrimmedRecordingUrl) {
        key = keyFromUrl(String(d.recordingUrl), publicUrl);
      }
    }
    if (key) keys.set(key, doc.id);
  }
  return keys;
}

async function listBackupSizes(s3: S3Client, backupBucket: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let token: string | undefined;
  do {
    const out: { Contents?: _Object[]; IsTruncated?: boolean; NextContinuationToken?: string } =
      await s3.send(new ListObjectsV2Command({ Bucket: backupBucket, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of out.Contents || []) if (o.Key) sizes.set(o.Key, o.Size || 0);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return sizes;
}

export interface BackupResult {
  totalOriginals: number;
  copied: string[];
  skippedExisting: number;
  missingFromSource: string[];
  errors: { key: string; error: string }[];
  dryRun: boolean;
}

/**
 * Copy every original recording that isn't already in the backup bucket.
 * COPY-ONLY: issues CopyObject only. Never deletes. Skips objects already
 * present with a matching size (incremental).
 */
export async function backupOriginals(opts: { dryRun: boolean }): Promise<BackupResult> {
  const cfg = readR2Config();
  if (!cfg) throw new Error('R2 not configured');
  const s3 = makeS3(cfg);

  const originals = await resolveOriginalKeys(cfg.publicUrl);
  const backupSizes = await listBackupSizes(s3, cfg.backupBucket);

  const result: BackupResult = {
    totalOriginals: originals.size,
    copied: [],
    skippedExisting: 0,
    missingFromSource: [],
    errors: [],
    dryRun: opts.dryRun,
  };

  for (const key of Array.from(originals.keys())) {
    // Already backed up? (present + non-zero, size-matched against source head)
    const existingSize = backupSizes.get(key);
    // Confirm the source object exists and get its size.
    let srcSize: number | undefined;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: cfg.sourceBucket, Key: key }));
      srcSize = head.ContentLength;
    } catch {
      // Original is referenced by Firestore but missing in source R2 — report, never act.
      result.missingFromSource.push(key);
      continue;
    }
    if (existingSize !== undefined && existingSize === srcSize) {
      result.skippedExisting++;
      continue;
    }

    if (opts.dryRun) {
      result.copied.push(key);
      continue;
    }
    try {
      // Server-side copy, source bucket -> backup bucket. No data flows through
      // this process; Cloudflare performs the copy internally. COPY ONLY.
      await s3.send(new CopyObjectCommand({
        Bucket: cfg.backupBucket,
        Key: key,
        CopySource: `${cfg.sourceBucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
      }));
      result.copied.push(key);
    } catch (e) {
      result.errors.push({ key, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
