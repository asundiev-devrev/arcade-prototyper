#!/bin/bash
# Usage: install-deps.sh <app-dir> [<bundled-node-bin>]
# Runs pnpm install inside <app-dir> using the bundled Node if provided
# (otherwise the host's Node), then installs the Claude CLI and figmanage
# locally so node_modules/.bin/{claude,figmanage} resolve without any host
# install.
set -euo pipefail

APP="${1:?app dir required}"
NODE_BIN_DIR="${2:-}"

cd "$APP"

if [ -n "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
  echo "Using bundled Node: $(node --version) from $NODE_BIN_DIR"
else
  echo "Using host Node: $(node --version)"
fi

# Ensure pnpm is reachable. Use corepack (ships with Node 22) so we don't
# rely on the host having pnpm installed. Disable the interactive download
# prompt and redirect stdin from /dev/null so the build never blocks on
# a Y/N confirmation in CI or the packaging orchestrator.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable </dev/null 2>/dev/null || true
corepack prepare pnpm@latest --activate </dev/null 2>/dev/null || true

# Install with devDeps — studio runs via Vite (devDep), tailwindcss (devDep),
# @vitejs/plugin-react (devDep). We can't --prod=true. The playwright cost is
# accepted; skipping browsers is done via env below.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile

# Vendor the Claude CLI and figmanage as local deps so node_modules/.bin/
# resolves both without the host having them globally installed.
pnpm add --save-exact @anthropic-ai/claude-code figmanage

echo "Deps installed. bin contents:"
ls node_modules/.bin/ | head -30
