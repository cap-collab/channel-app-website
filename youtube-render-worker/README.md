# youtube-render-worker (Social Render worker)

Renders archived mixes into platform-ready outputs:
- **YouTube** — 1920×1080 H.264/AAC mp4 (page screenshot or video capture +
  source-mix audio muxed in).
- **SoundCloud** — 1500×1500 JPG cover (`?variant=square` page screenshot)
  + lossless `.m4a` audio (stream-copied AAC out of the source mp4 — no
  re-encode, ~6000× real-time).

Each output is gated on the DJ's per-platform opt-in (`djProfile.youtubeOptIn`,
`djProfile.soundcloudOptIn`); the worker reads the snapshots from the job
doc and skips entire phases when a platform is off. The folder name is
historical — internally this is the **Social Render** tab in the admin UI.

Mirrors the resilience patterns of `restream-worker/` (Express + Bearer auth,
async-by-callback, ffmpeg reconnect + initial-connect retry, watchdog
timeout, /tmp cleanup, on-boot zombie cleanup).

**Must run on a separate VPS from `restream-worker/`.** Live broadcasts use
restream-worker; resource isolation is the safety net. Renders can run any
time — including during a live — once the workers are on separate boxes.

## Deploy (Hetzner VPS)

Spin up a small Hetzner CX21 (2 vCPU / 4GB) — comfortably fits one render
at a time. CX22/CX31 if you want headroom or parallelism later.

```bash
# 1. SSH into the new VPS
ssh root@<new-vps-ip>

# 2. Install Docker (if not present)
curl -fsSL https://get.docker.com | sh

# 3. Clone this repo (or scp just the youtube-render-worker/ dir)
git clone https://github.com/cap-collab/channel-app-website.git
cd channel-app-website/youtube-render-worker

# 4. Build the image
docker build -t youtube-render-worker:latest .

# 5. Create an env file (DO NOT commit). Copy from your password manager.
cat > /root/.youtube-render-worker.env <<'EOF'
SHARED_SECRET=<same value as Vercel's SHARED_SECRET / CRON_SECRET>
APP_URL=https://channel-app.com
PORT=3101

# R2 — same values restream-worker uses
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=channel-broadcast
R2_PUBLIC_URL=https://media.channel-app.com

# Firebase Admin service account JSON (entire file as a single-line string).
# Generate at: Firebase console → Project settings → Service accounts → Generate new private key.
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...",...}
EOF
chmod 600 /root/.youtube-render-worker.env

# 6. Run it
docker run -d \
  --name youtube-render-worker \
  --restart unless-stopped \
  -p 3101:3101 \
  --env-file /root/.youtube-render-worker.env \
  youtube-render-worker:latest

# 7. Tail logs to confirm it booted
docker logs -f youtube-render-worker
# Expect: "[youtube-render-worker] Listening on port 3101"
```

## Wire it to Vercel

In the Vercel project's environment variables, set:

```
YOUTUBE_RENDER_WORKER_URL=http://<new-vps-ip>:3101
```

`SHARED_SECRET` and the R2 vars should already be set (used by
restream-worker). The Vercel `/api/youtube-render/jobs` route reads
`YOUTUBE_RENDER_WORKER_URL` to know where to forward `/start` calls.

## Health check

```bash
curl http://<vps-ip>:3101/status -H "Authorization: Bearer $SHARED_SECRET"
# {"activeJobs":{},"uptime":123.45}
```

(Note: `/status` requires the same Bearer auth as `/start`.)

## Updating

```bash
cd /root/channel-app-website
git pull
cd youtube-render-worker
docker build -t youtube-render-worker:latest .
docker stop youtube-render-worker && docker rm youtube-render-worker
docker run -d \
  --name youtube-render-worker \
  --restart unless-stopped \
  -p 3101:3101 \
  --env-file /root/.youtube-render-worker.env \
  youtube-render-worker:latest
```

In-flight jobs are dropped on restart (in-memory state is lost). Boot-time
zombie cleanup re-marks any orphaned `status: rendering` jobs (older than 4h)
as `failed` so the queue doesn't lie. Jobs marked `failed` can be re-run
from the admin UI by submitting again.

## Resource sizing

- One concurrent render holds ~1 vCPU + ~700MB RAM (Chromium + Node + ffmpeg).
- A 1-hour mix takes ~1 hour of capture + ~1-2 min of ffmpeg muxing + a few
  seconds of R2 upload. So total ≈ real-time.
- For more parallelism: scale up to a CX31 (4 vCPU / 8GB) and run 2-3
  containers on different ports, or replicate this VPS.
