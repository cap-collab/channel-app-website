// YouTube render worker.
// Captures the channel-app /internal/render-mix page in headless Chromium for
// the duration of a mix, then mux's the source mix audio in via ffmpeg to
// produce a YouTube-ready 1920x1080 H.264/AAC mp4 in R2.
//
// Lifecycle mirrors restream-worker/index.js: Express + SHARED_SECRET auth,
// async-by-callback (POST /start returns 202, work happens in the background,
// job state lives in Firestore). Resilience patterns reused: stderr piped to
// console, intentionalStop flag, ffmpeg reconnect flags, initial-connect
// retry with backoff, /tmp cleanup in try/finally, watchdog timeout, /status
// endpoint, on-boot zombie cleanup.
//
// THIS WORKER MUST RUN ON A SEPARATE VPS FROM restream-worker. Live
// broadcasts use restream-worker; resource isolation is the safety net.

import express from 'express';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, statSync, rmdirSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import admin from 'firebase-admin';

const PORT = process.env.PORT || 3101;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.CRON_SECRET || '';
const APP_URL = process.env.APP_URL || 'https://channel-app.com';

// R2
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET_NAME || 'channel-broadcast').trim();
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || 'https://media.channel-app.com').trim().replace(/\/$/, '');
const R2_OUTPUT_PREFIX = 'youtube-renders';

// Hard limits
const MAX_RENDER_SECONDS = 3 * 60 * 60; // 3 hours absolute cap
const RENDER_OVERRUN_FACTOR = 1.5; // watchdog kills if elapsed > durationSec * factor + 5min slack
const RENDER_OVERRUN_SLACK_MS = 5 * 60 * 1000;
const FFMPEG_INITIAL_CONNECT_TIMEOUT_S = 30; // mirrors restream-worker's "short-run = retry" rule
const FFMPEG_MAX_ATTEMPTS = 3;
const FFMPEG_RETRY_DELAYS_MS = [1000, 3000];
const ZOMBIE_CHECK_OLDER_THAN_MS = 4 * 60 * 60 * 1000; // anything still 'rendering' for >4h is dead

// In-memory bookkeeping. Source of truth is always Firestore — this map only
// exists to manage child-process lifecycle for jobs running RIGHT NOW. On
// worker restart we lose this map, which is fine because boot-time zombie
// cleanup re-marks orphaned 'rendering' jobs as 'failed' (see scanZombieJobs).
const activeJobs = new Map(); // jobId -> { browser, ffmpegProcess, watchdogTimer, ffmpegRetryTimer, intentionalStop, tempPaths }

