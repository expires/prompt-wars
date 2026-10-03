#!/usr/bin/env bash
# Build the client and upload it to the VPS (Caddy serves /var/www/ai-gaem).
set -euo pipefail
HOST="${DEPLOY_HOST:-root@187.7.27.171}"
cd "$(dirname "$0")/.."
pnpm --filter client build
rsync -az --delete client/dist/ "$HOST:/var/www/ai-gaem/"
echo "Deployed to http://${HOST#*@}/"
