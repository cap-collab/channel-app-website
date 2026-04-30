import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { STATION_ID } from '@/types/broadcast';
import { generatePresignedUploadUrl, getR2PublicUrl } from '@/lib/r2-upload';

// Default recording quota: 122 minutes per month
const DEFAULT_MAX_SECONDS = 122 * 60; // 7320 seconds

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
];

// Map MIME types to file extensions
function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
  };
  return map[mimeType] || 'mp3';
}

// Generate a URL-friendly slug from the show name
function generateSlug(showName: string): string {
  return showName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, showName, duration, fileType, fileSize } = await request.json();

    // Validate inputs
    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    if (!showName || !showName.trim()) {
      return NextResponse.json({ error: 'Please enter a name for your pre-recording.' }, { status: 400 });
    }

    if (!duration || duration <= 0) {
      return NextResponse.json({ error: 'Could not determine audio duration.' }, { status: 400 });
    }

    if (!fileType || !ALLOWED_AUDIO_TYPES.includes(fileType)) {
      return NextResponse.json({
        error: 'Unsupported format. Please upload an MP3, WAV, AAC, M4A, FLAC, or OGG file.',
      }, { status: 400 });
    }

    if (!fileSize || fileSize > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: 'File is too large. Maximum size is 500MB.',
      }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get user document to check quota and DJ profile
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();
    const currentMonthKey = getCurrentMonthKey();

    // Get or initialize recording quota
    let recordingQuota = userData?.recordingQuota || {
      monthKey: currentMonthKey,
      usedSeconds: 0,
      maxSeconds: DEFAULT_MAX_SECONDS,
    };

    // Reset quota if it's a new month
    if (recordingQuota.monthKey !== currentMonthKey) {
      recordingQuota = {
        monthKey: currentMonthKey,
        usedSeconds: 0,
        maxSeconds: recordingQuota.maxSeconds || DEFAULT_MAX_SECONDS,
      };
    }

    // Check if user has enough quota
    const remainingSeconds = recordingQuota.maxSeconds - recordingQuota.usedSeconds;
    const durationSeconds = Math.ceil(duration);

    if (durationSeconds > remainingSeconds) {
      const remainingMinutes = Math.floor(remainingSeconds / 60);
      const durationMinutes = Math.ceil(durationSeconds / 60);
      return NextResponse.json({
        error: `This file is ${durationMinutes} minutes but you only have ${remainingMinutes} minutes remaining this month.`,
        quota: {
          usedSeconds: recordingQuota.usedSeconds,
          maxSeconds: recordingQuota.maxSeconds,
          remainingSeconds: Math.max(0, remainingSeconds),
        },
      }, { status: 403 });
    }

    // Generate R2 key
    const timestamp = Date.now();
    const ext = getExtension(fileType);
    const r2Key = `recordings/upload-${userId}-${timestamp}/upload-${userId}-${timestamp}.${ext}`;

    // Generate presigned URL
    const presignedUrl = await generatePresignedUploadUrl(r2Key, fileType);
    if (!presignedUrl) {
      return NextResponse.json({ error: 'Storage not configured. Please try again later.' }, { status: 500 });
    }

    // Build the public recording URL
    const r2PublicUrl = getR2PublicUrl();
    const recordingUrl = `${r2PublicUrl}/${r2Key}`;

    // Get DJ profile info
    const djProfile = userData?.djProfile || {};
    const chatUsername = userData?.chatUsername;

    // Generate slug for the archive
    const baseSlug = generateSlug(showName.trim());
    const archivesRef = db.collection('archives');

    // Check for existing archives with same slug
    const existingArchives = await archivesRef
      .where('slug', '>=', baseSlug)
      .where('slug', '<=', baseSlug + '\uf8ff')
      .get();

    let slug = baseSlug;
    if (!existingArchives.empty) {
      let maxNumber = 0;
      existingArchives.docs.forEach(doc => {
        const existingSlug = doc.data().slug;
        if (existingSlug === baseSlug) {
          maxNumber = Math.max(maxNumber, 1);
        } else {
          const match = existingSlug.match(new RegExp(`^${baseSlug}-(\\d+)$`));
          if (match) {
            maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
          }
        }
      });
      if (maxNumber > 0) {
        slug = `${baseSlug}-${maxNumber + 1}`;
      }
    }

    // Create the archive document directly (no broadcast-slot needed)
    const archiveData: Record<string, unknown> = {
      slug,
      showName: showName.trim(),
      djs: [{
        name: chatUsername || 'DJ',
        username: chatUsername,
        userId: userId,
        email: userData?.email,
        photoUrl: djProfile.photoUrl || null,
      }],
      recordingUrl,
      duration: durationSeconds,
      recordedAt: timestamp,
      createdAt: timestamp,
      stationId: STATION_ID,
      isPublic: true,
      sourceType: 'recording',
      publishedAt: timestamp,
      priority: 'medium',
      // Upload tracking fields
      uploadStatus: 'uploading',
      uploadFilePath: r2Key,
      uploadedBy: userId,
    };

    const archiveRef = await archivesRef.add(archiveData);
    const archiveId = archiveRef.id;

    return NextResponse.json({
      success: true,
      archiveId,
      presignedUrl,
      quota: {
        usedSeconds: recordingQuota.usedSeconds,
        maxSeconds: recordingQuota.maxSeconds,
        remainingSeconds,
      },
    });

  } catch (error) {
    console.error('Upload initiate error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start upload';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
