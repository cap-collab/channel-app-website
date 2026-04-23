import express from 'express';
import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { IngressClient, IngressInput } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3100;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.CRON_SECRET || '';

// Active restreams keyed by slotId. Each value: { ffmpeg, ingressId }.
const activeStreams = new Map();

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
  const { slotId, archiveUrl, roomName, apiKey, apiSecret, livekitHost, appUrl, endTime } = req.body;

  if (!slotId || !archiveUrl || !roomName || !apiKey || !apiSecret || !livekitHost) {
    return res.status(400).json({ error: 'Missing required fields' });
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

    // Spawn the archive FFmpeg. Pure HTTP GET on the archive URL — never
    // writes back to the source MP4.
    const archiveFfmpeg = makeFfmpeg(archiveUrl, rtmpTarget);
    archiveFfmpeg.stderr.on('data', (data) => {
      console.log(`[restream][ffmpeg ${slotId}] ${data.toString().trim()}`);
    });

    // intentionalStop === true when stopStream or the slot-end timer killed
    // FFmpeg on purpose. Checking this is more reliable than trying to
    // interpret Node's exit code/signal — SIGTERM often surfaces as code 255
    // with signal=null depending on how FFmpeg responds to the signal.
    const entry = { archiveFfmpeg, silenceFfmpeg: null, ingressId, slotEndTimer: null, intentionalStop: false };
    activeStreams.set(slotId, entry);

    archiveFfmpeg.on('close', (code, signal) => {
      console.log(`[restream] Archive FFmpeg exited code=${code} signal=${signal} intentional=${entry.intentionalStop} for slot ${slotId}`);
      if (entry.intentionalStop) {
        // We killed it on purpose (stopStream / slot-end timer). Caller
        // owns the teardown; do nothing here.
        return;
      }
      if (code === 0) {
        // Archive finished on its own. Pad with silence until slot-end fires.
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
      } else {
        // Non-zero exit that wasn't our doing = genuine failure. Tear down.
        console.error(`[restream] Archive FFmpeg failed for slot ${slotId}, tearing down`);
        stopStream(slotId, apiKey, apiSecret, livekitHost).catch(() => {});
      }
    });

    archiveFfmpeg.on('error', (err) => {
      console.error(`[restream] Archive FFmpeg error for slot ${slotId}:`, err);
      stopStream(slotId, apiKey, apiSecret, livekitHost).catch(() => {});
    });

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

    res.json({ success: true, slotId, ingressId });
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
    res.status(500).json({ error: err.message });
  }
});

