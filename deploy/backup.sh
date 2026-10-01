#!/usr/bin/env bash
# Nightly consistent backup of the licensing database (cron: 17 3 * * * /opt/lsr/backup.sh). Keeps 30 days.
# Also copy /var/backups/lsr off the server (rsync/rclone/object storage): a backup on the same disk is not a backup.
set -euo pipefail
DB=/var/lib/lsr/licensing.sqlite; DEST=/var/backups/lsr; mkdir -p "$DEST"; chmod 700 "$DEST"
OUT="$DEST/licensing-$(date -u +%Y%m%d-%H%M%S).sqlite"
node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]); db.exec(\"VACUUM INTO '\" + process.argv[2].replace(/'/g, \"''\") + \"'\"); db.close();" "$DB" "$OUT"
gzip -9 "$OUT"
find "$DEST" -name 'licensing-*.sqlite.gz' -mtime +30 -delete
echo "backup written: $OUT.gz"
