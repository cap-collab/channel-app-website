#!/usr/bin/env bash
# ============================================================================
# STAGE B — Upgrade egress 1.12.0 -> v1.13.0  (RUN ON VPS root@5.161.252.231)
# THE recording-drop fix. Run AFTER Stage A is proven over 1-2 real shows.
# Idle window only. Recreates ONLY the egress container; ONLY the image tag
# changes vs the current (shm-size=1g, cap-add SYS_ADMIN, restart unless-stopped
# all preserved). HEAVY LOGGING to a timestamped file.
# ============================================================================
set -uo pipefail
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/root/egress-upgrade-B-${TS}.log"
BACKUP="/root/egress-inspect-backup-${TS}.json"
NEW_IMAGE="livekit/egress:v1.13.0"
OLD_DIGEST="sha256:30b3389518c851e6c20e964bba9d5ce89d0bd09b8b0fe0d0d36c9546303c8430"  # v1.12.0 rollback ref
APP="https://channel-app.com"
exec > >(tee -a "$LOG") 2>&1
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
log "===== STAGE B start (egress -> v1.13.0). Log $LOG ====="

log "--- [0] Pre-flight: room idle + no active egress ---"
ROOM=$(curl -s --max-time 15 "$APP/api/livekit/room-status?room=channel-radio"); log "room-status: $ROOM"
echo "$ROOM" | grep -q '"isLive":false' || { log "ABORT: isLive not false"; exit 1; }
EG=$(curl -s --max-time 15 "$APP/api/livekit/egress?room=channel-radio"); log "egress-list: $EG"
echo "$EG" | grep -qE '"status":[[:space:]]*[01][^0-9]' && { log "ABORT: egress STARTING/ACTIVE"; exit 1; }
log "OK idle."

log "--- [1] Backup + digests ---"
docker inspect egress > "$BACKUP" && log "saved -> $BACKUP"
log "current egress image: $(docker inspect egress --format '{{.Image}}')  (rollback ref = $OLD_DIGEST)"

log "--- [2] Sibling state BEFORE ---"
for c in livekit ingress redis restream-worker; do
  log "  $c BEFORE: $(docker inspect $c --format '{{.Id}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || echo MISSING)"
done

log "--- [3] Pull pinned $NEW_IMAGE ---"
docker pull "$NEW_IMAGE" || { log "ABORT: pull failed"; exit 1; }
log "pulled: $(docker image inspect "$NEW_IMAGE" --format '{{.Id}} version={{index .Config.Labels "org.opencontainers.image.version"}}')"

log "--- [4] Config present? ---"
[ -f /opt/livekit/egress.yaml ] || { log "ABORT: egress.yaml missing"; exit 1; }

log "--- [5] STOP + REMOVE only egress ---"
docker stop egress && log "stopped"; docker rm egress && log "removed"

log "--- [6] Recreate egress on $NEW_IMAGE (identical flags to current; ONLY image changes) ---"
# Reconstructed from inspect: --network host, --hostname channel, --cap-add SYS_ADMIN,
# --shm-size=1g, --restart unless-stopped, -e EGRESS_CONFIG_FILE, -v egress.yaml. entrypoint/user = image default.
docker run -d \
  --name egress \
  --hostname channel \
  --network host \
  --cap-add SYS_ADMIN \
  --restart unless-stopped \
  --shm-size=1g \
  -e EGRESS_CONFIG_FILE=/etc/egress.yaml \
  -v /opt/livekit/egress.yaml:/etc/egress.yaml \
  "$NEW_IMAGE"
RUNRC=$?; log "docker run rc=$RUNRC"
[ $RUNRC -eq 0 ] || { log "ABORT: run failed — ROLLBACK (stage-b-rollback.sh)"; exit 1; }

log "--- [7] Verify egress ---"
sleep 5
log "egress: $(docker inspect egress --format 'Running={{.State.Running}} restarts={{.RestartCount}} ShmSize={{.HostConfig.ShmSize}} Restart={{.HostConfig.RestartPolicy.Name}} CapAdd={{.HostConfig.CapAdd}} img={{.Config.Image}}')"
log "egress version: $(docker exec egress egress --version 2>/dev/null || echo n/a)"
log "/dev/shm: $(docker exec egress sh -c 'df -h /dev/shm | tail -1')"
log "startup logs:"; docker logs egress 2>&1 | tail -15
log "errors?"; docker logs egress --since 60s 2>&1 | grep -iE 'error|fatal|panic|psrpc|refused' | head -15 || log "  (none)"

log "--- [8] Siblings untouched? ---"
for c in livekit ingress redis restream-worker; do
  log "  $c AFTER: $(docker inspect $c --format '{{.Id}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || echo MISSING)"
done

log "===== STAGE B done. NEXT: go live on channelbroadcast + run verify-live-and-archive.sh — confirm DROPS GONE. ====="
log "Rollback: stage-b-rollback.sh"
