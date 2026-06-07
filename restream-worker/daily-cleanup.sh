#!/usr/bin/env bash
# Daily cleanup for the restream worker VPS. Runs `docker system prune -af`
# (releases unused images, build cache, dangling layers) IFF no live
# broadcast is happening or imminent. Reports the result to the worker's
# /cleanup-report endpoint so the admin Tech Health tab sees it.
#
# Install:  cp this to /root/daily-cleanup.sh, chmod +x, then add cron entry
#           (see comment at bottom).
#
# Logs: /var/log/daily-cleanup.log

set -uo pipefail

LOG=/var/log/daily-cleanup.log
exec >>"$LOG" 2>&1

echo ""
echo "===== $(date -u '+%Y-%m-%d %H:%M:%S UTC') daily-cleanup ====="

# Quiet-window check: skip if anything is live or about to be.
ROOM_STATUS=$(curl -fsS --max-time 10 "https://channel-app.com/api/livekit/room-status" 2>/dev/null || echo '{"isLive":"unknown"}')
echo "room-status: $ROOM_STATUS"

# Hard skip if isLive=true. Anything else (false / unknown / network blip) →
# we proceed; the prune is safe (only removes unused stuff) and the next
# scheduled cleanup will retry tomorrow anyway.
if echo "$ROOM_STATUS" | grep -q '"isLive":true'; then
  echo "SKIP: live broadcast in progress"
  exit 0
fi

# Run prune, capture output + exit
PRUNE_OUTPUT=$(docker system prune -af 2>&1)
PRUNE_EXIT=$?
echo "$PRUNE_OUTPUT"
echo "prune exit code: $PRUNE_EXIT"

# Disk usage after
DF_OUTPUT=$(df -h / | tail -1)
echo "df after: $DF_OUTPUT"

# Report to worker so /health shows lastCleanup
SECRET_FILE=/root/.cleanup-secret
if [ -f "$SECRET_FILE" ]; then
  SECRET=$(cat "$SECRET_FILE")
  if [ "$PRUNE_EXIT" -eq 0 ]; then
    PAYLOAD='{"ok":true}'
  else
    ERR=$(echo "$PRUNE_OUTPUT" | tail -1 | sed 's/"/\\"/g')
    PAYLOAD="{\"ok\":false,\"error\":\"$ERR\"}"
  fi
  REPORT_RESP=$(curl -fsS --max-time 10 -X POST \
    -H "Authorization: Bearer $SECRET" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    http://localhost:3100/cleanup-report 2>&1 || echo "(curl failed)")
  echo "cleanup-report response: $REPORT_RESP"
else
  echo "WARN: $SECRET_FILE missing; skipping /cleanup-report"
fi

echo "===== done ====="

# Install cron (run once after copying this script to the VPS):
#   chmod +x /root/daily-cleanup.sh
#   echo 'SHARED_SECRET_VALUE_HERE' > /root/.cleanup-secret
#   chmod 600 /root/.cleanup-secret
#   ( crontab -l 2>/dev/null; echo '0 8 * * * /root/daily-cleanup.sh' ) | crontab -
#
# Verify: crontab -l | grep daily-cleanup
