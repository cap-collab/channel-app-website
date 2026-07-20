#!/usr/bin/env bash
# ============================================================================
# STAGE A ROLLBACK — restore livekit-server to v1.9.9 (RUN ON VPS)
# Usage: stage-a-rollback.sh [/root/livekit-inspect-backup-<ts>.json]
# livekit is stateless (config from bind-mounted yaml) → clean re-create w/ old digest.
# ============================================================================
set -uo pipefail
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/root/livekit-rollback-${TS}.log"
OLD_DIGEST="sha256:d8b1107d9234af8c84f5f219e02401fc176023a3564dab1550c6d14befa596de"  # v1.9.9
exec > >(tee -a "$LOG") 2>&1
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
log "===== STAGE A ROLLBACK -> v1.9.9 ($OLD_DIGEST). Log $LOG ====="

log "removing current livekit container (if any)..."
docker rm -f livekit 2>/dev/null || true

log "recreating livekit on OLD digest (same flags; keep --restart unless-stopped hardening)..."
docker run -d \
  --name livekit \
  --hostname channel \
  --network host \
  --restart unless-stopped \
  -v /opt/livekit/livekit.yaml:/etc/livekit.yaml \
  "$OLD_DIGEST" \
  --config /etc/livekit.yaml
log "rc=$?"

sleep 5
log "restart ingress + egress to reconnect..."
docker restart ingress; sleep 3; docker restart egress; sleep 4

log "VERIFY rollback:"
log "  livekit: $(docker inspect livekit --format 'Running={{.State.Running}}')  version=$(docker exec livekit /livekit-server --version 2>/dev/null || echo n/a)"
docker logs livekit --since 60s 2>&1 | grep -iE 'error|fatal|service ready|started' | head -10
log "  room-status:"; curl -s --max-time 15 "https://channel-app.com/api/livekit/room-status?room=channel-radio"; echo
log "===== ROLLBACK done. Expect livekit-server version 1.9.9 + Running=true. ====="
