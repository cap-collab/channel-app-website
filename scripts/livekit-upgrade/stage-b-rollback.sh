#!/usr/bin/env bash
# STAGE B ROLLBACK — restore egress to v1.12.0 (RUN ON VPS). egress is stateless.
set -uo pipefail
TS="$(date -u +%Y%m%dT%H%M%SZ)"; LOG="/root/egress-rollback-${TS}.log"
OLD_DIGEST="sha256:30b3389518c851e6c20e964bba9d5ce89d0bd09b8b0fe0d0d36c9546303c8430"  # v1.12.0
exec > >(tee -a "$LOG") 2>&1
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
log "===== EGRESS ROLLBACK -> v1.12.0 ($OLD_DIGEST). Log $LOG ====="
docker rm -f egress 2>/dev/null || true
docker run -d --name egress --hostname channel --network host \
  --cap-add SYS_ADMIN --restart unless-stopped --shm-size=1g \
  -e EGRESS_CONFIG_FILE=/etc/egress.yaml \
  -v /opt/livekit/egress.yaml:/etc/egress.yaml \
  "$OLD_DIGEST"
log "rc=$?"; sleep 5
log "egress: $(docker inspect egress --format 'Running={{.State.Running}} ShmSize={{.HostConfig.ShmSize}}')  version=$(docker exec egress egress --version 2>/dev/null || echo n/a)"
docker logs egress --since 40s 2>&1 | grep -iE 'service ready|error|fatal' | head -10
log "===== ROLLBACK done. Expect egress version 1.12.0 + Running=true + ShmSize=1073741824. ====="
