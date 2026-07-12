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
import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync, rmdirSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { chromium } from 'playwright';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
const MAX_RENDER_SECONDS = 6 * 60 * 60; // 6 hours absolute cap
const RENDER_OVERRUN_FACTOR = 1.5; // watchdog kills if elapsed > durationSec * factor + 5min slack
const RENDER_OVERRUN_SLACK_MS = 5 * 60 * 1000;
const FFMPEG_INITIAL_CONNECT_TIMEOUT_S = 30; // mirrors restream-worker's "short-run = retry" rule
const FFMPEG_MAX_ATTEMPTS = 3;
const FFMPEG_RETRY_DELAYS_MS = [1000, 3000];
const ZOMBIE_CHECK_OLDER_THAN_MS = 8 * 60 * 60 * 1000; // anything still 'rendering' for >8h is dead

// In-memory bookkeeping. Source of truth is always Firestore — this map only
// exists to manage child-process lifecycle for jobs running RIGHT NOW. On
// worker restart we lose this map, which is fine because boot-time zombie
// cleanup re-marks orphaned 'rendering' jobs as 'failed' (see scanZombieJobs).
const activeJobs = new Map(); // jobId -> { browser, ffmpegProcess, watchdogTimer, ffmpegRetryTimer, intentionalStop, tempPaths }

// Health tracker for the admin Tech Health dashboard. Only tracks the last
// observed outcome for each tracked operation — enough to answer:
//   - is the worker healthy? (responding to /health at all)
//   - did the last render run as expected?
//   - did the last cleanup (disk prune) run as expected?
const health = {
  lastJobAt: 0,
  lastJobOk: null,
  lastJobError: null,
  lastCleanupAt: 0,
  lastCleanupOk: null,
  lastCleanupError: null,
};
function recordJob(ok, error) {
  health.lastJobAt = Date.now();
  health.lastJobOk = ok;
  health.lastJobError = ok ? null : String(error || '').slice(0, 200);
}
function recordCleanup(ok, error) {
  health.lastCleanupAt = Date.now();
  health.lastCleanupOk = ok;
  health.lastCleanupError = ok ? null : String(error || '').slice(0, 200);
}

// ─── ffmpeg lock ─────────────────────────────────────────────────────────
// This box runs Playwright renders, /transcribe, AND (now) /normalize. The
// heavy renders already gate concurrency via the activeJobs map + watchdogs,
// but /normalize's long execSync ffmpeg passes would thrash the CPU if they
// ran alongside a render. Serialize normalize behind a strict-FIFO lock,
// ported verbatim from restream-worker/index.js. acquireFfmpegLock returns a
// token you await, then call release() in a finally.
let ffmpegChain = Promise.resolve();
let ffmpegQueueDepth = 0;
function acquireFfmpegLock(label) {
  ffmpegQueueDepth++;
  if (ffmpegQueueDepth > 1) console.log(`[ffmpeg-lock] ${label} queued (depth ${ffmpegQueueDepth})`);
  let release;
  const released = new Promise((r) => { release = r; });
  const acquired = ffmpegChain.then(() => {
    console.log(`[ffmpeg-lock] ${label} started`);
  });
  ffmpegChain = acquired.then(() => released).then(() => {
    ffmpegQueueDepth--;
    console.log(`[ffmpeg-lock] ${label} released (depth ${ffmpegQueueDepth})`);
  });
  return acquired.then(() => release);
}

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
  runJob(job)
    .then(() => recordJob(true))
    .catch((err) => {
      recordJob(false, err?.message || 'unhandled error');
      console.error(`[${jobId}] Unhandled runJob error:`, err);
      markFailed(jobId, err?.message || 'unhandled error').catch(() => {});
    });
});

