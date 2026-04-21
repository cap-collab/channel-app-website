import express from 'express';
import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { Room, RoomEvent, LocalAudioTrack, AudioSource, AudioFrame } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3100;
const SHARED_SECRET = process.env.SHARED_SECRET || process.env.CRON_SECRET || '';

// Active restreams keyed by slotId
const activeStreams = new Map();

// Auth middleware
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!SHARED_SECRET || auth !== `Bearer ${SHARED_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/start', authenticate, async (req, res) => {
  const { slotId, archiveUrl, roomName, apiKey, apiSecret, wsUrl } = req.body;

  if (!slotId || !archiveUrl || !roomName || !apiKey || !apiSecret || !wsUrl) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Stop existing stream for this slot if any
  if (activeStreams.has(slotId)) {
    await stopStream(slotId);
  }

  try {
    console.log(`[restream] Starting for slot ${slotId}, url: ${archiveUrl}`);

    // Generate token with publish permissions
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `restream-${slotId}`,
      name: 'Restream',
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: false,
    });
    const jwt = await token.toJwt();

    // Create audio source (48kHz stereo)
    const SAMPLE_RATE = 48000;
    const NUM_CHANNELS = 2;
    const audioSource = new AudioSource(SAMPLE_RATE, NUM_CHANNELS);

    // Create room and connect
    const room = new Room();

    room.on(RoomEvent.Disconnected, () => {
      console.log(`[restream] Disconnected from room for slot ${slotId}`);
    });

    await room.connect(wsUrl, jwt, { autoSubscribe: false });
    console.log(`[restream] Connected to room ${roomName} as restream-${slotId}`);

    // Publish audio track
    const track = LocalAudioTrack.createAudioTrack('restream-audio', audioSource);
    const publication = await room.localParticipant.publishTrack(track, {
      source: 1, // TrackSource.MICROPHONE
    });
    console.log(`[restream] Published audio track: ${publication.sid}`);

    // Start FFmpeg to decode MP4 to raw PCM (48kHz, stereo, s16le)
    const ffmpeg = spawn('ffmpeg', [
      '-i', archiveUrl,
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(NUM_CHANNELS),
      '-loglevel', 'warning',
      '-',
    ]);

    ffmpeg.stderr.on('data', (data) => {
      console.log(`[restream][ffmpeg] ${data.toString().trim()}`);
    });

    // Feed PCM data to audio source in 10ms frames
    const FRAME_DURATION_MS = 10;
    const SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_DURATION_MS / 1000; // 480 samples
    const BYTES_PER_FRAME = SAMPLES_PER_FRAME * NUM_CHANNELS * 2; // 16-bit = 2 bytes per sample

    let buffer = Buffer.alloc(0);

    // captureFrame is async and applies backpressure via its internal queue.
    // If we fire-and-forget in a tight loop, the queue overflows and throws
    // "InvalidState - failed to capture frame", crashing the process. Pause
    // ffmpeg's stdout while we drain the current buffer so LiveKit has time
    // to consume frames.
    ffmpeg.stdout.on('data', async (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < BYTES_PER_FRAME) return;

      ffmpeg.stdout.pause();
      try {
        while (buffer.length >= BYTES_PER_FRAME) {
          const frameData = buffer.subarray(0, BYTES_PER_FRAME);
          buffer = buffer.subarray(BYTES_PER_FRAME);

          // Copy samples into a fresh Int16Array rather than a view into
          // ffmpeg's incoming buffer — otherwise the underlying memory can be
          // reused/overwritten before LiveKit consumes the frame, yielding
          // silent audio in the published track.
          const samples = new Int16Array(SAMPLES_PER_FRAME * NUM_CHANNELS);
          Buffer.from(samples.buffer).set(frameData);
          const frame = new AudioFrame(samples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
          await audioSource.captureFrame(frame);
        }
      } catch (err) {
        console.error(`[restream] captureFrame failed for slot ${slotId}:`, err.message);
        stopStream(slotId);
        return;
      } finally {
        ffmpeg.stdout.resume();
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(`[restream] FFmpeg exited with code ${code} for slot ${slotId}`);
      stopStream(slotId);
    });

    ffmpeg.on('error', (err) => {
      console.error(`[restream] FFmpeg error for slot ${slotId}:`, err);
      stopStream(slotId);
    });

    activeStreams.set(slotId, { room, ffmpeg, track, audioSource });

    res.json({ success: true, slotId, identity: `restream-${slotId}` });
  } catch (err) {
    console.error(`[restream] Failed to start for slot ${slotId}:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', authenticate, async (req, res) => {
  const { slotId } = req.body;
  if (!slotId) {
    return res.status(400).json({ error: 'slotId required' });
  }

  const stopped = await stopStream(slotId);
  res.json({ success: true, slotId, wasActive: stopped });
});

app.get('/status', (req, res) => {
  const streams = {};
  for (const [slotId, stream] of activeStreams) {
    streams[slotId] = {
      connected: stream.room.connectionState === 'connected',
      ffmpegRunning: !stream.ffmpeg.killed,
    };
  }
  res.json({ activeStreams: streams });
});

async function stopStream(slotId) {
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

  try {
    if (stream.room) {
      await stream.room.disconnect();
    }
  } catch (e) {
    console.log(`[restream] Error disconnecting room: ${e.message}`);
  }

  activeStreams.delete(slotId);
  console.log(`[restream] Stopped slot ${slotId}`);
  return true;
}

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
