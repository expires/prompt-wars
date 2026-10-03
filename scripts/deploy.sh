#!/usr/bin/env bash
# Build the client and upload it to the VPS (Caddy serves /var/www/ai-gaem with
# `file_server { precompressed br gzip }`, so the build's .br/.gz siblings are uploaded too).
#
# Hashed assets go up first and old ones are kept for a while (players with an older index.html
# still lazy-load their chunks); index.html goes last so it never points at missing files.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@187.7.27.171}"
ROOT=/var/www/ai-gaem
cd "$(dirname "$0")/.."
pnpm --filter client build
rsync -az client/dist/assets/ "$HOST:$ROOT/assets/"
rsync -az --delete --exclude assets/ client/dist/ "$HOST:$ROOT/"
# prune assets that are no longer referenced and older than 14 days
ssh "$HOST" "find $ROOT/assets -type f -mtime +14 -delete" || true
echo "Deployed to http://${HOST#*@}/"