// ─── POST /backfill-soundcloud ───────────────────────────────────────────
// Generates SoundCloud outputs (1500×1500 cover + lossless .m4a) for a
// pre-existing 'done' job that was rendered before SoundCloud support
// existed. Body: { jobId }. Behavior:
//   - Always regenerates the cover (cheap, ~5s; lets us refresh covers
//     after layout changes).
//   - Only generates the m4a if the job doesn't already have one
//     (avoids re-uploading a multi-hundred-MB file we already have).
//   - Refuses if the DJ has explicitly opted out of SoundCloud since
//     the original render — live-reads djProfile.soundcloudOptIn.
//   - YouTube outputs (outputUrl) are NEVER touched.
//
// Synchronous — work is fast enough (~5-15s per job) that the caller can
// just await the response. If a job is already actively rendering on this
// worker we 409 to avoid concurrent file writes.
app.post('/backfill-soundcloud', authenticate, async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  if (activeJobs.has(jobId)) {
    return res.status(409).json({ error: 'job actively rendering on this worker' });
  }

  let job;
  try {
    const snap = await db.collection('youtube-render-jobs').doc(jobId).get();
    if (!snap.exists) return res.status(404).json({ error: 'job not found' });
    job = { id: jobId, ...snap.data() };
  } catch (err) {
    return res.status(500).json({ error: `Failed to load job: ${err.message}` });
  }

  if (job.status !== 'done') {
    return res.status(400).json({ error: `job status is '${job.status}', expected 'done'` });
  }
  if (!job.recordingUrl || !job.renderData) {
    return res.status(400).json({ error: 'job missing recordingUrl or renderData' });
  }

  // Live-check SoundCloud consent. Same lookup pattern the API route uses
  // for /start. If we can't find the user we err on the side of allowing
  // the backfill (admin manually triggered it; absence ≠ opt-out).
  try {
    const archiveSnap = await db.collection('archives').doc(job.archiveId).get();
    const primaryDj = archiveSnap.exists
      ? (archiveSnap.data()?.djs || [])[0]
      : null;
    let profile = null;
    if (primaryDj?.userId) {
      const u = await db.collection('users').doc(primaryDj.userId).get();
      profile = u.exists ? (u.data()?.djProfile || null) : null;
    } else if (primaryDj?.username) {
      const normalized = primaryDj.username.replace(/[\s-]+/g, '').toLowerCase();
      const q = await db
        .collection('users')
        .where('chatUsernameNormalized', '==', normalized)
        .limit(1)
        .get();
      if (!q.empty) profile = q.docs[0].data()?.djProfile || null;
    }
    if (profile && profile.soundcloudOptIn === false) {
      return res
        .status(403)
        .json({ error: 'DJ has opted out of SoundCloud — refusing to backfill' });
    }
  } catch (err) {
    console.error(`[${jobId}][backfill] consent lookup failed:`, err);
    return res.status(500).json({ error: 'consent check failed' });
  }

  // Setup tempfiles. Reuses the same dir scheme as runJob so the teardown
  // helper can clean up either way.
  const dir = join(tmpdir(), `yt-render-${jobId}-backfill`);
  mkdirSync(dir, { recursive: true });
  const tempPaths = {
    dir,
    webm: join(dir, 'capture.webm'),
    png: join(dir, 'frame.png'),
    mp4: join(dir, 'output.mp4'),
    m4a: join(dir, 'audio.m4a'),
    mp3: join(dir, 'audio.mp3'),
    coverJpg: join(dir, 'cover.jpg'),
  };
  const entry = {
    browser: null,
    ffmpegProcess: null,
    watchdogTimer: null,
    ffmpegRetryTimer: null,
    intentionalStop: false,
    tempPaths,
    ffmpegAttempts: 0,
    captureMode: null,
  };
  activeJobs.set(jobId, entry);

  // Watchdog: backfill should be quick. 10 minutes is generous.
  entry.watchdogTimer = setTimeout(() => {
    console.error(`[${jobId}][backfill] watchdog fired — killing`);
    teardownJob(jobId, /* intentional */ true);
  }, 10 * 60 * 1000);

  try {
    // Always regenerate the cover so layout fixes propagate to old jobs.
    console.log(`[${jobId}][backfill] capturing 1500×1500 cover`);
    await captureSquareCover(jobId, entry, job.renderData);

    const updates = {};
    const filename = buildOutputFilename({
      archiveSlug: job.archiveSlug,
      renderData: job.renderData,
      recordedAt: job.recordedAt,
    });
    const baseNoExt = filename.replace(/\.mp4$/i, '');

    const coverFilename = `${baseNoExt}-cover.jpg`;
    const coverKey = `${R2_OUTPUT_PREFIX}/${coverFilename}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: coverKey,
        Body: readFileSync(tempPaths.coverJpg),
        ContentType: 'image/jpeg',
        ContentDisposition: `attachment; filename="${coverFilename}"`,
      })
    );
    updates.soundcloudImageUrl = `${R2_PUBLIC}/${coverKey}`;

    // Skip audio extract if the job already has one. This is the common
    // case for jobs that ran the new code path once but need a cover
    // refresh. extractAudio picks the right output format (m4a for mp4
    // sources, mp3 for mp3 sources) so backfilling old MP3-source archives
    // works without errors.
    if (!job.soundcloudAudioUrl) {
      console.log(`[${jobId}][backfill] extracting audio from ${job.recordingUrl}`);
      const audioResult = await extractAudio(jobId, entry, job.recordingUrl);
      const audioFilename = `${baseNoExt}.${audioResult.format}`;
      const audioKey = `${R2_OUTPUT_PREFIX}/${audioFilename}`;
      const audioContentType =
        audioResult.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: audioKey,
          Body: readFileSync(audioResult.path),
          ContentType: audioContentType,
          ContentDisposition: `attachment; filename="${audioFilename}"`,
        })
      );
      updates.soundcloudAudioUrl = `${R2_PUBLIC}/${audioKey}`;
    } else {
      console.log(`[${jobId}][backfill] audio already exists — skipping`);
    }

    await db.collection('youtube-render-jobs').doc(jobId).update(updates);
    res.json({ ok: true, jobId, updates });
  } catch (err) {
    console.error(`[${jobId}][backfill] failed:`, err);
    res.status(500).json({ error: err?.message || 'backfill failed' });
  } finally {
    teardownJob(jobId, /* intentional */ false);
  }
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

// POST /cleanup-report — called by the daily prune cron (cron lives on the
// VPS, not inside this process). Body: { ok: boolean, error?: string }.
// Auth-gated since it mutates health state.
app.post('/cleanup-report', authenticate, (req, res) => {
  const { ok, error } = req.body || {};
  if (typeof ok !== 'boolean') return res.status(400).json({ error: 'ok required (boolean)' });
  recordCleanup(ok, error);
  res.json({ recorded: true });
});

// GET /health — admin Tech Health probe. Returns the worker's last-known
// state plus current disk usage. df / inside the container reports the
// host overlay-fs numbers since Docker's overlay is backed by the host.
// No auth — read-only, no sensitive data.
function probeDisk() {
  try {
    const out = execSync('df -k /', { encoding: 'utf8' }).split('\n');
    if (out.length < 2) return null;
    const parts = out[1].trim().split(/\s+/);
    if (parts.length < 5) return null;
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb) || totalKb <= 0) return null;
    return {
      totalGb: Number((totalKb / 1024 / 1024).toFixed(2)),
      usedGb: Number((usedKb / 1024 / 1024).toFixed(2)),
      pct: Math.round((usedKb / totalKb) * 100),
    };
  } catch {
    return null;
  }
}

app.get('/health', (req, res) => {
  res.json({
    healthy: true,
    disk: probeDisk(),
    lastJob: {
      at: health.lastJobAt || null,
      ok: health.lastJobOk,
      error: health.lastJobError,
    },
    lastCleanup: {
      at: health.lastCleanupAt || null,
      ok: health.lastCleanupOk,
      error: health.lastCleanupError,
    },
  });
});

// ─── runJob ──────────────────────────────────────────────────────────────
async function runJob(job) {
  const { id: jobId, durationSec, recordingUrl, archiveSlug, renderData } = job;
  const startedAt = Date.now();

  // Setup tempfiles. webm = Playwright capture; mp4 = final muxed output;
  // m4a = SoundCloud-ready audio (lossless extract from source mp4);
  // coverJpg = 1500×1500 SoundCloud cover (separate square screenshot).
  const dir = join(tmpdir(), `yt-render-${jobId}`);
  mkdirSync(dir, { recursive: true });
  const tempPaths = {
    dir,
    webm: join(dir, 'capture.webm'),
    png: join(dir, 'frame.png'),
    mp4: join(dir, 'output.mp4'),
    m4a: join(dir, 'audio.m4a'),
    mp3: join(dir, 'audio.mp3'),
    coverJpg: join(dir, 'cover.jpg'),
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

  // Per-platform opt-in snapshots. Default to true when undefined so legacy
  // jobs created before SoundCloud existed still produce YouTube outputs.
  const youtubeEnabled = job.youtubeOptIn !== false;
  const soundcloudEnabled = job.soundcloudOptIn !== false;

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

    // ─── YouTube path: capture 1920×1080 → mux mp4 ───────────────────────
    // Skipped entirely when the DJ has opted out of YouTube — saves the
    // entire Playwright capture pass (which can be the full duration of
    // the mix in the dynamic case).
    if (youtubeEnabled) {
      console.log(`[${jobId}] Phase 1: capture (${durationSec}s)`);
      await capturePage(jobId, entry, durationSec, renderData);
      if (entry.intentionalStop) return;

      console.log(`[${jobId}] Phase 2: ffmpeg mux (${entry.captureMode})`);
      await db.collection('youtube-render-jobs').doc(jobId).update({ progressPct: 90 });
      await muxFinalMp4(jobId, entry, recordingUrl, durationSec);
      if (entry.intentionalStop) return;
    } else {
      console.log(`[${jobId}] Skipping YouTube outputs — DJ opted out`);
    }

    // ─── SoundCloud path: 1500×1500 cover + lossless audio ───────────────
    // Independent of the YouTube capture — the cover uses ?variant=square
    // and the audio is a stream-copy from recordingUrl (no transcode).
    // extractAudio returns the chosen format (m4a for mp4 sources, mp3
    // for mp3 sources) so the upload step knows which tempfile / mime
    // type to use.
    let audioResult = null;
    if (soundcloudEnabled) {
      console.log(`[${jobId}] Phase SC1: capture 1500×1500 cover`);
      await captureSquareCover(jobId, entry, renderData);
      if (entry.intentionalStop) return;

      console.log(`[${jobId}] Phase SC2: extract audio (lossless -c:a copy)`);
      audioResult = await extractAudio(jobId, entry, recordingUrl);
      if (entry.intentionalStop) return;
    } else {
      console.log(`[${jobId}] Skipping SoundCloud outputs — DJ opted out`);
    }

    // ─── Upload to R2 ────────────────────────────────────────────────────
    console.log(`[${jobId}] Upload phase: writing outputs to R2`);
    const filename = buildOutputFilename({ archiveSlug, renderData, recordedAt: job.recordedAt });
    const updates = { status: 'done', progressPct: 100, completedAt: Date.now() };

    if (youtubeEnabled) {
      const mp4Key = `${R2_OUTPUT_PREFIX}/${filename}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: mp4Key,
          Body: readFileSync(tempPaths.mp4),
          ContentType: 'video/mp4',
          ContentDisposition: `attachment; filename="${filename}"`,
        })
      );
      updates.outputUrl = `${R2_PUBLIC}/${mp4Key}`;
    }

    if (soundcloudEnabled && audioResult) {
      // Replace the .mp4 suffix with the chosen audio extension for the
      // audio sibling, and -cover.jpg for the image. Same slug so it's
      // obvious in R2 they belong to one render. SoundCloud accepts both
      // AAC-in-M4A and MP3 natively — content-type matches the bytes.
      const baseNoExt = filename.replace(/\.mp4$/i, '');
      const audioExt = audioResult.format; // 'm4a' or 'mp3'
      const audioFilename = `${baseNoExt}.${audioExt}`;
      const audioKey = `${R2_OUTPUT_PREFIX}/${audioFilename}`;
      const audioContentType = audioExt === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: audioKey,
          Body: readFileSync(audioResult.path),
          ContentType: audioContentType,
          ContentDisposition: `attachment; filename="${audioFilename}"`,
        })
      );
      updates.soundcloudAudioUrl = `${R2_PUBLIC}/${audioKey}`;

      const coverFilename = `${baseNoExt}-cover.jpg`;
      const coverKey = `${R2_OUTPUT_PREFIX}/${coverFilename}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: coverKey,
          Body: readFileSync(tempPaths.coverJpg),
          ContentType: 'image/jpeg',
          ContentDisposition: `attachment; filename="${coverFilename}"`,
        })
      );
      updates.soundcloudImageUrl = `${R2_PUBLIC}/${coverKey}`;
    }

    await db.collection('youtube-render-jobs').doc(jobId).update(updates);
    console.log(
      `[${jobId}] Done in ${Math.round((Date.now() - startedAt) / 1000)}s → ` +
        `yt=${updates.outputUrl || '(skipped)'} sc=${updates.soundcloudAudioUrl || '(skipped)'}`
    );
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
    // Wait until the page's measurement effect has had a chance to flip
    // body.dataset.needsMotion to "false" (it defaults to "true" on first
    // render so the worker errs on the side of dynamic). The page runs
    // the check at 300ms and 900ms after data is set, so 1500ms is enough
    // in practice — but Chromium in Docker can be slower than a regular
    // browser, so poll up to 3500ms before giving up. If we never see a
    // "false", we keep "true" and use the dynamic path (always-correct
    // fallback).
    let needsMotion = true;
    const pollDeadline = Date.now() + 3500;
    while (Date.now() < pollDeadline) {
      try {
        const value = await page.evaluate(() => document.body.dataset.needsMotion);
        if (value === 'false') {
          needsMotion = false;
          break;
        }
      } catch {
        // ignore — page might be mid-render
      }
      await page.waitForTimeout(200);
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

// ─── Phase SC1: square cover screenshot ─────────────────────────────────
// Loads /internal/render-mix?variant=square — same data, different layout
// (1500×1500 SoundCloud cover, no player chrome, no progress bar). One
// JPG screenshot, no video capture. Always cheap (a few seconds) regardless
// of mix length.
async function captureSquareCover(jobId, entry, renderData) {
  const renderDataJson = JSON.stringify({ ...renderData, durationSec: 1 });
  const url = `${APP_URL}/internal/render-mix?variant=square&data=${encodeURIComponent(renderDataJson)}`;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  entry.browser = browser;
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1500 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn(`[${jobId}][cover-console] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error(`[${jobId}][cover-page-error] ${err.message}`));
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
    // Brief settle pause so any reflow lands before the screenshot.
    await page.waitForTimeout(400);
    // JPG q=90: SoundCloud's 2MB ceiling is comfortable at this quality
    // for a 1500×1500 photo-backed image (~300-600KB typical).
    await page.screenshot({
      path: entry.tempPaths.coverJpg,
      type: 'jpeg',
      quality: 90,
      fullPage: false,
    });
    await page.close();
    await context.close();
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    entry.browser = null;
  }
}

