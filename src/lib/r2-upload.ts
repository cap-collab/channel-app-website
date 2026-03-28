import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2AccountId = process.env.R2_ACCOUNT_ID || '';
const r2AccessKey = process.env.R2_ACCESS_KEY_ID || '';
const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET_NAME || '';
const r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

let r2Client: S3Client | null = null;

export function getR2Client(): S3Client | null {
  if (!r2AccessKey || !r2SecretKey || !r2AccountId) {
    return null;
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: r2Endpoint,
      credentials: {
        accessKeyId: r2AccessKey,
        secretAccessKey: r2SecretKey,
      },
      forcePathStyle: true,
    });
  }
  return r2Client;
}

export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 900 // 15 minutes
): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;

  const command = new PutObjectCommand({
    Bucket: r2Bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export async function checkFileExists(key: string): Promise<boolean> {
  const client = getR2Client();
  if (!client) return false;

  try {
    await client.send(new HeadObjectCommand({
      Bucket: r2Bucket,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

export function getR2PublicUrl(): string {
  return process.env.R2_PUBLIC_URL || '';
}
