#!/usr/bin/env bash
# ============================================================================
# STAGE A — Upgrade livekit-server 1.9.9 -> v1.13.2   (RUN ON VPS root@5.161.252.231)
# ONLY in a long idle window (no show for >=3h after). Recreates the `livekit`
# container only; ingress/egress/redis are restarted (not recreated) after.
# HEAVY LOGGING: everything tees to a timestamped logfile for later deep review.
# ============================================================================
set -uo pipefail   # NOT -e: we want to log failures, not abort silently

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/root/livekit-upgrade-A-${TS}.log"
BACKUP="/root/livekit-inspect-backup-${TS}.json"
NEW_IMAGE="livekit/livekit-server:v1.13.2"
OLD_DIGEST="sha256:d8b1107d9234af8c84f5f219e02401fc176023a3564dab1550c6d14befa596de"  # v1.9.9 rollback ref
APP="https://channel-app.com"
exec > >(tee -a "$LOG") 2>&1   # tee ALL stdout+stderr to logfile
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

log "===== STAGE A start. Log -> $LOG ====="

log "--- [0] Pre-flight: room MUST be idle ---"
ROOM=$(curl -s --max-time 15 "$APP/api/livekit/room-status?room=channel-radio")
log "room-status: $ROOM"
echo "$ROOM" | grep -q '"isLive":false' || { log "ABORT: isLive not false"; exit 1; }
EG=$(curl -s --max-time 15 "$APP/api/livekit/egress?room=channel-radio")
log "egress-list: $EG"
echo "$EG" | grep -qE '"status":[[:space:]]*[01][^0-9]' && { log "ABORT: an egress is STARTING/ACTIVE"; exit 1; }
log "OK: room idle, no active egress."

log "--- [1] Backup current livekit config + record digests ---"
docker inspect livekit > "$BACKUP" && log "saved inspect -> $BACKUP"
log "current livekit image: $(docker inspect livekit --format '{{.Image}}')  (rollback ref = $OLD_DIGEST)"
cp -a /opt/livekit/livekit.yaml "/root/livekit.yaml.pre-A-${TS}.bak" && log "backed up livekit.yaml"

log "--- [2] Record sibling state BEFORE (to prove they survive) ---"
for c in egress ingress redis restream-worker; do
  log "  $c BEFORE: $(docker inspect $c --format '{{.Id}} img={{.Image}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || echo MISSING)"
done

log "--- [3] Pull pinned $NEW_IMAGE (non-destructive) ---"
docker pull "$NEW_IMAGE" || { log "ABORT: pull failed"; exit 1; }
NEW_DIGEST=$(docker image inspect "$NEW_IMAGE" --format '{{.Id}}')
log "pulled digest: $NEW_DIGEST"
log "verify version label: $(docker image inspect "$NEW_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.version"}}')"

log "--- [4] Verify config file present before stopping anything ---"
[ -f /opt/livekit/livekit.yaml ] || { log "ABORT: /opt/livekit/livekit.yaml missing"; exit 1; }

log "--- [5] STOP + REMOVE only the livekit container ---"
docker stop livekit && log "stopped livekit"
docker rm livekit && log "removed livekit"

log "--- [6] Recreate livekit on $NEW_IMAGE (reconstructed from inspect; ONLY image tag changes vs current) ---"
# Reconstructed from docker inspect 2026-07-20:
#   --network host, --hostname channel, name livekit
#   entrypoint /livekit-server + cmd --config /etc/livekit.yaml (image defaults; explicit here for clarity)
#   -v /opt/livekit/livekit.yaml:/etc/livekit.yaml (only mount)
#   NEW: --restart unless-stopped (was 'no' — same hardening we gave egress). No cap-add, no shm change (server doesn't need it).
docker run -d \
  --name livekit \
  --hostname channel \
  --network host \
  --restart unless-stopped \
  -v /opt/livekit/livekit.yaml:/etc/livekit.yaml \
  "$NEW_IMAGE" \
  --config /etc/livekit.yaml
RUNRC=$?
log "docker run rc=$RUNRC"
[ $RUNRC -eq 0 ] || { log "ABORT: docker run failed — ROLLBACK NEEDED (run stage-a-rollback.sh $BACKUP)"; exit 1; }

log "--- [7] Wait for livekit to come up, then restart ingress -> egress (order matters) ---"
sleep 5
log "livekit logs (first 40 lines):"; docker logs livekit 2>&1 | head -40
log "restarting ingress..."; docker restart ingress && log "ingress restarted"
sleep 3
log "restarting egress...";  docker restart egress  && log "egress restarted"
sleep 4

log "--- [8] VERIFY server health ---"
log "livekit running? $(docker inspect livekit --format 'Running={{.State.Running}} restarts={{.RestartCount}} img={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}}')"
log "livekit version: $(docker exec livekit /livekit-server --version 2>/dev/null || echo '(version cmd n/a)')"
log "livekit recent errors:"; docker logs livekit --since 90s 2>&1 | grep -iE 'error|fatal|panic|psrpc' | head -20 || log "  (none)"
log "egress re-registered? $(docker logs egress --since 90s 2>&1 | grep -iE 'service ready|connecting to redis' | tail -2)"
log "ingress up? $(docker inspect ingress --format 'Running={{.State.Running}}')"
log "redis up? $(docker inspect redis --format 'Running={{.State.Running}}')"

log "--- [9] room-status via app (proves app<->server RPC works) ---"
curl -s --max-time 15 "$APP/api/livekit/room-status?room=channel-radio" | tee -a "$LOG"; echo

log "--- [10] SIBLINGS UNTOUCHED? (IDs must match [2] except restart counts from the restart) ---"
for c in egress ingress redis restream-worker; do
  log "  $c AFTER:  $(docker inspect $c --format '{{.Id}} img={{.Image}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || echo MISSING)"
done

log "===== STAGE A done. NEXT: go live on channelbroadcast and run verify-live-and-archive.sh ====="
log "If ANYTHING failed: run  stage-a-rollback.sh $BACKUP   (rolls back to $OLD_DIGEST)"
