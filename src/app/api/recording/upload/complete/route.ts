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

    // Fire-and-forget faststart for MP4 uploads so mobile listeners get progressive
    // playback and working seek. Worker parses moov/mdat atoms and rewrites the
    // object in place with ContentType: video/mp4 — gated to true MP4 containers.
    // Not awaited: the worker can take 30-60s on large files and the DJ shouldn't
    // be blocked on it. Original file stays streamable even if this step fails.
    const restreamWorkerUrl = process.env.RESTREAM_WORKER_URL;
    const cronSecret = process.env.CRON_SECRET;
    const isMp4 = /\.mp4$/i.test(uploadFilePath);
    const isMp3 = /\.mp3$/i.test(uploadFilePath);

    if (isMp4) {
      if (restreamWorkerUrl && cronSecret) {
        fetch(`${restreamWorkerUrl}/faststart`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({ r2Key: uploadFilePath }),
        })
          .then(async (res) => {
            const result = await res.json().catch(() => ({}));
            if (!res.ok) {
              console.error(`[upload/complete] Faststart failed (${res.status}) for ${uploadFilePath}:`, result);
            } else {
              console.log(`[upload/complete] Faststart done for ${uploadFilePath}:`, result);
            }
          })
          .catch((err) => {
            console.error('[upload/complete] Faststart error:', err);
          });
      } else {
        console.warn(`[upload/complete] Faststart skipped: RESTREAM_WORKER_URL=${restreamWorkerUrl ? 'set' : 'missing'}, CRON_SECRET=${cronSecret ? 'set' : 'missing'}`);
      }
    }

    // Kick off loudness normalization for MP3 and MP4 uploads.
    // Worker measures LUFS; if the track is uniformly quiet (broken-capture
    // pattern) it writes a NEW R2 key "...-normalized-v1.<ext>" with gain
    // applied. The original R2 object is NEVER overwritten or deleted.
    //
    // We pass a callbackUrl so the worker reports back to
    // /api/recording/normalize-callback when it finishes (can take 60-180s).
    // That callback does the Firestore swap. A fire-and-forget .then() here
    // isn't reliable on Vercel — the serverless instance can be recycled
    // after the response returns, dropping the handler before the worker
    // responds. The callback pattern mirrors how the live pipeline uses
    // LiveKit webhooks to drive state transitions asynchronously.
    if (isMp3 || isMp4) {
      if (restreamWorkerUrl && cronSecret) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL
          || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
        const callbackUrl = appUrl ? `${appUrl}/api/recording/normalize-callback` : null;
        if (!callbackUrl) {
          console.warn(`[upload/complete] Normalize skipped: no appUrl for callback`);
        } else {
          // When callbackUrl is set, the worker's /normalize endpoint returns
          // 202 immediately and runs the job in the background, then POSTs
          // the result to callbackUrl when done. So this fetch resolves in
          // <1s and doesn't depend on the serverless instance staying alive
          // for the full normalization duration.
          fetch(`${restreamWorkerUrl}/normalize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cronSecret}`,
            },
            body: JSON.stringify({
              r2Key: uploadFilePath,
              callbackUrl,
              callbackContext: { archiveId },
            }),
          })
            .then((res) => {
              if (!res.ok) {
                console.error(`[upload/complete] Normalize kickoff returned ${res.status} for ${uploadFilePath}`);
              } else {
                console.log(`[upload/complete] Normalize kicked off for ${uploadFilePath}; awaiting callback`);
              }
            })
            .catch((err) => {
              console.error('[upload/complete] Normalize kickoff error:', err);
            });
        }
      } else {
        console.warn(`[upload/complete] Normalize skipped: RESTREAM_WORKER_URL=${restreamWorkerUrl ? 'set' : 'missing'}, CRON_SECRET=${cronSecret ? 'set' : 'missing'}`);
      }
    }

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
