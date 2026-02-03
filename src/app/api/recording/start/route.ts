import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { STATION_ID } from '@/types/broadcast';

// Default recording quota: 2 hours per month
const DEFAULT_MAX_SECONDS = 2 * 60 * 60; // 7200 seconds

// Generate a unique broadcast token
function generateToken(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  let binary = '';
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return Buffer.from(binary, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Get current month key (e.g., "2026-02")
function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, showName, broadcastType } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    if (!showName || !showName.trim()) {
      return NextResponse.json({ error: 'Show name required' }, { status: 400 });
    }

    // Validate broadcastType for recording context
    if (broadcastType && broadcastType !== 'venue' && broadcastType !== 'remote') {
      return NextResponse.json({ error: 'Invalid broadcast type' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get user document to check quota
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

    // Check if user has quota remaining
    const remainingSeconds = recordingQuota.maxSeconds - recordingQuota.usedSeconds;
    if (remainingSeconds <= 0) {
      return NextResponse.json({
        error: 'Recording quota exceeded',
        quota: {
          usedSeconds: recordingQuota.usedSeconds,
          maxSeconds: recordingQuota.maxSeconds,
          remainingSeconds: 0,
        },
      }, { status: 403 });
    }

    // Generate unique room name for this recording session
    const roomName = `recording-${userId}-${Date.now()}`;
    const broadcastToken = generateToken();
    const now = Timestamp.now();

    // For recordings, start/end times are more flexible
    // Set end time to 3 hours from now (can be extended or stopped early)
    const startTime = now;
    const endTime = Timestamp.fromMillis(now.toMillis() + 3 * 60 * 60 * 1000);
    const tokenExpiresAt = Timestamp.fromMillis(endTime.toMillis() + 60 * 60 * 1000);

    // Get DJ profile info
    const djProfile = userData?.djProfile || {};
    const chatUsername = userData?.chatUsername;

    // Create the broadcast slot for the recording
    const slotData: Record<string, unknown> = {
      stationId: STATION_ID,
      showName: showName.trim(),
      djUserId: userId,
      djEmail: userData?.email,
      djUsername: chatUsername,
      startTime,
      endTime,
      broadcastToken,
      tokenExpiresAt,
      createdAt: now,
      createdBy: userId,
      status: 'scheduled',
      broadcastType: 'recording',  // Mark as recording type
      roomName,  // Custom room name for recordings
      isPublic: false,  // Recordings are private until published
      // Live DJ info from profile
      liveDjUserId: userId,
      liveDjUsername: chatUsername,
      liveDjBio: djProfile.bio || null,
      liveDjPhotoUrl: djProfile.photoUrl || null,
      liveDjPromoText: djProfile.promoText || null,
      liveDjPromoHyperlink: djProfile.promoHyperlink || null,
    };

    // Create the slot
    const slotRef = await db.collection('broadcast-slots').add(slotData);
    const slotId = slotRef.id;

    // Update user's quota to track this recording session
    // We'll update usedSeconds when the recording completes (in webhook)
    await db.collection('users').doc(userId).update({
      recordingQuota: {
        ...recordingQuota,
        monthKey: currentMonthKey,
      },
    });

    return NextResponse.json({
      success: true,
      slotId,
      broadcastToken,
      roomName,
      quota: {
        usedSeconds: recordingQuota.usedSeconds,
        maxSeconds: recordingQuota.maxSeconds,
        remainingSeconds,
      },
    });

  } catch (error) {
    console.error('Recording start error:', error);
    const message = error instanceof Error ? error.message : 'Failed to start recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: Check current quota
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();
    const currentMonthKey = getCurrentMonthKey();

    let recordingQuota = userData?.recordingQuota || {
      monthKey: currentMonthKey,
      usedSeconds: 0,
      maxSeconds: DEFAULT_MAX_SECONDS,
    };

    // Reset if new month
    if (recordingQuota.monthKey !== currentMonthKey) {
      recordingQuota = {
        monthKey: currentMonthKey,
        usedSeconds: 0,
        maxSeconds: recordingQuota.maxSeconds || DEFAULT_MAX_SECONDS,
      };
    }

    const remainingSeconds = Math.max(0, recordingQuota.maxSeconds - recordingQuota.usedSeconds);

    return NextResponse.json({
      quota: {
        monthKey: recordingQuota.monthKey,
        usedSeconds: recordingQuota.usedSeconds,
        maxSeconds: recordingQuota.maxSeconds,
        remainingSeconds,
        canRecord: remainingSeconds > 0,
      },
    });

  } catch (error) {
    console.error('Quota check error:', error);
    const message = error instanceof Error ? error.message : 'Failed to check quota';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
