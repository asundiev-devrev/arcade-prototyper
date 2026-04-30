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
#
# --config.supported-architectures is critical: vite 8 depends on rolldown,
# which ships platform-specific native bindings via `optionalDependencies`.
# pnpm with `--frozen-lockfile` is prone to skipping the arch-specific
# optional dep in fresh installs, which manifests at runtime as:
#   Cannot find module '@rolldown/binding-darwin-arm64'
# Forcing the supported architectures tells pnpm to eagerly pull the
# darwin-arm64 binding into node_modules.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile \
  --config.supported-architectures.os=darwin \
  --config.supported-architectures.cpu=arm64

# Vendor the Claude CLI and figmanage as local deps so node_modules/.bin/
# resolves both without the host having them globally installed. Same
# architecture forcing as above so any native bindings they pull in land
# in the right form.
pnpm add --save-exact @anthropic-ai/claude-code figmanage \
  --config.supported-architectures.os=darwin \
  --config.supported-architectures.cpu=arm64

# pnpm 10+ silently blocks postinstall scripts by default as a security
# measure, and @anthropic-ai/claude-code has a real postinstall (install.cjs)
# that copies the 200MB platform-specific native binary over the
# bin/claude.exe stub. Without it we ship the stub, and every chat turn
# errors with "claude native binary not installed."
#
# pnpm 10's `approve-builds`, `rebuild`, and `--config.only-built-dependencies`
# flags all get swallowed silently in a fresh-install context. The only
# reliable lever is to run the postinstall ourselves.
node "node_modules/@anthropic-ai/claude-code/install.cjs"

# Paranoia: confirm the rolldown binding actually made it into the tree.
# If pnpm silently skipped it (optional-deps weirdness), fail the build
# loudly instead of shipping a .app that crashes at first launch.
if [ ! -d "node_modules/@rolldown/binding-darwin-arm64" ] && \
   ! find node_modules/.pnpm -maxdepth 2 -type d -name "@rolldown+binding-darwin-arm64*" | grep -q .; then
  echo "ERROR: @rolldown/binding-darwin-arm64 not installed. Vite 8 will crash." >&2
  echo "Inspect node_modules/.pnpm for what pnpm actually fetched." >&2
  exit 1
fi

# Paranoia: confirm Claude's postinstall actually replaced bin/claude.exe
# with the real 200MB native binary. If it's still the ~500-byte stub,
# every chat turn crashes with:
#   Error: claude native binary not installed.
CLAUDE_BIN="node_modules/@anthropic-ai/claude-code/bin/claude.exe"
if [ ! -f "$CLAUDE_BIN" ]; then
  echo "ERROR: $CLAUDE_BIN missing entirely." >&2
  exit 1
fi
CLAUDE_SIZE=$(stat -f%z "$CLAUDE_BIN" 2>/dev/null || stat -c%s "$CLAUDE_BIN")
if [ "$CLAUDE_SIZE" -lt 1000000 ]; then
  echo "ERROR: $CLAUDE_BIN is only ${CLAUDE_SIZE} bytes — the Claude postinstall" >&2
  echo "did not run, so the native binary was not copied over the stub." >&2
  echo "Chat turns will fail with 'claude native binary not installed'." >&2
  exit 1
fi

echo "Deps installed. bin contents:"
ls node_modules/.bin/ | head -30
echo "claude.exe: $((CLAUDE_SIZE / 1024 / 1024)) MB (native installed)"