// ─── Phase SC2: extract SoundCloud-ready audio from source ──────────────
// SoundCloud rejects .mp4 by extension even when the file is audio-only,
// so for an MP4 source we remux the AAC stream out into an .m4a container.
// For an MP3 source we stream-copy into a fresh .mp3 (m4a is AAC-only, so
// you can't put MP3 in there). Either way `-c:a copy` = lossless (same
// audio bytes, just a different container) and ~6000× real-time, so a 2hr
// mix takes ~1 second.
//
// Returns { format: 'm4a' | 'mp3', path: string } so the caller knows
// which tempfile to read and what content-type / filename to use on the
// R2 upload.
//
// No initial-connect retry loop — extract is cheap enough that one failure
// → bubble up is fine.
function extractAudio(jobId, entry, recordingUrl) {
  return new Promise((resolve, reject) => {
    // Detect source format from URL extension. recordingUrl always points
    // at an R2 object whose key carries the upload-time extension (mp3,
    // m4a, mp4, aac, etc.). Anything that's not obviously MP3 → treat as
    // MP4-with-AAC and produce M4A.
    const isMp3 = /\.mp3(\?|$)/i.test(recordingUrl);
    const outFormat = isMp3 ? 'mp3' : 'm4a';
    const outPath = isMp3 ? entry.tempPaths.mp3 : entry.tempPaths.m4a;

    const args = [
      '-y',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_delay_max', '5',
      '-i', recordingUrl,
      '-vn',           // drop any video stream
      '-c:a', 'copy',  // lossless audio extract
      // faststart for m4a (so the moov atom moves to the front for
      // progressive playback). Harmless to pass for mp3 — ffmpeg ignores
      // mp4-only flags when the output container isn't mp4.
      ...(isMp3 ? [] : ['-movflags', '+faststart']),
      '-loglevel', 'info',
      '-stats',
      outPath,
    ];
    const ff = spawn('ffmpeg', args);
    entry.ffmpegProcess = ff;
    let stderrTail = '';
    ff.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderrTail = (stderrTail + str).slice(-4096);
      for (const line of str.split('\n')) {
        if (line.trim()) console.log(`[${jobId}][${outFormat}] ${line.trim()}`);
      }
    });
    ff.on('error', (err) => {
      console.error(`[${jobId}][${outFormat}] spawn error:`, err);
      reject(err);
    });
    ff.on('close', (code, signal) => {
      entry.ffmpegProcess = null;
      if (entry.intentionalStop) return reject(new Error('intentionally stopped'));
      if (code === 0) return resolve({ format: outFormat, path: outPath });
      reject(new Error(`${outFormat} extract failed (code ${code}, signal ${signal}): ${stderrTail.slice(-512)}`));
    });
  });
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
        // The image never changes for the entire video — bar's frozen,
        // no scrolling. Encode at 1 fps so ffmpeg only processes
        // durationSec frames instead of durationSec*30. With x264
        // -tune stillimage and identical inputs, predicted frames are
        // ~zero bits each. A 2hr render produces a small file in
        // seconds. YouTube floor is 1 fps and accepts it fine.
        videoInputArgs = [
          '-framerate', '1',
          '-loop', '1',
          '-t', String(durationSec),
          '-i', entry.tempPaths.png,
        ];
        videoFilter = null;
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
        // Video: H.264 @ yuv420p, faststart for progressive YouTube upload.
        // For static (still image) renders, drop preset to ultrafast — the
        // output is one repeated frame so there's nothing to gain from a
        // slower preset, and ultrafast turns 2hr × 30fps into ~1 min of
        // encoding instead of ~1 hour. -tune stillimage tells x264 to
        // skip motion estimation entirely.
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        ...(entry.captureMode === 'static'
          ? ['-preset', 'ultrafast', '-tune', 'stillimage']
          : ['-preset', 'medium']),
        '-crf', '20',
        // Output framerate matches input: static = 1fps (one frame per
        // second of identical pixels, ffmpeg + x264 handle the
        // duplication efficiently); dynamic = 30fps to match the
        // Chromium page capture.
        ...(entry.captureMode === 'static' ? ['-r', '1'] : ['-r', '30']),
        ...(videoFilter ? ['-vf', videoFilter] : []),
        // Audio: copy directly from the source mp4. The recordings are
        // already AAC stereo at the right rate; re-encoding adds ~10x
        // slowdown for no quality gain. -c:a copy at ~6000× real-time
        // means a 2hr mix's audio side takes ~1 second.
        '-c:a', 'copy',
        // Static path: -loop 1 means video stream is infinite, so we need
        // to either cap it via -t or rely on -shortest (which uses the
        // shorter of video/audio — and since audio is finite, that
        // truncates correctly). Either way -shortest is safe.
        '-shortest',
        '-movflags', '+faststart',
        // info level so the periodic 'frame=… fps=…' progress lines
        // make it into our logs — without them, a long-running encode
        // looks identical to a hung process.
        '-loglevel', 'info',
        '-stats',
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
  const { dir, webm, png, mp4, m4a, mp3, coverJpg } = entry.tempPaths;
  for (const p of [webm, png, mp4, m4a, mp3, coverJpg]) {
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

// ─── POST /transcribe ────────────────────────────────────────────────────
// On-demand transcription of a /tape field note → line-by-line captions.
// Admin-triggered (see /api/field-notes/admin/transcribe). Read-only w.r.t. the
// audio — downloads it, runs whisper, returns text + timed caption cues.
//
// Async-callback contract (mirrors /start + restream-worker /normalize): when
// callbackUrl is set we respond 202 immediately and POST the result to it when
// done. The app's /api/field-notes/transcribe-callback writes it onto the note.
//
// Body: { audioUrl, callbackUrl?, callbackContext? }
// Requires whisper-cli + WHISPER_MODEL_PATH baked into the image (Dockerfile).
const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || '/opt/whisper/ggml-base.en.bin';
const WHISPER_MODEL_NAME = 'base.en';
const CAPTION_MAX_SEC = 5.5;
const CAPTION_MAX_WORDS = 9;

function tr_joinWords(parts) {
  return parts
    .join(' ')
    .replace(/\s+([,.?!])/g, '$1')
    .replace(/\s+'/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function tr_isPunctuationOnly(text) {
  return !/[A-Za-z0-9]/.test(text);
}
// Group whisper word-offsets into caption lines. Break on a sentence-ender, or
// ~5.5s / ~9 words. A line that ends up punctuation-only (whisper emitted "." as
// its own token) is merged into the previous line rather than standing alone.
function groupWordsIntoCaptions(words) {
  const lines = [];
  let cur = [];
  let start = null;
  const flush = (endTo) => {
    const text = tr_joinWords(cur);
    if (text) {
      if (tr_isPunctuationOnly(text) && lines.length > 0) {
        const prev = lines[lines.length - 1];
        prev.text = tr_joinWords([prev.text, text]);
        prev.to = Number(endTo.toFixed(2));
      } else {
        lines.push({ from: Number(start.toFixed(2)), to: Number(endTo.toFixed(2)), text });
      }
    }
    cur = [];
    start = null;
  };
  for (const w of words) {
    if (start === null) start = w.from;
    cur.push(w.text);
    const dur = w.to - start;
    const endsSentence = /[.?!]$/.test(w.text);
    if (endsSentence || dur >= CAPTION_MAX_SEC || cur.length >= CAPTION_MAX_WORDS) {
      flush(w.to);
    }
  }
  if (cur.length && start !== null) flush(words[words.length - 1].to);
  return lines;
}

// Sample a loudness waveform (N bars, 0..1) from a decoded wav. Loops N windows,
// reads each window's mean_volume (dB) via volumedetect, then self-normalizes to
// the tape's own min→max scaled into 0.15..1.0 (quietest bar keeps a visible
// stub). Absolute dB mapping looks flat; self-normalization gives real dynamics.
// Matches the recipe validated in the local backfill. Returns [] on failure.
const WAVEFORM_BARS = 160;
function sampleWaveform(wavPath, durationSec, N = WAVEFORM_BARS) {
  if (!durationSec || durationSec <= 0) return [];
  const win = durationSec / N;
  const raw = [];
  for (let i = 0; i < N; i++) {
    const ss = (i * win).toFixed(3);
    const out = execSync(
      `ffmpeg -hide_banner -nostats -ss ${ss} -t ${win.toFixed(3)} -i "${wavPath}" -af "volumedetect" -f null - 2>&1`,
      { encoding: 'utf-8' },
    );
    const m = out.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
    raw.push(m ? parseFloat(m[1]) : -60);
  }
  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  if (hi - lo < 1e-6) return raw.map(() => 0.6);
  return raw.map((x) => Math.round((0.15 + 0.85 * (x - lo) / (hi - lo)) * 1000) / 1000);
}

app.post('/transcribe', authenticate, async (req, res) => {
  const { audioUrl, callbackUrl, callbackContext } = req.body || {};
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl required' });

  const isAsyncMode = !!callbackUrl;
  if (isAsyncMode) res.status(202).json({ accepted: true });

  const fireCallback = (payload) => {
    if (!callbackUrl) return;
    if (!SHARED_SECRET) {
      console.warn('[transcribe] callbackUrl set but SHARED_SECRET missing; skipping callback');
      return;
    }
    fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SHARED_SECRET}` },
      body: JSON.stringify({ ...payload, callbackContext }),
    })
      .then((r) => {
        if (!r.ok) console.error(`[transcribe] callback ${callbackUrl} returned ${r.status}`);
        else console.log(`[transcribe] callback delivered to ${callbackUrl}`);
      })
      .catch((e) => console.error(`[transcribe] callback ${callbackUrl} failed:`, e?.message || e));
  };
  const respond = (status, payload) => {
    if (!res.headersSent) res.status(status).json(payload);
    fireCallback(payload);
    recordJob(status === 200, payload && payload.error);
  };

  const stamp = Date.now();
  const dir = join(tmpdir(), `transcribe-${stamp}`);
  const tmpWav = join(dir, 'audio.wav');
  const tmpJsonBase = join(dir, 'out'); // whisper appends .json
  const tmpJson = `${tmpJsonBase}.json`;
  const cleanup = () => {
    [tmpWav, tmpJson].forEach((p) => { try { unlinkSync(p); } catch {} });
    try { rmdirSync(dir); } catch {}
  };

  try {
    mkdirSync(dir, { recursive: true });
    console.log(`[transcribe] Processing: ${audioUrl}`);

    // Download + extract to 16kHz mono wav in one ffmpeg pass, straight from the
    // R2 public URL. Reconnect flags mirror extractAudio() — Cloudflare drops
    // mid-stream and silently exits 0 without them.
    execSync(
      `ffmpeg -y -reconnect 1 -reconnect_streamed 1 -reconnect_at_eof 1 -reconnect_delay_max 5 ` +
      `-i "${audioUrl}" -vn -ar 16000 -ac 1 "${tmpWav}" 2>&1`,
      { encoding: 'utf-8' }
    );

    // Whisper with word timestamps (-ml 1) → JSON.
    execSync(
      `whisper-cli -m ${WHISPER_MODEL_PATH} -f "${tmpWav}" -ml 1 -oj -of "${tmpJsonBase}" 2>&1`,
      { encoding: 'utf-8' }
    );

    const parsed = JSON.parse(readFileSync(tmpJson, 'utf-8'));
    const segs = Array.isArray(parsed.transcription) ? parsed.transcription : [];
    const words = [];
    for (const s of segs) {
      const text = (s.text || '').trim();
      if (!text) continue;
      words.push({ from: (s.offsets?.from ?? 0) / 1000, to: (s.offsets?.to ?? 0) / 1000, text });
    }
    const transcript = tr_joinWords(words.map((w) => w.text));
    const captions = groupWordsIntoCaptions(words);

    const durProbe = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${tmpWav}"`,
      { encoding: 'utf-8' }
    );
    const durationSec = parseFloat(durProbe.trim()) || 0;

    // Loudness waveform for the /tape player bar. Never fail the transcribe over
    // it — captions are the point; the waveform is a bonus (null on failure).
    let waveform = [];
    try {
      waveform = sampleWaveform(tmpWav, durationSec);
    } catch (wfErr) {
      console.error('[transcribe] waveform sampling failed (non-fatal):', wfErr?.message || wfErr);
    }

    cleanup();
    console.log(`[transcribe] Done: ${captions.length} caption lines, ${transcript.length} chars, ${waveform.length} waveform bars`);
    respond(200, { success: true, transcript, captions, waveform, model: WHISPER_MODEL_NAME, durationSec });
  } catch (err) {
    cleanup();
    console.error('[transcribe] Failed:', err?.message || err);
    respond(500, { error: (err && err.message) || String(err) });
  }
});