function makeFfmpeg(source, rtmpTarget, options = {}) {
  const inputArgs = options.silence
    ? ['-re', '-f', 'lavfi', '-i', source]
    : ['-re', '-i', source];
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

app.post('/stop', authenticate, async (req, res) => {
  const { slotId, apiKey, apiSecret, livekitHost } = req.body;
  if (!slotId) {
    return res.status(400).json({ error: 'slotId required' });
  }

  const stopped = await stopStream(slotId, apiKey, apiSecret, livekitHost);
  res.json({ success: true, slotId, wasActive: stopped });
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
  res.json({ activeStreams: streams });
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

// POST /normalize - Measure loudness and apply safe uniform gain if broken capture.
// Supports MP4 (live recordings, in-place AAC+faststart) and MP3 (DJ uploads, libmp3lame).
// Uploads a NEW file with "-normalized-v1.<ext>" suffix — original R2 key is NEVER overwritten.
// Returns { skipped, reason } if file doesn't need normalizing, or { newR2Key, newUrl, gainDb, measurements }.
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
  const tmpMeta = `/tmp/normalize-meta-${Date.now()}.txt`;

  try {
    // --- 1. Download ---
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    const body = Buffer.from(await resp.Body.transformToByteArray());
    writeFileSync(tmpIn, body);
    console.log(`[normalize] Downloaded ${(body.length / 1024 / 1024).toFixed(1)}MB`);

    // --- 2. Measure integrated LUFS and true peak ---
    const loudnormOut = execSync(
      `ffmpeg -hide_banner -nostats -i ${tmpIn} -af "loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json" -f null - 2>&1 | awk '/^{/,/^}/'`,
      { encoding: 'utf-8' }
    );
    const measurements = JSON.parse(loudnormOut);
    const integratedLufs = parseFloat(measurements.input_i);
    const truePeak = parseFloat(measurements.input_tp);
    const lra = parseFloat(measurements.input_lra);

    console.log(`[normalize] Measured: LUFS=${integratedLufs} TP=${truePeak} LRA=${lra}`);

    // --- 3. Measure momentary loudness distribution ---
    execSync(
      `ffmpeg -hide_banner -nostats -i ${tmpIn} -filter_complex "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=${tmpMeta}" -f null - 2>&1`
    );
    const metaContent = readFileSync(tmpMeta, 'utf-8');
    const momentaryVals = [];
    const re = /r128\.M=(-?\d+\.\d+|-inf)/g;
    let m;
    while ((m = re.exec(metaContent)) !== null) {
      if (m[1] !== '-inf') momentaryVals.push(parseFloat(m[1]));
    }
    const nSamples = momentaryVals.length;
    const countBelow20 = momentaryVals.filter(v => v <= -20).length;
    const percentBelow20 = nSamples > 0 ? (100 * countBelow20 / nSamples) : 0;

    console.log(`[normalize] ${percentBelow20.toFixed(1)}% of track below -20 LUFS`);

    // --- 4. Decide whether to boost ---
    // Only boost if majority of track is uniformly quiet AND headroom available
    const MIN_PERCENT_BELOW_20 = 80;
    const MIN_PEAK_HEADROOM = -3.0;
    const TARGET_LUFS = -16; // conservative target (lower than -14 so we don't overshoot without a limiter)
    const TARGET_PEAK_CEILING = -1.0;

    if (percentBelow20 < MIN_PERCENT_BELOW_20) {
      [tmpIn, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `Only ${percentBelow20.toFixed(1)}% below -20 LUFS (threshold ${MIN_PERCENT_BELOW_20}%). Likely intentional dynamics.`;
      console.log(`[normalize] SKIP: ${reason}`);
      return respond(200, { skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    if (truePeak > MIN_PEAK_HEADROOM) {
      [tmpIn, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `True peak ${truePeak} dBFS > ${MIN_PEAK_HEADROOM} (already well-mastered or clipping).`;
      console.log(`[normalize] SKIP: ${reason}`);
      return respond(200, { skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    // --- 5. Compute safe gain (linear, no limiter) ---
    const desiredGain = TARGET_LUFS - integratedLufs;
    const maxSafeGain = TARGET_PEAK_CEILING - truePeak;
    const gainDb = Math.min(desiredGain, maxSafeGain);

    if (gainDb <= 0.5) {
      [tmpIn, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `Computed gain ${gainDb.toFixed(2)} dB is negligible.`;
      console.log(`[normalize] SKIP: ${reason}`);
      return respond(200, { skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    console.log(`[normalize] Applying +${gainDb.toFixed(2)} dB gain (no limiter)`);

    // --- 6. Apply gain, re-encode, write to NEW R2 key ---
    // Format-aware encode. MP4: AAC + faststart so mobile players start
    // progressively. MP3: libmp3lame, byte-range streamable by default.
    const encodeArgs = format === 'mp3'
      ? '-c:a libmp3lame -b:a 192k'
      : '-c:a aac -b:a 192k -movflags +faststart';
    execSync(
      `ffmpeg -y -i ${tmpIn} -af "volume=${gainDb.toFixed(2)}dB" ${encodeArgs} ${tmpOut} 2>&1`
    );
    const outBuf = readFileSync(tmpOut);

    const suffix = `-normalized-v1.${format}`;
    const newR2Key = format === 'mp3'
      ? r2Key.replace(/\.mp3$/i, suffix)
      : r2Key.replace(/\.mp4$/i, suffix);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'video/mp4';
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: newR2Key,
      Body: outBuf,
      ContentType: contentType,
    }));

    [tmpIn, tmpOut, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });

    const newUrl = publicBase ? `${publicBase}/${newR2Key}` : null;
    console.log(`[normalize] Done: ${newR2Key} (+${gainDb.toFixed(2)} dB)`);
    respond(200, {
      success: true,
      skipped: false,
      originalR2Key: r2Key,
      newR2Key,
      newUrl,
      gainDb: Number(gainDb.toFixed(2)),
      measurements: { integratedLufs, truePeak, lra, percentBelow20 },
    });
  } catch (err) {
    [tmpIn, tmpOut, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
    console.error(`[normalize] Failed:`, err);
    respond(500, { error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[restream-worker] Listening on port ${PORT}`);
});