// ─── Firebase Admin init ─────────────────────────────────────────────────
if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.error('[boot] FIREBASE_SERVICE_ACCOUNT_JSON env var is required');
    process.exit(1);
  }
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (err) {
    console.error('[boot] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err.message);
    process.exit(1);
  }
}
const db = admin.firestore();

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const app = express();
app.use(express.json({ limit: '1mb' }));

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!SHARED_SECRET || auth !== `Bearer ${SHARED_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── POST /start ─────────────────────────────────────────────────────────
// Vercel calls this after creating the youtube-render-jobs Firestore doc.
// Body: { jobId }
app.post('/start', authenticate, async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  if (activeJobs.has(jobId)) {
    return res.status(409).json({ error: 'job already running on this worker' });
  }

  // Read the job doc so we can fail-fast on bad input without the caller waiting.
  let job;
  try {
    const snap = await db.collection('youtube-render-jobs').doc(jobId).get();
    if (!snap.exists) return res.status(404).json({ error: 'job not found' });
    job = { id: jobId, ...snap.data() };
  } catch (err) {
    return res.status(500).json({ error: `Failed to load job: ${err.message}` });
  }

  if (job.status === 'rendering' || job.status === 'done') {
    // Already in flight elsewhere or finished. Don't double-run.
    return res.status(409).json({ error: `job already ${job.status}` });
  }
  if (typeof job.durationSec !== 'number' || job.durationSec <= 0) {
    return res.status(400).json({ error: 'job.durationSec missing/invalid' });
  }
  if (job.durationSec > MAX_RENDER_SECONDS) {
    await markFailed(jobId, `duration ${job.durationSec}s exceeds cap ${MAX_RENDER_SECONDS}s`);
    return res.status(400).json({ error: 'duration exceeds cap' });
  }

  // 202 immediately, work happens in background.
  res.status(202).json({ accepted: true, jobId });
  runJob(job).catch((err) => {
    console.error(`[${jobId}] Unhandled runJob error:`, err);
    markFailed(jobId, err?.message || 'unhandled error').catch(() => {});
  });
});

// ─── GET /status ─────────────────────────────────────────────────────────
// Returns a snapshot of in-flight jobs on THIS worker instance.
app.get('/status', (req, res) => {
  const jobs = {};
  for (const [jobId, entry] of activeJobs) {
    jobs[jobId] = {
      browserAlive: !!entry.browser,
      ffmpegRunning: !!(entry.ffmpegProcess && !entry.ffmpegProcess.killed),
      watchdogScheduled: !!entry.watchdogTimer,
      ffmpegAttempts: entry.ffmpegAttempts || 0,
    };
  }
  res.json({ activeJobs: jobs, uptime: process.uptime() });
});

// ─── runJob ──────────────────────────────────────────────────────────────
async function runJob(job) {
  const { id: jobId, durationSec, recordingUrl, archiveSlug, renderData } = job;
  const startedAt = Date.now();

  // Setup tempfiles. webm = Playwright capture; mp4 = final muxed output.
  const dir = join(tmpdir(), `yt-render-${jobId}`);
  mkdirSync(dir, { recursive: true });
  const tempPaths = {
    dir,
    webm: join(dir, 'capture.webm'),
    png: join(dir, 'frame.png'),
    mp4: join(dir, 'output.mp4'),
  };

  const entry = {
    browser: null,
    ffmpegProcess: null,
    watchdogTimer: null,
    ffmpegRetryTimer: null,
    intentionalStop: false,
    tempPaths,
    ffmpegAttempts: 0,
    captureMode: null, // 'static' | 'dynamic' — set by capturePage
  };
  activeJobs.set(jobId, entry);

  try {
    await db.collection('youtube-render-jobs').doc(jobId).update({
      status: 'rendering',
      startedAt,
      progressPct: 0,
    });

    // Watchdog. Hard cap on total runtime. Kills everything and fails the job.
    const watchdogMs = Math.min(
      durationSec * 1000 * RENDER_OVERRUN_FACTOR + RENDER_OVERRUN_SLACK_MS,
      MAX_RENDER_SECONDS * 1000
    );
    entry.watchdogTimer = setTimeout(() => {
      console.error(`[${jobId}] WATCHDOG fired after ${watchdogMs}ms — killing job`);
      teardownJob(jobId, /* intentional */ true);
      markFailed(jobId, `watchdog timeout after ${Math.round(watchdogMs / 1000)}s`).catch(() => {});
    }, watchdogMs);

    // ─── Phase 1: Capture the page in headless Chromium ──────────────────
    console.log(`[${jobId}] Phase 1: capture (${durationSec}s)`);
    await capturePage(jobId, entry, durationSec, renderData);
    if (entry.intentionalStop) return; // watchdog or external stop fired

    // ─── Phase 2: ffmpeg mux capture + recordingUrl audio → mp4 ──────────
    console.log(`[${jobId}] Phase 2: ffmpeg mux (${entry.captureMode})`);
    await db.collection('youtube-render-jobs').doc(jobId).update({ progressPct: 90 });
    await muxFinalMp4(jobId, entry, recordingUrl, durationSec);
    if (entry.intentionalStop) return;

    // ─── Phase 3: upload to R2 ──────────────────────────────────────────
    console.log(`[${jobId}] Phase 3: upload to R2`);
    const filename = buildOutputFilename({ archiveSlug, renderData, recordedAt: job.recordedAt });
    const key = `${R2_OUTPUT_PREFIX}/${filename}`;
    const body = readFileSync(tempPaths.mp4);
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'video/mp4',
        ContentDisposition: `attachment; filename="${filename}"`,
      })
    );
    const outputUrl = `${R2_PUBLIC}/${key}`;

    await db.collection('youtube-render-jobs').doc(jobId).update({
      status: 'done',
      progressPct: 100,
      outputUrl,
      completedAt: Date.now(),
    });
    console.log(`[${jobId}] Done in ${Math.round((Date.now() - startedAt) / 1000)}s → ${outputUrl}`);
  } catch (err) {
    console.error(`[${jobId}] Failed:`, err);
    if (!entry.intentionalStop) {
      await markFailed(jobId, err?.message || 'render failed').catch(() => {});
    }
  } finally {
    teardownJob(jobId, /* intentional */ false);
  }
}

// ─── Phase 1: capture ───────────────────────────────────────────────────
// Decides between two paths based on what the page reports:
//   - static:  no scrolling text → take ONE screenshot, ffmpeg loops it +
//              draws the progress bar. ~seconds, regardless of mix length.
//   - dynamic: bio or names scroll → real-time Chromium video capture for
//              the full duration. ~real-time.
// The page sets body.dataset.needsMotion = "true"|"false" once layout
// settles (see src/app/internal/render-mix/page.tsx). Default = dynamic
// if anything goes wrong with detection.
async function capturePage(jobId, entry, durationSec, renderData) {
  const renderDataJson = JSON.stringify({ ...renderData, durationSec });
  const url = `${APP_URL}/internal/render-mix?data=${encodeURIComponent(renderDataJson)}`;

  // Step 1: launch + load the page once. Decide static vs dynamic. Then
  // either screenshot and bail (static) or restart with video recording on
  // (dynamic). Restarting for dynamic is necessary because Playwright's
  // `recordVideo` is set on context creation; can't toggle it mid-page.
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'], // --no-sandbox needed in containers; --disable-dev-shm-usage works around small /dev/shm in Docker
  });
  entry.browser = browser;

  try {
    let context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    let page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn(`[${jobId}][page-console] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error(`[${jobId}][page-error] ${err.message}`));

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => {
        const img = document.querySelector('img');
        if (!img) return true;
        return img.complete && img.naturalHeight > 0;
      },
      { timeout: 30000 }
    );
    // Settle: lets the page's measurement effect run + set body.dataset.needsMotion.
    await page.waitForTimeout(1200);

    // Read the flag. Default to dynamic on any read failure.
    let needsMotion = true;
    try {
      const value = await page.evaluate(() => document.body.dataset.needsMotion);
      needsMotion = value !== 'false';
    } catch (err) {
      console.warn(`[${jobId}] needsMotion probe failed, defaulting to dynamic:`, err?.message || err);
    }

    if (!needsMotion) {
      // ─── Static path: one screenshot ──────────────────────────────────
      console.log(`[${jobId}] capture path: STATIC (no scrolling text detected)`);
      entry.captureMode = 'static';
      await page.screenshot({ path: entry.tempPaths.png, type: 'png', fullPage: false });
      await page.close();
      await context.close();
      return;
    }

    // ─── Dynamic path: tear down and re-launch with recordVideo on ────
    console.log(`[${jobId}] capture path: DYNAMIC (scrolling detected, recording ${durationSec}s)`);
    entry.captureMode = 'dynamic';
    await page.close();
    await context.close();

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      recordVideo: { dir: entry.tempPaths.dir, size: { width: 1920, height: 1080 } },
    });
    page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn(`[${jobId}][page-console] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error(`[${jobId}][page-error] ${err.message}`));
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => {
        const img = document.querySelector('img');
        if (!img) return true;
        return img.complete && img.naturalHeight > 0;
      },
      { timeout: 30000 }
    );
    await page.waitForTimeout(1000);

    // Hold the page open for durationSec, updating progressPct every 5s.
    const pollIntervalMs = 5000;
    const deadline = Date.now() + durationSec * 1000;
    while (Date.now() < deadline) {
      if (entry.intentionalStop) break;
      const remaining = deadline - Date.now();
      const elapsedFrac = 1 - remaining / (durationSec * 1000);
      const progressPct = Math.min(80, Math.round(elapsedFrac * 80));
      try {
        await db.collection('youtube-render-jobs').doc(jobId).update({ progressPct });
      } catch {
        // non-fatal
      }
      await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(remaining, 100)));
    }

    const video = page.video();
    await page.close();
    await context.close();
    if (video) {
      const recordedPath = await video.path();
      renameSync(recordedPath, entry.tempPaths.webm);
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    entry.browser = null;
  }
}

// ─── Phase 2: ffmpeg mux with initial-connect retry ─────────────────────
function muxFinalMp4(jobId, entry, recordingUrl, durationSec) {
  return new Promise((resolve, reject) => {
    const attemptOnce = () => {
      entry.ffmpegAttempts = (entry.ffmpegAttempts || 0) + 1;
      const attemptStartedAt = Date.now();

      // Args differ between static (loop a PNG + drawbox progress bar) and
      // dynamic (use the recorded webm). Audio side + output side identical.
      let videoInputArgs;
      let videoFilter;
      if (entry.captureMode === 'static') {
        // Loop the still PNG, draw a progress bar that grows linearly with
        // time. Bar = bottom 8px of the 1080 frame, white, fills L→R.
        // The page already has the bar's gray track visible in the PNG;
        // drawbox just adds the white fill on top.
        videoInputArgs = ['-loop', '1', '-r', '30', '-i', entry.tempPaths.png];
        videoFilter = `drawbox=x=0:y=ih-8:w='iw*t/${durationSec}':h=8:color=white:t=fill`;
      } else {
        videoInputArgs = ['-i', entry.tempPaths.webm];
        videoFilter = null;
      }

      const args = [
        '-y',
        // Input 0: video source
        ...videoInputArgs,
        // Input 1: source mix audio (HTTP from R2 — reconnect flags critical)
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_delay_max', '5',
        '-i', recordingUrl,
        '-map', '0:v',
        '-map', '1:a',
        // Video: H.264 @ yuv420p, faststart for progressive YouTube upload
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '20',
        '-r', '30',
        ...(videoFilter ? ['-vf', videoFilter] : []),
        // Audio: AAC 192k, YouTube-target loudness (-14 LUFS)
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11',
        // Static path: -loop 1 means video stream is infinite, so we need
        // to either cap it via -t or rely on -shortest (which uses the
        // shorter of video/audio — and since audio is finite, that
        // truncates correctly). Either way -shortest is safe.
        '-shortest',
        '-movflags', '+faststart',
        '-loglevel', 'warning',
        entry.tempPaths.mp4,
      ];

      const ff = spawn('ffmpeg', args);
      entry.ffmpegProcess = ff;

      let stderrTail = '';
      ff.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        // Keep last ~4KB for the failure message
        stderrTail = (stderrTail + str).slice(-4096);
        // Forward to logs without blowing them up
        for (const line of str.split('\n')) {
          if (line.trim()) console.log(`[${jobId}][ffmpeg] ${line.trim()}`);
        }
      });

      ff.on('error', (err) => {
        console.error(`[${jobId}][ffmpeg] spawn error:`, err);
        reject(err);
      });

      ff.on('close', (code, signal) => {
        entry.ffmpegProcess = null;
        if (entry.intentionalStop) {
          // Caller killed us; don't retry.
          return reject(new Error('intentionally stopped'));
        }
        if (code === 0) {
          return resolve();
        }
        // Failure. Decide: retry or give up?
        const elapsedSec = (Date.now() - attemptStartedAt) / 1000;
        const wasShort = elapsedSec < FFMPEG_INITIAL_CONNECT_TIMEOUT_S;
        const canRetry = wasShort && entry.ffmpegAttempts < FFMPEG_MAX_ATTEMPTS;
        console.error(
          `[${jobId}][ffmpeg] exited code=${code} signal=${signal} attempt=${entry.ffmpegAttempts} elapsed=${elapsedSec.toFixed(1)}s wasShort=${wasShort} canRetry=${canRetry}`
        );
        if (!canRetry) {
          return reject(new Error(`ffmpeg failed (code ${code}): ${stderrTail.slice(-512)}`));
        }
        // Schedule retry with backoff. Track timer so teardown can cancel it.
        const delayMs = FFMPEG_RETRY_DELAYS_MS[entry.ffmpegAttempts - 1] || 3000;
        console.log(`[${jobId}][ffmpeg] Retrying in ${delayMs}ms (attempt ${entry.ffmpegAttempts + 1}/${FFMPEG_MAX_ATTEMPTS})`);
        entry.ffmpegRetryTimer = setTimeout(() => {
          entry.ffmpegRetryTimer = null;
          if (entry.intentionalStop) {
            return reject(new Error('intentionally stopped during retry wait'));
          }
          attemptOnce();
        }, delayMs);
      });
    };
    attemptOnce();
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────
function teardownJob(jobId, intentional) {
  const entry = activeJobs.get(jobId);
  if (!entry) return;
  if (intentional) entry.intentionalStop = true;

  if (entry.watchdogTimer) {
    clearTimeout(entry.watchdogTimer);
    entry.watchdogTimer = null;
  }
  if (entry.ffmpegRetryTimer) {
    clearTimeout(entry.ffmpegRetryTimer);
    entry.ffmpegRetryTimer = null;
  }
  if (entry.ffmpegProcess && !entry.ffmpegProcess.killed) {
    try {
      entry.ffmpegProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  if (entry.browser) {
    entry.browser.close().catch(() => {});
    entry.browser = null;
  }

  // Clean up /tmp files
  const { dir, webm, png, mp4 } = entry.tempPaths;
  for (const p of [webm, png, mp4]) {
    try {
      statSync(p);
      unlinkSync(p);
    } catch {
      // not present, fine
    }
  }
  // Best-effort dir cleanup
  try {
    rmdirSync(dir);
  } catch {
    // not empty / not present — fine
  }

  activeJobs.delete(jobId);
}

async function markFailed(jobId, errorMessage) {
  try {
    await db.collection('youtube-render-jobs').doc(jobId).update({
      status: 'failed',
      error: errorMessage.slice(0, 1000),
      completedAt: Date.now(),
    });
  } catch (err) {
    console.error(`[${jobId}] Failed to write 'failed' status:`, err.message);
  }
}

function buildOutputFilename({ archiveSlug, renderData, recordedAt }) {
  // YouTube-friendly: <show>-<dj>-<YYYY-MM-DD>.mp4, slug-safe.
  const safe = (s) =>
    String(s || '')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'untitled';
  const dateStr = recordedAt ? new Date(recordedAt).toISOString().slice(0, 10) : 'undated';
  const showPart = safe(renderData?.showName || archiveSlug);
  const djPart = safe(renderData?.djName);
  const parts = [showPart, djPart, dateStr].filter(Boolean);
  return `${parts.join('-')}.mp4`;
}

// ─── Boot-time zombie cleanup ───────────────────────────────────────────
// Worker just started → in-memory state from previous instance is gone.
// Any job stuck in 'rendering' for longer than the timeout window is a
// zombie. Mark it failed so the queue doesn't lie. Doesn't try to resume
// (that would risk re-running a render that's actually in flight on
// another instance).
async function scanZombieJobs() {
  try {
    const cutoff = Date.now() - ZOMBIE_CHECK_OLDER_THAN_MS;
    const snap = await db
      .collection('youtube-render-jobs')
      .where('status', '==', 'rendering')
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const startedAt = data.startedAt || data.createdAt || 0;
      if (startedAt < cutoff) {
        console.log(`[boot] Marking zombie job ${doc.id} as failed (startedAt=${new Date(startedAt).toISOString()})`);
        await doc.ref.update({
          status: 'failed',
          error: 'worker restarted before job completed',
          completedAt: Date.now(),
        });
      }
    }
  } catch (err) {
    console.error('[boot] Zombie scan failed:', err.message);
  }
}

// ─── Boot ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[youtube-render-worker] Listening on port ${PORT}`);
  scanZombieJobs();
});
