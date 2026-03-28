import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
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
    const { slotId, userId } = await request.json();

    if (!slotId) {
      return NextResponse.json({ error: 'Slot ID required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get the broadcast slot
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Upload session not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();

    // Verify ownership
    if (slotData?.djUserId !== userId && slotData?.createdBy !== userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Verify status is uploading
    if (slotData?.status !== 'uploading') {
      return NextResponse.json({ error: 'Upload session is not in uploading state' }, { status: 400 });
    }

    // Verify file exists in R2
    const uploadFilePath = slotData?.uploadFilePath;
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

    const durationSeconds = slotData?.recordingDuration || 0;
    const remainingSeconds = recordingQuota.maxSeconds - recordingQuota.usedSeconds;

    if (durationSeconds > remainingSeconds) {
      return NextResponse.json({
        error: 'Recording quota exceeded. Another upload may have used your remaining time.',
      }, { status: 403 });
    }

    // Update broadcast slot to ready
    await slotRef.update({
      status: 'completed',
      recordingStatus: 'ready',
      completedAt: Timestamp.now(),
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
      slotId,
      message: 'Pre-recording uploaded successfully',
    });

  } catch (error) {
    console.error('Upload complete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to complete upload';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
