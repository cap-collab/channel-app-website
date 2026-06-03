import express from 'express';
import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3100;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.CRON_SECRET || '';

// Active restreams keyed by slotId. Each value: { archiveFfmpeg, silenceFfmpeg, ingressId, slotEndTimer, intentionalStop }.
const activeStreams = new Map();

// Pending restreams — scheduled to start at a future time but not yet started.
// Keyed by slotId. Each value: { startTimer, params }.
// When /stop is called for a pending slot (e.g., admin deletes before start),
// we clear the timer without touching LiveKit (nothing's been created yet).
const pendingStarts = new Map();

// Auth middleware
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!SHARED_SECRET || auth !== `Bearer ${SHARED_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /start — start a restream by publishing the archive MP4 into the
// LiveKit room via an RTMP ingress. From the room's perspective the restream
// participant looks just like a DJ going live via RTMP, so the existing
// webhook→egress→R2 pipeline (track_published handler) picks it up without
// any per-source branching.
app.post('/start', authenticate, async (req, res) => {
  const params = req.body;
  try {
    const result = await startSlot(params);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * Core "start this restream now" logic. Extracted from the /start handler so
 * /schedule can reuse it when its timer fires. Returns { slotId, ingressId }
 * on success. Throws (with optional .statusCode) on failure.
 */
async function startSlot(params) {
  const { slotId, archiveUrl, roomName, apiKey, apiSecret, livekitHost, appUrl, endTime } = params || {};

  if (!slotId || !archiveUrl || !roomName || !apiKey || !apiSecret || !livekitHost) {
    const err = new Error('Missing required fields');
    err.statusCode = 400;
    throw err;
  }

  // If there's a pending scheduled start for this slot, cancel it first —
  // we're starting now, timer is obsolete.
  const pending = pendingStarts.get(slotId);
  if (pending) {
    clearTimeout(pending.startTimer);
    pendingStarts.delete(slotId);
    console.log(`[restream] Cancelled pending scheduled start for ${slotId} (starting now)`);
  }

  if (activeStreams.has(slotId)) {
    await stopStream(slotId, apiKey, apiSecret, livekitHost);
  }

  let ingressId = null;
  try {
    console.log(`[restream] Starting for slot ${slotId}, url: ${archiveUrl}, endTime: ${endTime || 'none'}`);

    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
    const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
      name: `restream-${slotId}`,
      roomName,
      participantIdentity: `restream-${slotId}`,
      participantName: 'Restream',
    });
    ingressId = ingress.ingressId;
    const rtmpBase = (ingress.url && ingress.url.length > 0)
      ? ingress.url
      : (process.env.RTMP_BASE_URL || 'rtmp://172.17.0.1:1935/x');
    const rtmpTarget = `${rtmpBase}/${ingress.streamKey}`;
    console.log(`[restream] Ingress created: ${ingressId}, rtmp=${rtmpBase}/<key>`);

    // Archive FFmpeg can fail on the initial HTTP read of the MP4 (R2/CDN
    // hiccup, transient network blip). The reconnect flags only help
    // mid-stream — an initial-connect failure exits with code 1. We retry
    // the spawn a couple times with small backoff before giving up. Don't
    // tear down the ingress between attempts; same RTMP target, same slot.
    const ARCHIVE_MAX_ATTEMPTS = 3;
    const ARCHIVE_RETRY_DELAYS_MS = [1000, 3000]; // attempt 2 after 1s, attempt 3 after 3s
    const ARCHIVE_RETRY_MIN_RUNTIME_MS = 30_000; // re-attempt only if previous run < 30s

    // intentionalStop === true when stopStream or the slot-end timer killed
    // FFmpeg on purpose. Checking this is more reliable than trying to
    // interpret Node's exit code/signal — SIGTERM often surfaces as code 255
    // with signal=null depending on how FFmpeg responds to the signal.
    const entry = {
      archiveFfmpeg: null,
      silenceFfmpeg: null,
      ingressId,
      slotEndTimer: null,
      intentionalStop: false,
      archiveAttempts: 0,
      archiveRetryTimer: null,
    };
    activeStreams.set(slotId, entry);

    function spawnArchive() {
      entry.archiveAttempts += 1;
      const attemptNum = entry.archiveAttempts;
      const startedAt = Date.now();
      console.log(`[restream] Archive FFmpeg attempt ${attemptNum}/${ARCHIVE_MAX_ATTEMPTS} for slot ${slotId}`);
      const proc = makeFfmpeg(archiveUrl, rtmpTarget);
      proc.stderr.on('data', (data) => {
        console.log(`[restream][ffmpeg ${slotId}] ${data.toString().trim()}`);
      });

      proc.on('close', (code, signal) => {
        const ranMs = Date.now() - startedAt;
        console.log(`[restream] Archive FFmpeg exited code=${code} signal=${signal} ranMs=${ranMs} attempt=${attemptNum} intentional=${entry.intentionalStop} for slot ${slotId}`);
        if (entry.intentionalStop) {
          // Killed on purpose (stopStream / slot-end timer). Caller owns
          // teardown; do nothing.
          return;
        }
        if (code === 0) {
          // Archive finished on its own. Pad with silence until slot-end.
          const current = activeStreams.get(slotId);
          if (current && current === entry && !current.silenceFfmpeg && current.slotEndTimer) {
            console.log(`[restream] Archive done before slot.endTime — padding with silence for slot ${slotId}`);
            const silenceFfmpeg = makeFfmpeg('anullsrc=r=48000:cl=stereo', rtmpTarget, { silence: true });
            silenceFfmpeg.stderr.on('data', (data) => {
              console.log(`[restream][silence ${slotId}] ${data.toString().trim()}`);
            });
            silenceFfmpeg.on('close', (silenceCode) => {
              console.log(`[restream] Silence FFmpeg exited code=${silenceCode} for slot ${slotId}`);
            });
            current.silenceFfmpeg = silenceFfmpeg;
          }
          return;
        }
        // Non-zero exit. Decide between retry and teardown.
        // Retry only if (a) we haven't exhausted attempts AND (b) the run
        // was short — long runs that died near completion are likely
        // legitimate end-of-archive issues, not transient connect failures,
        // so we don't restart the whole archive.
        const canRetry =
          attemptNum < ARCHIVE_MAX_ATTEMPTS
          && ranMs < ARCHIVE_RETRY_MIN_RUNTIME_MS
          && activeStreams.get(slotId) === entry;
        if (canRetry) {
          const delay = ARCHIVE_RETRY_DELAYS_MS[attemptNum - 1] || 3000;
          console.warn(`[restream] Archive FFmpeg failed early for slot ${slotId} (ranMs=${ranMs}); retrying in ${delay}ms (attempt ${attemptNum + 1}/${ARCHIVE_MAX_ATTEMPTS})`);
          entry.archiveRetryTimer = setTimeout(() => {
            entry.archiveRetryTimer = null;
            // Slot may have been torn down or replaced while we waited.
            if (activeStreams.get(slotId) !== entry) {
              console.log(`[restream] Retry: slot ${slotId} no longer active, skipping`);
              return;
            }
            entry.archiveFfmpeg = spawnArchive();
          }, delay);
          return;
        }
        // No more retries — give up on this slot.
        console.error(`[restream] Archive FFmpeg failed for slot ${slotId}, tearing down (attempt ${attemptNum}/${ARCHIVE_MAX_ATTEMPTS})`);
        stopStream(slotId, apiKey, apiSecret, livekitHost).catch(() => {});
      });

      proc.on('error', (err) => {
        console.error(`[restream] Archive FFmpeg error for slot ${slotId}:`, err);
        // proc.on('close') will still fire after this, with a non-zero exit.
        // Let the close handler decide retry vs teardown — don't double-up.
      });

      return proc;
    }

    entry.archiveFfmpeg = spawnArchive();

    // Schedule slot-end complete-slot call. Mirrors the DJ-browser pattern
    // in src/app/broadcast/live/BroadcastClient.tsx: setTimeout at endTime
    // calls /api/broadcast/complete-slot, which atomically marks this slot
    // completed, activates the next slot (if any), and preserves the HLS
    // egress across the transition.
    if (appUrl && typeof endTime === 'number' && endTime > Date.now()) {
      const remainingMs = endTime - Date.now();
      console.log(`[restream] Slot-end timer scheduled ${Math.round(remainingMs / 1000)}s out for ${slotId}`);
      entry.slotEndTimer = setTimeout(async () => {
        // Worker could have restarted or /stop could have fired — bail if the
        // slot isn't our active entry anymore.
        if (activeStreams.get(slotId) !== entry) {
          console.log(`[restream] Slot-end timer fired but slot ${slotId} no longer active, skipping`);
          return;
        }
        console.log(`[restream] Slot ${slotId} reached endTime, calling complete-slot`);
        // Kill whatever FFmpeg is running so we stop publishing to LiveKit
        // promptly. Mark intentionalStop BEFORE killing so the close handler
        // doesn't treat this as a genuine failure and re-trigger teardown
        // (that would race with complete-slot → /stop below). Authoritative
        // teardown happens via complete-slot → cleanupSlotLiveKit → /stop.
        entry.intentionalStop = true;
        try { entry.archiveFfmpeg?.kill('SIGTERM'); } catch {}
        try { entry.silenceFfmpeg?.kill('SIGTERM'); } catch {}
        try {
          const resp = await fetch(`${appUrl}/api/broadcast/complete-slot`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify({ slotId }),
          });
          if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            console.error(`[restream] complete-slot returned ${resp.status} for ${slotId}: ${txt}`);
          }
        } catch (err) {
          console.error(`[restream] complete-slot call failed for ${slotId}:`, err?.message || err);
        }
      }, remainingMs);
    } else {
      console.log(`[restream] No slot-end timer for ${slotId} (appUrl=${!!appUrl}, endTime=${endTime})`);
    }

    return { slotId, ingressId };
  } catch (err) {
    console.error(`[restream] Failed to start for slot ${slotId}:`, err);
    // If we got as far as creating the ingress but failed before handing off
    // to ffmpeg, don't leak the ingress on the LiveKit side.
    if (ingressId) {
      try {
        const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
        await ingressClient.deleteIngress(ingressId);
      } catch { /* ignore */ }
    }
    throw err;
  }
}

function makeFfmpeg(source, rtmpTarget, options = {}) {
  // For HTTP sources (archive restreams), add reconnect flags. Without them,
  // FFmpeg will silently give up on any network hiccup mid-stream and exit
  // with code 0 as if the archive finished — we've seen this cut a 59-min
  // restream off at 36 min when Cloudflare dropped the connection.
  // Lavfi sources (silence padding) don't need these.
  const reconnectArgs = options.silence
    ? []
    : [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_delay_max', '5',
      ];
  const inputArgs = options.silence
    ? ['-re', '-f', 'lavfi', '-i', source]
    : ['-re', ...reconnectArgs, '-i', source];
  return spawn('ffmpeg', [
    ...inputArgs,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'flv',
    '-loglevel', 'warning',
    rtmpTarget,
  ]);
}

// POST /schedule — queue a restream to start at a future time. Used when the
// previous live slot ends EARLY (before the restream's startTime), so
// complete-slot can't activate the restream yet (it's not in-window). Worker
// holds a setTimeout and calls startSlot() when startTime arrives.
// Only used for restreams. Live broadcasts have their own DJ-browser queue.
app.post('/schedule', authenticate, async (req, res) => {
  const params = req.body;
  const { slotId, startTime } = params || {};

  if (!slotId || typeof startTime !== 'number') {
    return res.status(400).json({ error: 'Missing slotId or startTime' });
  }

  const now = Date.now();
  const delay = startTime - now;

  // If startTime already passed or is essentially now, just start immediately.
  if (delay <= 0) {
    console.log(`[restream] /schedule: startTime already passed for ${slotId}, starting immediately`);
    try {
      const result = await startSlot(params);
      return res.json({ success: true, ...result, wasScheduled: false });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({ error: err.message });
    }
  }

  // Refuse far-future schedules — cron will pick them up normally. This
  // endpoint is specifically for the "live ended early, restream is minutes
  // away" gap. Keep the window small so worker restart doesn't lose much.
  const MAX_SCHEDULE_MS = 15 * 60 * 1000; // 15 min
  if (delay > MAX_SCHEDULE_MS) {
    console.log(`[restream] /schedule: ${slotId} startTime is >15min out (${Math.round(delay / 1000)}s), refusing`);
    return res.status(400).json({ error: 'startTime too far in the future' });
  }

  // If already actively streaming, caller is confused — ignore.
  if (activeStreams.has(slotId)) {
    return res.status(409).json({ error: 'slot is already active' });
  }

  // If already pending, refresh with latest params rather than double-scheduling.
  const existing = pendingStarts.get(slotId);
  if (existing) {
    clearTimeout(existing.startTimer);
    console.log(`[restream] /schedule: replacing existing pending timer for ${slotId}`);
  }

  const startTimer = setTimeout(async () => {
    if (!pendingStarts.has(slotId)) {
      console.log(`[restream] Scheduled start fired but ${slotId} no longer pending, skipping`);
      return;
    }
    pendingStarts.delete(slotId);
    console.log(`[restream] Scheduled start firing for ${slotId}`);
    // Call BACK to Vercel's start-restream instead of calling startSlot()
    // directly here. start-restream does the full setup the worker's
    // /start alone doesn't: marks the slot live in Firestore, clears
    // restreamEgressId, starts the HLS egress. Without that, a
    // locally-fired startSlot would publish audio into the room but no
    // egress would be writing to R2 (the webhook's track_published
    // fallback is not reliable enough to depend on).
    try {
      const { appUrl } = params || {};
      if (!appUrl) {
        console.error(`[restream] Scheduled start: no appUrl in params for ${slotId}`);
        return;
      }
      const resp = await fetch(`${appUrl}/api/broadcast/start-restream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SHARED_SECRET}`,
        },
        body: JSON.stringify({ slotId }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.error(`[restream] Scheduled start-restream returned ${resp.status} for ${slotId}: ${txt}`);
      }
    } catch (err) {
      console.error(`[restream] Scheduled start-restream call failed for ${slotId}:`, err?.message || err);
    }
  }, delay);

  pendingStarts.set(slotId, { startTimer, params });
  console.log(`[restream] Scheduled start for ${slotId} in ${Math.round(delay / 1000)}s`);
  res.json({ success: true, slotId, wasScheduled: true, delayMs: delay });
});

app.post('/stop', authenticate, async (req, res) => {
  const { slotId, apiKey, apiSecret, livekitHost } = req.body;
  if (!slotId) {
    return res.status(400).json({ error: 'slotId required' });
  }

  // Clear any pending scheduled start — nothing was created on LiveKit yet.
  const pending = pendingStarts.get(slotId);
  if (pending) {
    clearTimeout(pending.startTimer);
    pendingStarts.delete(slotId);
    console.log(`[restream] /stop: cancelled pending scheduled start for ${slotId}`);
  }

  const stopped = await stopStream(slotId, apiKey, apiSecret, livekitHost);
  res.json({ success: true, slotId, wasActive: stopped, wasPending: !!pending });
});

app.get('/status', (req, res) => {
  const streams = {};
  for (const [slotId, stream] of activeStreams) {
    const archiveRunning = !!stream.archiveFfmpeg && !stream.archiveFfmpeg.killed;
    const silenceRunning = !!stream.silenceFfmpeg && !stream.silenceFfmpeg.killed;
    streams[slotId] = {
      archiveRunning,
      silenceRunning,
      ffmpegRunning: archiveRunning || silenceRunning,
      ingressId: stream.ingressId,
      slotEndScheduled: !!stream.slotEndTimer,
    };
  }
  const pending = {};
  for (const [slotId] of pendingStarts) {
    pending[slotId] = { scheduled: true };
  }
  res.json({ activeStreams: streams, pendingStarts: pending });
});

async function stopStream(slotId, apiKey, apiSecret, livekitHost) {
  const stream = activeStreams.get(slotId);
  if (!stream) return false;

  console.log(`[restream] Stopping slot ${slotId}`);

  // Clear the slot-end timer first so it can't fire against a slot that's
  // already being torn down (would POST to complete-slot for a stale slot).
  if (stream.slotEndTimer) {
    clearTimeout(stream.slotEndTimer);
    stream.slotEndTimer = null;
  }
  // Also clear any pending archive-retry timer; we're tearing down and
  // don't want a delayed respawn after teardown.
  if (stream.archiveRetryTimer) {
    clearTimeout(stream.archiveRetryTimer);
    stream.archiveRetryTimer = null;
  }

  // Mark the stop as intentional so the FFmpeg close handler doesn't treat
  // the kill as a failure and recursively re-call stopStream.
  stream.intentionalStop = true;

  // Kill both the archive FFmpeg and the silence pad FFmpeg (only one runs
  // at a time, but either could be active depending on slot progress).
  for (const key of ['archiveFfmpeg', 'silenceFfmpeg']) {
    const proc = stream[key];
    if (proc && !proc.killed) {
      try { proc.kill('SIGTERM'); } catch (e) {
        console.log(`[restream] Error killing ${key}: ${e.message}`);
      }
    }
  }

  if (stream.ingressId && apiKey && apiSecret && livekitHost) {
    try {
      const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
      await ingressClient.deleteIngress(stream.ingressId);
    } catch (e) {
      console.log(`[restream] Error deleting ingress: ${e.message}`);
    }
  }

  activeStreams.delete(slotId);
  console.log(`[restream] Stopped slot ${slotId}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Below: archive post-processing endpoints (/faststart, /normalize) — unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// POST /faststart - Move moov atom to front of MP4 for mobile streaming
