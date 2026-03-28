import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkFileExists } from '@/lib/r2-upload';

// Default recording quota: 2 hours per month
const DEFAULT_MAX_SECONDS = 2 * 60 * 60; // 7200 seconds

function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function POST(request: NextRequest) {
  try {
    const { archiveId, userId } = await request.json();

    if (!archiveId) {
      return NextResponse.json({ error: 'Archive ID required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get the archive document
    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();

    if (!archiveDoc.exists) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 });
    }

    const archiveData = archiveDoc.data();

    // Verify ownership
    if (archiveData?.uploadedBy !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Verify status is uploading
    if (archiveData?.uploadStatus !== 'uploading') {
      return NextResponse.json({ error: 'Upload session is not in uploading state' }, { status: 400 });
    }

    // Verify file exists in R2
    const uploadFilePath = archiveData?.uploadFilePath;
    if (!uploadFilePath) {
      return NextResponse.json({ error: 'Upload file path not found' }, { status: 500 });
    }

    const fileExists = await checkFileExists(uploadFilePath);
    if (!fileExists) {
      return NextResponse.json({ error: 'Upload could not be verified. Please try again.' }, { status: 400 });
    }

    // Re-check quota to prevent race condition with concurrent uploads
    const currentMonthKey = getCurrentMonthKey();
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();

    let recordingQuota = userData?.recordingQuota || {
      monthKey: currentMonthKey,
      usedSeconds: 0,
      maxSeconds: DEFAULT_MAX_SECONDS,
    };

    if (recordingQuota.monthKey !== currentMonthKey) {
      recordingQuota = {
        monthKey: currentMonthKey,
        usedSeconds: 0,
        maxSeconds: recordingQuota.maxSeconds || DEFAULT_MAX_SECONDS,
      };
    }

    const durationSeconds = archiveData?.duration || 0;
    const remainingSeconds = recordingQuota.maxSeconds - recordingQuota.usedSeconds;

    if (durationSeconds > remainingSeconds) {
      return NextResponse.json({
        error: 'Recording quota exceeded. Another upload may have used your remaining time.',
      }, { status: 403 });
    }

    // Mark archive as ready (upload complete)
    await archiveRef.update({
      uploadStatus: 'ready',
    });

    // Update user's recording quota
    recordingQuota.usedSeconds += durationSeconds;
    await db.collection('users').doc(userId).update({
      recordingQuota: {
        ...recordingQuota,
        monthKey: currentMonthKey,
      },
    });

    return NextResponse.json({
      success: true,
      archiveId,
      message: 'Pre-recording uploaded successfully',
    });

  } catch (error) {
    console.error('Upload complete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete upload';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
