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
  const { slotId, archiveUrl, roomName, apiKey, apiSecret, livekitHost } = req.body;

  if (!slotId || !archiveUrl || !roomName || !apiKey || !apiSecret || !livekitHost) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (activeStreams.has(slotId)) {
    await stopStream(slotId, apiKey, apiSecret, livekitHost);
  }

  let ingressId = null;
  try {
    console.log(`[restream] Starting for slot ${slotId}, url: ${archiveUrl}`);

    const ingressClient = new IngressClient(livekitHost, apiKey, apiSecret);
    const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
      name: `restream-${slotId}`,
      roomName,
      participantIdentity: `restream-${slotId}`,
      participantName: 'Restream',
    });
    ingressId = ingress.ingressId;
    const rtmpTarget = `${ingress.url}/${ingress.streamKey}`;
    console.log(`[restream] Ingress created: ${ingressId}, rtmp=${ingress.url}/<key>`);

    // -re reads the input at its native frame rate so the audio streams in
    // realtime (not as fast as FFmpeg can decode). -c:a aac matches what
    // LiveKit ingress expects, 128k gives us clean quality without bloat.
    // We re-encode (not copy) because source MP4s may use sample rates or
    // channel layouts the ingress rejects.
    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-i', archiveUrl,
      '-vn',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'flv',
      '-loglevel', 'warning',
      rtmpTarget,
    ]);

    ffmpeg.stderr.on('data', (data) => {
      console.log(`[restream][ffmpeg ${slotId}] ${data.toString().trim()}`);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[restream] FFmpeg exited with code ${code} for slot ${slotId}`);
      // Cleanup ingress when ffmpeg finishes — we don't need it hanging around.
      stopStream(slotId, apiKey, apiSecret, livekitHost).catch(() => {});
    });

    ffmpeg.on('error', (err) => {
      console.error(`[restream] FFmpeg error for slot ${slotId}:`, err);
      stopStream(slotId, apiKey, apiSecret, livekitHost).catch(() => {});
    });

    activeStreams.set(slotId, { ffmpeg, ingressId });

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
    streams[slotId] = {
      ffmpegRunning: !stream.ffmpeg.killed,
      ingressId: stream.ingressId,
    };
  }
  res.json({ activeStreams: streams });
});

async function stopStream(slotId, apiKey, apiSecret, livekitHost) {
  const stream = activeStreams.get(slotId);
  if (!stream) return false;

  console.log(`[restream] Stopping slot ${slotId}`);

  try {
    if (stream.ffmpeg && !stream.ffmpeg.killed) {
      stream.ffmpeg.kill('SIGTERM');
    }
  } catch (e) {
    console.log(`[restream] Error killing ffmpeg: ${e.message}`);
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

// POST /normalize - Measure MP4 loudness and apply safe uniform gain if broken capture.
// Uploads a NEW file with "-normalized-v1.mp4" suffix — original R2 key is NEVER overwritten.
// Returns { skipped, reason } if file doesn't need normalizing, or { newR2Key, newUrl, gainDb, measurements }.
app.post('/normalize', authenticate, async (req, res) => {
  const { r2Key } = req.body;
  if (!r2Key) return res.status(400).json({ error: 'r2Key required' });

  console.log(`[normalize] Processing: ${r2Key}`);

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

  const tmpIn = `/tmp/normalize-in-${Date.now()}.mp4`;
  const tmpOut = `/tmp/normalize-out-${Date.now()}.mp4`;
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
      return res.json({ skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    if (truePeak > MIN_PEAK_HEADROOM) {
      [tmpIn, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `True peak ${truePeak} dBFS > ${MIN_PEAK_HEADROOM} (already well-mastered or clipping).`;
      console.log(`[normalize] SKIP: ${reason}`);
      return res.json({ skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    // --- 5. Compute safe gain (linear, no limiter) ---
    const desiredGain = TARGET_LUFS - integratedLufs;
    const maxSafeGain = TARGET_PEAK_CEILING - truePeak;
    const gainDb = Math.min(desiredGain, maxSafeGain);

    if (gainDb <= 0.5) {
      [tmpIn, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });
      const reason = `Computed gain ${gainDb.toFixed(2)} dB is negligible.`;
      console.log(`[normalize] SKIP: ${reason}`);
      return res.json({ skipped: true, reason, measurements: { integratedLufs, truePeak, lra, percentBelow20 } });
    }

    console.log(`[normalize] Applying +${gainDb.toFixed(2)} dB gain (no limiter)`);

    // --- 6. Apply gain, re-encode, write to NEW R2 key ---
    execSync(
      `ffmpeg -y -i ${tmpIn} -af "volume=${gainDb.toFixed(2)}dB" -c:a aac -b:a 192k -movflags +faststart ${tmpOut} 2>&1`
    );
    const outBuf = readFileSync(tmpOut);

    const newR2Key = r2Key.replace(/\.mp4$/, '-normalized-v1.mp4');
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: newR2Key,
      Body: outBuf,
      ContentType: 'video/mp4',
    }));

    [tmpIn, tmpOut, tmpMeta].forEach(p => { try { unlinkSync(p); } catch {} });

    const newUrl = publicBase ? `${publicBase}/${newR2Key}` : null;
    console.log(`[normalize] Done: ${newR2Key} (+${gainDb.toFixed(2)} dB)`);
    res.json({
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
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[restream-worker] Listening on port ${PORT}`);
});
