#!/usr/bin/env bash
# Daily cleanup for the YouTube render worker VPS. Runs `docker system
# prune -af` and reports the result to the worker's /cleanup-report
# endpoint so the admin Tech Health tab sees it.
#
# Unlike the restream VPS, this box doesn't host LiveKit and never serves
# real-time broadcast traffic. The render worker handles one job at a
# time and a prune mid-job at worst slows ffmpeg by a few seconds —
# no listener impact. No quiet-window check needed.
#
# Install:  cp this to /root/daily-cleanup.sh, chmod +x, then add cron entry.
# Logs: /var/log/daily-cleanup.log

set -uo pipefail

LOG=/var/log/daily-cleanup.log
exec >>"$LOG" 2>&1

echo ""
echo "===== $(date -u '+%Y-%m-%d %H:%M:%S UTC') daily-cleanup ====="

PRUNE_OUTPUT=$(docker system prune -af 2>&1)
PRUNE_EXIT=$?
echo "$PRUNE_OUTPUT"
echo "prune exit code: $PRUNE_EXIT"

DF_OUTPUT=$(df -h / | tail -1)
echo "df after: $DF_OUTPUT"

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
    http://localhost:3101/cleanup-report 2>&1 || echo "(curl failed)")
  echo "cleanup-report response: $REPORT_RESP"
else
  echo "WARN: $SECRET_FILE missing; skipping /cleanup-report"
fi

echo "===== done ====="

# Install cron (run once after copying this script):
#   chmod +x /root/daily-cleanup.sh
#   echo 'SHARED_SECRET_VALUE_HERE' > /root/.cleanup-secret
#   chmod 600 /root/.cleanup-secret
#   ( crontab -l 2>/dev/null; echo '0 8 * * * /root/daily-cleanup.sh' ) | crontab -
