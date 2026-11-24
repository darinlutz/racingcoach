#!/bin/sh
# Restores Open WebUI's data from a backup made by backup.sh, replacing everything in its Docker volume.
# The .env's WEBUI_SECRET_KEY must be the one in use when the backup was made.
#   ./restore.sh backups/open-webui-20261124-120000.tar.gz
set -eu
cd "$(dirname "$0")"
VOLUME=racingcoach-open-webui
BACKUP=${1:?Usage: ./restore.sh backups/open-webui-<date>.tar.gz}
[ -f "$BACKUP" ] || { echo "No such file: $BACKUP"; exit 1; }

printf 'Replace all Open WebUI data with %s? Type RESTORE: ' "$BACKUP"
read -r answer
[ "$answer" = RESTORE ] || { echo "Nothing changed."; exit 1; }

docker compose stop open-webui >/dev/null 2>&1 || true
docker volume create "$VOLUME" >/dev/null
DIR=$(cd "$(dirname "$BACKUP")" && pwd)
NAME=$(basename "$BACKUP")
docker run --rm -v "$VOLUME":/data -v "$DIR":/backup:ro alpine sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$NAME -C /data"
docker compose up -d
echo "Restored from $BACKUP. Open WebUI is starting: http://localhost:8080"