// ─── POST /normalize ─────────────────────────────────────────────────────
// Two-pass loudnorm to -14 LUFS / -1.5 dBTP / LRA 11 + leading/trailing-silence
// trim + hard-cut fade-out. Ported from restream-worker/index.js so that box
// stays off-limits (it shares CPU with LiveKit). This copy adds a LOSSLESS
// branch: wav/flac/aac/ogg/m4a sources are transcoded to AAC .m4a (the mp3/mp4
// branches are byte-for-byte the restream-worker behavior, so this endpoint is
// a strict superset — the drain cron can safely route anything here, though in
// practice it only sends the lossless formats and keeps mp3/mp4 on restream).
//
// Async-by-callback contract matches restream-worker /normalize + this worker's
// /start and /transcribe: with callbackUrl set, respond 202 immediately and
// POST the result to callbackUrl (the app's /api/recording/normalize-queue-callback).
app.post('/normalize', authenticate, async (req, res) => {
  const { r2Key, callbackUrl, callbackContext } = req.body || {};
  if (!r2Key) return res.status(400).json({ error: 'r2Key required' });

  const isAsyncMode = !!callbackUrl;
  if (isAsyncMode) res.status(202).json({ accepted: true, r2Key });

  const fireCallback = (payload) => {
    if (!callbackUrl) return;
    if (!SHARED_SECRET) {
      console.warn('[normalize] callbackUrl set but SHARED_SECRET missing; skipping callback');
      return;
    }
    fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SHARED_SECRET}` },
      body: JSON.stringify({ ...payload, callbackContext }),
    })
      .then((r) => {
        if (!r.ok) console.error(`[normalize] callback to ${callbackUrl} returned ${r.status}`);
        else console.log(`[normalize] callback delivered to ${callbackUrl}`);
      })
      .catch((e) => console.error(`[normalize] callback to ${callbackUrl} failed:`, e?.message || e));
  };
  let releaseLock = null;
  const respond = (status, payload) => {
    if (!res.headersSent) res.status(status).json(payload);
    fireCallback(payload);
    recordJob(status === 200, payload && payload.error);
    if (releaseLock) { releaseLock(); releaseLock = null; }
  };

  // Format detection. Controls: re-encode codec, output-key suffix, content-type.
  //   mp3       → mp3 (libmp3lame), same as restream-worker
  //   mp4       → mp4 (aac), same as restream-worker
  //   lossless* → m4a (aac). Output KEY gets .m4a regardless of input ext, so
  //               a .wav source ships as <stem>-normalized-v2.m4a. The callback
  //               is URL-driven so the extension change flows through cleanly.
  // (Detection is BEFORE taking the lock — a bad format shouldn't wait in line.)
  let format;       // controls encode args + content-type
  let outExt;       // extension for the output R2 key + tempfiles
  if (/\.mp4$/i.test(r2Key)) { format = 'mp4'; outExt = 'mp4'; }
  else if (/\.mp3$/i.test(r2Key)) { format = 'mp3'; outExt = 'mp3'; }
  else if (/\.(wav|flac|aac|m4a|ogg|oga|opus|webm)$/i.test(r2Key)) { format = 'lossless'; outExt = 'm4a'; }
  else {
    return respond(400, {
      error: `Unsupported format for normalize: ${r2Key}. Handles .mp3, .mp4, and lossless (.wav/.flac/.aac/.m4a/.ogg/.opus/.webm).`,
    });
  }

  releaseLock = await acquireFfmpegLock(`normalize ${r2Key}`);
  console.log(`[normalize] Processing: ${r2Key} (format=${format} → ${outExt})`);

  const bucket = R2_BUCKET;
  const publicBase = R2_PUBLIC;

  const tmpIn = join(tmpdir(), `normalize-in-${Date.now()}.${outExt === 'mp3' ? 'mp3' : (format === 'mp4' ? 'mp4' : 'src')}`);
  const tmpOut = join(tmpdir(), `normalize-out-${Date.now()}.${outExt}`);
  const tmpTrimmed = join(tmpdir(), `normalize-trimmed-${Date.now()}.${outExt}`);

  // Loudness target — same calibration as restream-worker.
  const TARGET_I = -14;
  const TARGET_TP = -1.5;
  const TARGET_LRA = 11;

  const MIN_TRAILING_SILENCE_SEC = 1;
  const SAFETY_TAIL_SEC = 0.5;
  const MIN_LEADING_SILENCE_SEC = 1;
  const LEADING_PROBE_SEC = 20;
  const FADE_OUT_SEC = 5;
  const FADE_PROBE_TAIL_SEC = 0.4;
  const FADE_BODY_REF_SEC = 1.0;
  const HARD_CUT_DELTA_DB = 6;

  // Content-type + encode args by output container. Lossless inputs are always
  // encoded to AAC-in-m4a (audio/mp4). A .m4a output is audio, not video — but
  // AAC-in-MP4 is served as video/mp4 elsewhere for progressive playback; keep
  // audio/mp4 here since these are audio-only and that's the correct type.
  const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
  const encodeArgs = format === 'mp3'
    ? '-c:a libmp3lame -b:a 192k'
    : '-c:a aac -b:a 192k -movflags +faststart';
  // Output-key rewrite: swap the ORIGINAL extension for the v2 suffix. For
  // lossless the input ext varies, so strip whatever trailing .ext there is.
  const v2Suffix = `-normalized-v2.${outExt}`;
  const trimmedSuffix = `-normalized-v2-trimmed.${outExt}`;
  const swapExt = (key, suffix) => key.replace(/\.[a-z0-9]+$/i, suffix);

  try {
    // --- 1. Download ---
    // Missing source (aborted/test egress writes only a manifest, no media) →
    // NoSuchKey. Report it verbatim so the drain cron's isMissingSourceError
    // matches and fails fast instead of retrying 5×.
    let body;
    try {
      const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
      body = Buffer.from(await resp.Body.transformToByteArray());
    } catch (dlErr) {
      const msg = String(dlErr?.name || dlErr?.Code || dlErr?.message || dlErr);
      if (/NoSuchKey|NotFound|does not exist/i.test(msg)) {
        return respond(400, { error: `The specified key does not exist. (${r2Key})` });
      }
      throw dlErr;
    }
    writeFileSync(tmpIn, body);
    console.log(`[normalize] Downloaded ${(body.length / 1024 / 1024).toFixed(1)}MB`);

    // --- 2. Pass 1: measure loudness for the linear two-pass ---
    const measureOut = execSync(
      `ffmpeg -hide_banner -nostats -i ${tmpIn} -af "loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json" -f null - 2>&1 | awk '/^{/,/^}/'`,
      { encoding: 'utf-8' }
    );
    const measured = JSON.parse(measureOut);
    const inputI = parseFloat(measured.input_i);
    const inputTP = parseFloat(measured.input_tp);
    const inputLRA = parseFloat(measured.input_lra);
    const measuredThresh = parseFloat(measured.input_thresh);
    const measuredOffset = parseFloat(measured.target_offset);
    console.log(`[normalize] Input: I=${inputI} TP=${inputTP} LRA=${inputLRA}`);

    // --- 3. Skip if already in target band ---
    // Lossless inputs are ALWAYS transcoded (we can't leave a .wav as the active
    // listener URL — it must become .m4a), so the skip-band only applies to
    // mp3/mp4 where the original container is already what listeners get.
    const ALREADY_CORRECT_I_MIN = -15;
    const ALREADY_CORRECT_I_MAX = -13;
    const ALREADY_CORRECT_TP_MAX = -1.0;
    if (
      format !== 'lossless' &&
      inputI >= ALREADY_CORRECT_I_MIN &&
      inputI <= ALREADY_CORRECT_I_MAX &&
      inputTP <= ALREADY_CORRECT_TP_MAX
    ) {
      [tmpIn].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `Already in target band: I=${inputI} TP=${inputTP}`;
      console.log(`[normalize] SKIP: ${reason}`);
      return respond(200, {
        skipped: true,
        reason,
        measurements: { inputI, inputTP, inputLRA },
      });
    }

    // --- 4. Pass 2: render normalized output (linear=true) ---
    const filter = `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}` +
      `:measured_I=${inputI}:measured_TP=${inputTP}:measured_LRA=${inputLRA}` +
      `:measured_thresh=${measuredThresh}:offset=${measuredOffset}` +
      `:linear=true:print_format=summary`;
    execSync(
      `ffmpeg -hide_banner -nostats -y -i ${tmpIn} -vn -af "${filter}" ${encodeArgs} ${tmpOut} 2>&1`
    );

    // --- 5. Verify output loudness ---
    const verifyOut = await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-hide_banner', '-nostats',
        '-i', tmpOut,
        '-af', 'ebur128=peak=true',
        '-f', 'null', '-',
      ]);
      let tail = '';
      const TAIL_BYTES = 64 * 1024;
      ff.stderr.on('data', (chunk) => {
        tail += chunk.toString();
        if (tail.length > TAIL_BYTES) tail = tail.slice(-TAIL_BYTES);
      });
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0) resolve(tail);
        else reject(new Error(`ebur128 verify exited ${code}: ${tail.slice(-1000)}`));
      });
    });
    const grab = (re) => parseFloat((verifyOut.match(re) || [])[1] || 'NaN');
    const outputI = grab(/I:\s*(-?\d+\.\d+)\s*LUFS/);
    const outputTP = grab(/Peak:\s*(-?\d+\.\d+)\s*dBFS/);
    const outputLRA = grab(/LRA:\s*(-?\d+\.\d+)\s*LU/);
    console.log(`[normalize] Output: I=${outputI} TP=${outputTP} LRA=${outputLRA}`);

    // --- 6. Detect leading + trailing silence ---
    let outDur = 0;
    let leadingSilenceEndSec = null;
    let leadingSilenceLengthSec = null;
    let trailingSilenceStartSec = null;
    let trailingSilenceLengthSec = null;
    try {
      const probe = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 ${tmpOut}`,
        { encoding: 'utf-8' }
      );
      outDur = parseFloat(probe.trim()) || 0;

      if (outDur > 0) {
        // --- 6a. Leading silence ---
        const leadingOut = execSync(
          `ffmpeg -hide_banner -nostats -t ${LEADING_PROBE_SEC} -i ${tmpOut} -af "silencedetect=noise=-50dB:d=0.3" -f null - 2>&1`,
          { encoding: 'utf-8' }
        );
        const leadStart = leadingOut.match(/silence_start:\s*(-?\d+\.?\d*)/);
        const leadEnd = leadingOut.match(/silence_end:\s*(-?\d+\.?\d*)/);
        if (leadStart && parseFloat(leadStart[1]) <= 0.2) {
          if (leadEnd) {
            const end = parseFloat(leadEnd[1]);
            const length = end - parseFloat(leadStart[1]);
            if (length >= MIN_LEADING_SILENCE_SEC) {
              leadingSilenceEndSec = end;
              leadingSilenceLengthSec = length;
            }
          }
        }

        // --- 6b. Trailing silence ---
        const scanFromSec = Math.max(0, outDur - 15 * 60);
        const silenceOut = execSync(
          `ffmpeg -hide_banner -nostats -ss ${scanFromSec} -i ${tmpOut} -af "silencedetect=noise=-50dB:d=0.8" -f null - 2>&1`,
          { encoding: 'utf-8' }
        );
        const startMatches = [...silenceOut.matchAll(/silence_start:\s*(-?\d+\.?\d*)/g)];
        const endMatches = [...silenceOut.matchAll(/silence_end:\s*(-?\d+\.?\d*)/g)];
        if (startMatches.length > 0) {
          const lastStart = parseFloat(startMatches[startMatches.length - 1][1]) + scanFromSec;
          const lastEnd = endMatches.length > 0
            ? parseFloat(endMatches[endMatches.length - 1][1]) + scanFromSec
            : Infinity;
          const runsToEof = endMatches.length < startMatches.length || lastEnd >= outDur - 0.5;
          if (runsToEof) {
            const length = outDur - lastStart;
            if (length >= MIN_TRAILING_SILENCE_SEC && lastStart > 30 * 60) {
              trailingSilenceStartSec = lastStart;
              trailingSilenceLengthSec = length;
            }
          }
        }
      }
    } catch (silenceErr) {
      console.error(`[normalize] Silence detection failed; v2 will not be trimmed:`, silenceErr?.message || silenceErr);
    }
    if (leadingSilenceEndSec !== null) {
      console.log(`[normalize] Leading silence: ${leadingSilenceLengthSec.toFixed(2)}s (ends at ${leadingSilenceEndSec.toFixed(2)}s)`);
    }
    if (trailingSilenceStartSec !== null) {
      console.log(`[normalize] Trailing silence: ${trailingSilenceLengthSec.toFixed(1)}s starting at ${trailingSilenceStartSec.toFixed(1)}s`);
    }

    // --- 6c. Hard-cut detection ---
    let needsFade = false;
    try {
      const realEnd = trailingSilenceStartSec !== null ? trailingSilenceStartSec : outDur;
      if (realEnd > FADE_BODY_REF_SEC + 2) {
        const tailStart = (realEnd - FADE_PROBE_TAIL_SEC).toFixed(3);
        const bodyStart = (realEnd - 2 - FADE_BODY_REF_SEC).toFixed(3);
        const parseMean = (out) => {
          const m = out.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
          return m ? parseFloat(m[1]) : null;
        };
        const tailOut = execSync(
          `ffmpeg -hide_banner -nostats -ss ${tailStart} -t ${FADE_PROBE_TAIL_SEC} -i ${tmpOut} -af "volumedetect" -f null - 2>&1`,
          { encoding: 'utf-8' }
        );
        const bodyOut = execSync(
          `ffmpeg -hide_banner -nostats -ss ${bodyStart} -t ${FADE_BODY_REF_SEC} -i ${tmpOut} -af "volumedetect" -f null - 2>&1`,
          { encoding: 'utf-8' }
        );
        const tailDb = parseMean(tailOut);
        const bodyDb = parseMean(bodyOut);
        if (tailDb !== null && bodyDb !== null) {
          needsFade = (tailDb - bodyDb) >= -HARD_CUT_DELTA_DB;
          console.log(`[normalize] End-taper check: tail=${tailDb.toFixed(1)}dB body=${bodyDb.toFixed(1)}dB delta=${(tailDb - bodyDb).toFixed(1)}dB -> ${needsFade ? 'HARD CUT (will fade)' : 'already tapering (skip)'}`);
        }
      }
    } catch (fadeErr) {
      console.error(`[normalize] Hard-cut detection failed; no fade applied:`, fadeErr?.message || fadeErr);
    }

    // --- 7. Upload v2 (normalized, untrimmed) ---
    const v2Key = swapExt(r2Key, v2Suffix);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: v2Key,
      Body: readFileSync(tmpOut),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const v2Url = publicBase ? `${publicBase}/${v2Key}` : null;
    console.log(`[normalize] Uploaded v2: ${v2Key}`);

    // --- 8. Produce the active sibling (-normalized-v2-trimmed) ---
    let trimmedKey = null;
    let trimmedUrl = null;
    let trimmedDurationSec = null;
    const hasLeading = leadingSilenceEndSec !== null;
    const hasTrailing = trailingSilenceStartSec !== null;
    if (hasLeading || hasTrailing || needsFade) {
      try {
        const ssArg = hasLeading ? `-ss ${leadingSilenceEndSec.toFixed(3)} ` : '';
        const toArg = hasTrailing
          ? `-to ${Math.max(0, trailingSilenceStartSec - SAFETY_TAIL_SEC).toFixed(3)} `
          : '';
        const movflags = (format === 'mp4' || format === 'lossless') ? '-movflags +faststart' : '';

        if (needsFade) {
          const trimEnd = hasTrailing
            ? Math.max(0, trailingSilenceStartSec - SAFETY_TAIL_SEC)
            : outDur;
          const leadCut = hasLeading ? leadingSilenceEndSec : 0;
          const outLen = Math.max(0, trimEnd - leadCut);
          const fadeStart = Math.max(0, outLen - FADE_OUT_SEC).toFixed(3);
          const fadeDur = Math.min(FADE_OUT_SEC, outLen).toFixed(3);
          execSync(
            `ffmpeg -hide_banner -nostats -y ${ssArg}-i ${tmpOut} ${toArg}-vn -af "afade=t=out:st=${fadeStart}:d=${fadeDur}" ${encodeArgs} ${tmpTrimmed} 2>&1`
          );
        } else {
          execSync(
            `ffmpeg -hide_banner -nostats -y ${ssArg}-i ${tmpOut} ${toArg}-c copy -avoid_negative_ts make_zero ${movflags} ${tmpTrimmed} 2>&1`
          );
        }

        const trimProbe = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 ${tmpTrimmed}`,
          { encoding: 'utf-8' }
        );
        trimmedDurationSec = parseFloat(trimProbe.trim()) || 0;
        trimmedKey = swapExt(r2Key, trimmedSuffix);
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: trimmedKey,
          Body: readFileSync(tmpTrimmed),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        trimmedUrl = publicBase ? `${publicBase}/${trimmedKey}` : null;
        const kinds = [hasLeading && 'leading-trim', hasTrailing && 'trailing-trim', needsFade && 'fade-out'].filter(Boolean).join('+');
        console.log(`[normalize] Uploaded v2-trimmed (${kinds}): ${trimmedKey} (${trimmedDurationSec.toFixed(1)}s)`);
      } catch (trimErr) {
        console.error(`[normalize] Trim/fade step failed; keeping untrimmed v2:`, trimErr?.message || trimErr);
        trimmedKey = null;
        trimmedUrl = null;
        trimmedDurationSec = null;
      }
    }

    [tmpIn, tmpOut, tmpTrimmed].forEach(p => { try { unlinkSync(p); } catch {} });

    respond(200, {
      success: true,
      skipped: false,
      originalR2Key: r2Key,
      newR2Key: v2Key,
      newUrl: v2Url,
      trimmedR2Key: trimmedKey,
      trimmedUrl,
      durationSec: outDur,
      trimmedDurationSec,
      measurements: {
        inputI, inputTP, inputLRA,
        outputI, outputTP, outputLRA,
        leadingSilenceEndSec, leadingSilenceLengthSec,
        trailingSilenceStartSec, trailingSilenceLengthSec,
        fadeOutApplied: needsFade,
        fadeOutSec: needsFade ? FADE_OUT_SEC : null,
      },
    });
  } catch (err) {
    [tmpIn, tmpOut, tmpTrimmed].forEach(p => { try { unlinkSync(p); } catch {} });
    console.error(`[normalize] Failed:`, err);
    respond(500, { error: err.message });
  }
});

// ─── Boot ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[youtube-render-worker] Listening on port ${PORT}`);
  scanZombieJobs();
});
