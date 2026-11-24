#!/bin/sh
# Backs up Open WebUI's data (conversations, users, memories, knowledge bases and their uploaded files, model
# configurations, settings) from its Docker volume to local-ai/openwebui/backups/, as a dated .tar.gz.
# Stops the container for the few seconds it takes, so its SQLite database is copied consistently, then starts it.
# Ollama's models aren't included: they can be pulled again (ollama pull <name>).
#   ./backup.sh
set -eu
cd "$(dirname "$0")"
VOLUME=racingcoach-open-webui
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="open-webui-$STAMP.tar.gz"

docker volume inspect "$VOLUME" >/dev/null
WAS_RUNNING=$(docker inspect -f '{{.State.Running}}' open-webui 2>/dev/null || echo false)
[ "$WAS_RUNNING" = true ] && docker stop open-webui >/dev/null
docker run --rm -v "$VOLUME":/data:ro -v "$PWD/backups":/backup alpine tar czf "/backup/$FILE" -C /data .
[ "$WAS_RUNNING" = true ] && docker start open-webui >/dev/null
chmod 600 "backups/$FILE"
echo "Backed up to local-ai/openwebui/backups/$FILE ($(du -h "backups/$FILE" | cut -f1))"