// Called by webhook after recording egress completes
app.post('/faststart', authenticate, async (req, res) => {
  const { r2Key } = req.body;
  if (!r2Key) {
    return res.status(400).json({ error: 'r2Key required' });
  }

  console.log(`[faststart] Processing: ${r2Key}`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME;

  try {
    // Download
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    const body = Buffer.from(await resp.Body.transformToByteArray());
    console.log(`[faststart] Downloaded ${(body.length / 1024 / 1024).toFixed(1)}MB`);

    // Check if already faststart (moov before mdat)
    let offset = 0;
    while (offset < Math.min(body.length, 4096) - 8) {
      const size = body.readUInt32BE(offset);
      const type = body.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'moov') {
        console.log(`[faststart] Already has faststart, skipping`);
        return res.json({ success: true, skipped: true });
      }
      if (type === 'mdat') break;
      if (size < 8) break;
      offset += size;
    }

    // Process with ffmpeg
    const tmpIn = `/tmp/faststart-in.mp4`;
    const tmpOut = `/tmp/faststart-out.mp4`;
    writeFileSync(tmpIn, body);
    execSync(`ffmpeg -y -i ${tmpIn} -c copy -movflags +faststart ${tmpOut} 2>&1`);

    const outBuf = readFileSync(tmpOut);

    // Verify moov is now at front
    offset = 0;
    let verified = false;
    while (offset < Math.min(outBuf.length, 4096) - 8) {
      const size = outBuf.readUInt32BE(offset);
      const type = outBuf.slice(offset + 4, offset + 8).toString('ascii');
      if (type === 'moov') { verified = true; break; }
      if (type === 'mdat') break;
      if (size < 8) break;
      offset += size;
    }

    if (!verified) {
      unlinkSync(tmpIn);
      unlinkSync(tmpOut);
      return res.status(500).json({ error: 'moov not at front after processing' });
    }

    // Upload fixed file
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: r2Key,
      Body: outBuf,
      ContentType: 'video/mp4',
    }));

    unlinkSync(tmpIn);
    unlinkSync(tmpOut);
    console.log(`[faststart] Done: ${r2Key}`);
    res.json({ success: true, size: outBuf.length });
  } catch (err) {
    console.error(`[faststart] Failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /normalize - Two-pass loudnorm to -14 LUFS / -1.5 dBTP / LRA 11
// (linear=true preserves dynamic range when peaks allow). Additionally
// detects leading + trailing silence and stream-copies a single trimmed
// sibling that cuts both.
//
// Output files (originals NEVER touched):
//   <stem>-normalized-v2.<ext>          — loudness-normalized, full length
//   <stem>-normalized-v2-trimmed.<ext>  — same, with leading silence ≥1s
//                                         AND/OR trailing silence ≥2s at EOF
//                                         (past the 30-min mark) removed
//
// Skip-if-already-correct: when input is in target band (I ∈ [-15, -13]
// AND TP ≤ -1.0), no v2 is written. Callback gets { skipped: true }.
//
// Returns:
//   { success: true, newUrl, trimmedUrl?, durationSec, trimmedDurationSec?,
//     measurements: { inputI, inputTP, inputLRA, outputI, outputTP, outputLRA,
//                     leadingSilenceEndSec?, leadingSilenceLengthSec?,
//                     trailingSilenceStartSec?, trailingSilenceLengthSec? } }
app.post('/normalize', authenticate, async (req, res) => {
  const { r2Key, callbackUrl, callbackContext } = req.body;
  if (!r2Key) return res.status(400).json({ error: 'r2Key required' });

  // Async-by-callback mode: when the caller passes callbackUrl, respond 202
  // immediately and do the job in the background, then POST the result to
  // callbackUrl. This lets Vercel-hosted callers trigger the job without
  // keeping a fetch handle alive for the 60-180s duration (their serverless
  // instance can be recycled the moment they return a response to the user).
  //
  // Synchronous mode: no callbackUrl → await the full job and return the
  // result in the HTTP response. The live-recording webhook uses this mode.
  const isAsyncMode = !!callbackUrl;
  if (isAsyncMode) {
    res.status(202).json({ accepted: true, r2Key });
  }

  // respond() collapses "send HTTP response" + "fire callback" into one call.
  // In async mode we've already sent the HTTP response above; headersSent
  // guards against double-writes.
  const fireCallback = (payload) => {
    if (!callbackUrl) return;
    // Reuse the same bearer token the worker accepts on inbound requests.
    // In prod this is SHARED_SECRET; CRON_SECRET is the Vercel-side name for
    // the same value (both env names fall through to the same SHARED_SECRET
    // constant declared at the top of this file).
    const secret = SHARED_SECRET;
    if (!secret) {
      console.warn(`[normalize] callbackUrl set but SHARED_SECRET missing; skipping callback`);
      return;
    }
    fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secret}`,
      },
      body: JSON.stringify({ ...payload, callbackContext }),
    })
      .then((r) => {
        if (!r.ok) {
          console.error(`[normalize] callback to ${callbackUrl} returned ${r.status}`);
        } else {
          console.log(`[normalize] callback delivered to ${callbackUrl}`);
        }
      })
      .catch((e) => console.error(`[normalize] callback to ${callbackUrl} failed:`, e?.message || e));
  };
  const respond = (status, payload) => {
    if (!res.headersSent) res.status(status).json(payload);
    fireCallback(payload);
  };

  // Format detection. Each branch controls the re-encode args + content-type
  // + output-key suffix below. Reject anything else rather than guessing —
  // the MP4 branch would corrupt a WAV/FLAC/M4A by forcing ContentType video/mp4.
  let format;
  if (/\.mp4$/i.test(r2Key)) format = 'mp4';
  else if (/\.mp3$/i.test(r2Key)) format = 'mp3';
  else {
    return respond(400, {
      error: `Unsupported format for normalize: ${r2Key}. Only .mp4 and .mp3 are handled.`,
    });
  }

  console.log(`[normalize] Processing: ${r2Key} (format=${format})`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL || '';

  const tmpIn = `/tmp/normalize-in-${Date.now()}.${format}`;
  const tmpOut = `/tmp/normalize-out-${Date.now()}.${format}`;
  const tmpTrimmed = `/tmp/normalize-trimmed-${Date.now()}.${format}`;

  // Loudness target — calibrated against 45-show audit + canary runs:
  //   -14 LUFS / -1.5 dBTP / LRA 11, linear=true (no dynamic compression
  //   when source allows). Spotify/YouTube playback floor.
  const TARGET_I = -14;
  const TARGET_TP = -1.5;
  const TARGET_LRA = 11;

  // Trailing-silence trim policy:
  //   Scan last 15 min only. Only treat as trimmable if silence runs
  //   continuously to EOF AND is ≥ MIN_TRAILING_SILENCE_SEC. Don't truncate
  //   if the silence starts inside the first 30 min (would indicate a
  //   broken file, not a DJ leaving dead air at the end).
  const MIN_TRAILING_SILENCE_SEC = 1;
  const SAFETY_TAIL_SEC = 0.5; // keep last 0.5s of music to avoid cutting a tail

  // Leading-silence trim policy:
  //   Scan the first LEADING_PROBE_SEC of output. Only trim if silence starts
  //   within the first 0.2s (real "head silence") AND lasts ≥
  //   MIN_LEADING_SILENCE_SEC. No 30-min-style guard — leading silence is
  //   always at the very head regardless of show length. No safety margin —
  //   we WANT audio to start immediately when the DJ comes in.
  const MIN_LEADING_SILENCE_SEC = 1;
  const LEADING_PROBE_SEC = 20;

  try {
    // --- 1. Download ---
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    const body = Buffer.from(await resp.Body.transformToByteArray());
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
    // Save CPU + R2 storage when the file is already at the right level.
    const ALREADY_CORRECT_I_MIN = -15;
    const ALREADY_CORRECT_I_MAX = -13;
    const ALREADY_CORRECT_TP_MAX = -1.0;
    if (
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
    const encodeArgs = format === 'mp3'
      ? '-c:a libmp3lame -b:a 192k'
      : '-c:a aac -b:a 192k -movflags +faststart';
    execSync(
      `ffmpeg -hide_banner -nostats -y -i ${tmpIn} -vn -af "${filter}" ${encodeArgs} ${tmpOut} 2>&1`
    );

    // --- 5. Verify output loudness ---
    // Use spawn-with-streaming so per-frame ebur128 output flows through but
    // only the trailing Summary block is retained in memory. Avoids the
    // ENOBUFS that killed execSync on 2hr files, and avoids the older VPS
    // ffmpeg's rejection of framelog=quiet. We keep ~64KB of stderr tail —
    // more than enough for the Summary block (~400 bytes).
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
    // Two scans on the normalized output (post-loudnorm so the threshold is
    // meaningful). Wrapped: detection failure must not block the v2 upload.
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
        // Scan first LEADING_PROBE_SEC. silencedetect d=0.3 so 1s+ runs register
        // reliably. Only count when silence_start ≤ 0.2s (real head silence).
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
          // If leadEnd is missing, silence ran past LEADING_PROBE_SEC — that's
          // almost certainly a broken file. Don't trim; let it ship as v2.
        }

        // --- 6b. Trailing silence ---
        // Scan last 15 min. silencedetect d=1.5 so 2s+ runs register reliably.
        // Only treat as trimmable if it runs continuously to EOF AND lastStart
        // is past the 30-min mark.
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

    // --- 7. Upload v2 (normalized, untrimmed) ---
    const v2Suffix = `-normalized-v2.${format}`;
    const v2Key = format === 'mp3'
      ? r2Key.replace(/\.mp3$/i, v2Suffix)
      : r2Key.replace(/\.mp4$/i, v2Suffix);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: v2Key,
      Body: readFileSync(tmpOut),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const v2Url = publicBase ? `${publicBase}/${v2Key}` : null;
    console.log(`[normalize] Uploaded v2: ${v2Key}`);

    // --- 8. If leading and/or trailing silence: stream-copy a single trimmed
    // sibling and upload. Wrapped in its own try/catch so a trim failure
    // doesn't lose the v2 upload that already succeeded — caller still gets
    // the v2 URL.
    let trimmedKey = null;
    let trimmedUrl = null;
    let trimmedDurationSec = null;
    const hasLeading = leadingSilenceEndSec !== null;
    const hasTrailing = trailingSilenceStartSec !== null;
    if (hasLeading || hasTrailing) {
      try {
        const ssArg = hasLeading ? `-ss ${leadingSilenceEndSec.toFixed(3)} ` : '';
        const toArg = hasTrailing
          ? `-to ${Math.max(0, trailingSilenceStartSec - SAFETY_TAIL_SEC).toFixed(3)} `
          : '';
        const movflags = format === 'mp4' ? '-movflags +faststart' : '';
        execSync(
          `ffmpeg -hide_banner -nostats -y ${ssArg}-i ${tmpOut} ${toArg}-c copy -avoid_negative_ts make_zero ${movflags} ${tmpTrimmed} 2>&1`
        );
        const trimProbe = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 ${tmpTrimmed}`,
          { encoding: 'utf-8' }
        );
        trimmedDurationSec = parseFloat(trimProbe.trim()) || 0;
        const trimmedSuffix = `-normalized-v2-trimmed.${format}`;
        trimmedKey = format === 'mp3'
          ? r2Key.replace(/\.mp3$/i, trimmedSuffix)
          : r2Key.replace(/\.mp4$/i, trimmedSuffix);
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: trimmedKey,
          Body: readFileSync(tmpTrimmed),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        trimmedUrl = publicBase ? `${publicBase}/${trimmedKey}` : null;
        const kinds = [hasLeading && 'leading', hasTrailing && 'trailing'].filter(Boolean).join('+');
        console.log(`[normalize] Uploaded v2-trimmed (${kinds}): ${trimmedKey} (${trimmedDurationSec.toFixed(1)}s)`);
      } catch (trimErr) {
        // Non-fatal: v2 (untrimmed) is already uploaded and will be the
        // active URL. Silence stays in the file. Log + continue.
        console.error(`[normalize] Trim step failed; keeping untrimmed v2:`, trimErr?.message || trimErr);
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
      },
    });
  } catch (err) {
    [tmpIn, tmpOut, tmpTrimmed].forEach(p => { try { unlinkSync(p); } catch {} });
    console.error(`[normalize] Failed:`, err);
    respond(500, { error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[restream-worker] Listening on port ${PORT}`);
});
