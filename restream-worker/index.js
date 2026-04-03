import express from 'express';
import { spawn, execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { Room, RoomEvent, LocalAudioTrack, AudioSource, AudioFrame } from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3100;
const SHARED_SECRET = process.env.SHARED_SECRET || '';

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

    ffmpeg.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameData = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);

        const samples = new Int16Array(
          frameData.buffer,
          frameData.byteOffset,
          SAMPLES_PER_FRAME * NUM_CHANNELS
        );
        const frame = new AudioFrame(samples, SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME);
        audioSource.captureFrame(frame);
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

app.listen(PORT, () => {
  console.log(`[restream-worker] Listening on port ${PORT}`);
});
