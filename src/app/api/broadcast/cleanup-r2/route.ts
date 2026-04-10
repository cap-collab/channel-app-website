import { NextRequest, NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { ROOM_NAME } from '@/types/broadcast';

// POST - Delete stale HLS segments (.ts, .m3u8, .json) from the live broadcast
// room so listeners don't hear old audio when a new show starts.
// Does NOT touch MP4 recordings (stored under recordings/ prefix).
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r2AccountId = process.env.R2_ACCOUNT_ID?.replace(/\\n/g, '').trim() || '';
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID?.replace(/\\n/g, '').trim() || '';
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY?.replace(/\\n/g, '').trim() || '';
  const r2Bucket = process.env.R2_BUCKET_NAME?.replace(/\\n/g, '').trim() || '';

  if (!r2AccountId || !r2AccessKey || !r2SecretKey || !r2Bucket) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 500 });
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2SecretKey },
  });

  // Clean both the live room and restream room HLS segments
  const prefixes = [`${ROOM_NAME}/`, `${ROOM_NAME}-restream/`];
  let totalDeleted = 0;

  for (const prefix of prefixes) {
    const allKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await s3.send(new ListObjectsV2Command({
        Bucket: r2Bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuationToken,
      }));
      const keys = (res.Contents || [])
        .map(o => o.Key!)
        .filter(k => k.endsWith('.ts') || k.endsWith('.m3u8') || k.endsWith('.json'));
      allKeys.push(...keys);
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);

    if (allKeys.length > 0) {
      for (let i = 0; i < allKeys.length; i += 1000) {
        const batch = allKeys.slice(i, i + 1000);
        await s3.send(new DeleteObjectsCommand({
          Bucket: r2Bucket, Delete: { Objects: batch.map(Key => ({ Key })) },
        }));
      }
    }
    totalDeleted += allKeys.length;
  }

  return NextResponse.json({
    deleted: totalDeleted,
    message: totalDeleted > 0
      ? `Cleaned ${totalDeleted} stale HLS files from ${prefixes.join(', ')}`
      : 'R2 rooms already clean — no stale HLS files found',
  });
}
