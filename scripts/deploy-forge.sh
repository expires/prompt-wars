#!/usr/bin/env bash
# Deploy the forge service (forge/) to the VPS:
#   - bundles forge/dist/server.mjs (esbuild, self-contained) and uploads it to /opt/ai-gaem-forge
#   - installs Node 22 (Ubuntu nodejs package) if missing
#   - systemd unit `ai-gaem-forge` listening on 127.0.0.1:8787, env from /etc/ai-gaem-forge.env
#     (created with an EMPTY ANTHROPIC_API_KEY placeholder = mock mode if missing; an existing file is
#     never overwritten, only missing keys are appended; secrets are never printed)
#   - Caddy: adds a separate `:80/api/forge/*` site block (reverse_proxy, flush_interval -1) at the
#     top of the Caddyfile, re-reading it right before editing and validating before reload.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@187.7.27.171}"
cd "$(dirname "$0")/.."

pnpm --filter @ai-gaem/forge build
ssh "$HOST" 'mkdir -p /opt/ai-gaem-forge'
rsync -az forge/dist/server.mjs forge/dist/server.mjs.map "$HOST:/opt/ai-gaem-forge/"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"
id ai-gaem-forge >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ai-gaem-forge

ENV=/etc/ai-gaem-forge.env
if [ ! -f "$ENV" ]; then
  install -m 600 -o root -g root /dev/null "$ENV"
fi
add_key() { grep -q "^$1=" "$ENV" || echo "$1=$2" >> "$ENV"; }
add_key ANTHROPIC_API_KEY ""
add_key FORGE_MODEL "claude-haiku-4-5-20251001"
add_key FORGE_HOST "127.0.0.1"
add_key FORGE_PORT "8787"
chmod 600 "$ENV"
echo "env keys: $(grep -o '^[A-Z_]*=' "$ENV" | tr -d '=' | tr '\n' ' ')"
if grep -q '^ANTHROPIC_API_KEY=.\+' "$ENV"; then echo "mode: live"; else echo "mode: mock (no key)"; fi

cat > /etc/systemd/system/ai-gaem-forge.service <<'UNIT'
[Unit]
Description=ai-gaem forge service (LLM weapon designs, /api/forge/*)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ai-gaem-forge
EnvironmentFile=/etc/ai-gaem-forge.env
ExecStart=/usr/bin/node --enable-source-maps /opt/ai-gaem-forge/server.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ai-gaem-forge >/dev/null
systemctl restart ai-gaem-forge

CF=/etc/caddy/Caddyfile
# The forge block must come FIRST in the file: Caddy keeps file order for blocks on the same
# address, and the static :80 block is a terminal catch-all (its try_files would rewrite
# /api/forge/* to /index.html). Re-read right before editing; only the forge block is touched.
cp "$CF" "$CF.bak-forge"
python3 - "$CF" <<'PY'
import sys
cf = sys.argv[1]
s = open(cf).read()
marker = "# ai-gaem forge service"
block = """# ai-gaem forge service (streamed NDJSON). Separate, FIRST site block: it must precede the
# static :80 catch-all (whose try_files / encode must not apply here).
:80/api/forge/* {
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
"""
if marker in s:
    i = s.index(marker)
    j = s.index("}\n}\n", i) + 4  # end of the forge block
    if i == 0 and s[:j] == block:
        print("caddy: forge block already first"); sys.exit(0)
    s = s[:i] + s[j:]
open(cf, "w").write(block + "\n" + s.lstrip("\n"))
print("caddy: forge block written")
PY
if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
else
  cp "$CF.bak-forge" "$CF"
  echo "caddy: validation failed, Caddyfile restored" >&2
  exit 1
fi
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8787/api/forge/health >/dev/null 2>&1 && break; sleep 0.5; done
echo "health: $(curl -fsS http://127.0.0.1:8787/api/forge/health)"
REMOTE
echo "public: $(curl -fsS "http://${HOST#*@}/api/forge/health")"
