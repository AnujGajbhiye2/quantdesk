#!/usr/bin/env bash
# Pull a fresh prod DB snapshot from the EC2 box over SSH. No paid services.
# The pulled laptop copy doubles as the offsite backup of prod.
#
# Config (override via env or .env):
#   EC2_SSH_KEY  - path to the .pem key   (default: ~/Projects/secrets/aws-key/anuj-server.pem)
#   EC2_HOST     - user@host              (default: ec2-user@ec2-34-250-167-110.eu-west-1.compute.amazonaws.com)
#
# What it does:
#   1. On EC2: VACUUM INTO a temp snapshot (safe while the app runs - VACUUM INTO
#      takes a read transaction; WAL mode keeps writers unblocked).
#   2. scp the snapshot down (~310MB).
#   3. Verify integrity + row counts locally.
#   4. Swap into data/quantdesk.db, keeping the previous copy at data/quantdesk.db.prev.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

EC2_SSH_KEY="${EC2_SSH_KEY:-$HOME/Projects/secrets/aws-key/anuj-server.pem}"
EC2_HOST="${EC2_HOST:-ec2-user@ec2-34-250-167-110.eu-west-1.compute.amazonaws.com}"
REMOTE_DB="/home/ec2-user/quantdesk/data/quantdesk.db"
REMOTE_TMP="/tmp/quantdesk-snapshot.db"
DEST=data/quantdesk.db
TMP=data/quantdesk.db.pull-tmp

echo "Creating snapshot on EC2 ..."
ssh -i "$EC2_SSH_KEY" "$EC2_HOST" \
  "rm -f $REMOTE_TMP && sqlite3 $REMOTE_DB \"VACUUM INTO '$REMOTE_TMP'\" && ls -lh $REMOTE_TMP"

echo "Downloading snapshot ..."
scp -i "$EC2_SSH_KEY" "$EC2_HOST:$REMOTE_TMP" "$TMP"
ssh -i "$EC2_SSH_KEY" "$EC2_HOST" "rm -f $REMOTE_TMP"

echo "Verifying ..."
sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -qx ok
BARS=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM bars;")
TRADES=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM paper_trades;")
echo "  bars=$BARS paper_trades=$TRADES"

if [ -f "$DEST" ]; then
  mv "$DEST" "$DEST.prev"
  echo "Previous DB kept at $DEST.prev"
fi
rm -f "$DEST-wal" "$DEST-shm"
mv "$TMP" "$DEST"
echo "Done: $DEST is now the latest prod snapshot (also serves as prod's offsite backup)."
