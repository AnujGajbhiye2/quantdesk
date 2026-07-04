#!/usr/bin/env bash
# Deploy preflight: refuse to npm ci with under 1GB free on /.
# npm ci wipes node_modules first; a partial reinstall leaves the app
# unbootable (2026-07-04 incident: deploy attempted at 808MB free, next
# binary vanished, only the in-memory pm2 process kept prod alive).
# Calibration: a successful deploy on the 8GB prod disk started at 1.8GB
# free and ended at 1.4GB; steady state sits ~1.4GB, so 2GB would block
# every deploy while 1GB cleanly separates healthy from the incident.
set -euo pipefail

MIN_KB=1048576  # 1GB

avail_kb=$(df -Pk / | tail -1 | awk '{print $4}')
if [ "$avail_kb" -lt "$MIN_KB" ]; then
  echo "ERROR: only $((avail_kb / 1024))MB free on / (need 1GB) - refusing npm ci."
  echo "Free space first (old logs, .next cache, stray DB files), then redeploy."
  df -h /
  exit 1
fi
echo "preflight-disk: $((avail_kb / 1024))MB free - ok"
