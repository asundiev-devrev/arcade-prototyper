#!/bin/bash
# Usage: download-cloudflared.sh <target-dir> [arch]
#   target-dir: where to put the cloudflared binary (will end up with
#               <target-dir>/cloudflared, ~23 MB).
#   arch:       "arm64" or "amd64". Defaults to the host's architecture.
#
# Downloads the prebuilt cloudflared binary directly from Cloudflare's
# GitHub releases — it's a single statically-linked Go binary, no installer,
# no Python runtime, no dependencies.
#
# We bundle this because Studio's multiplayer invite flow spawns
# `cloudflared tunnel --url http://localhost:5556` to expose the host's
# relay over the internet. Requiring beta testers to `brew install
# cloudflared` first would break the "open the DMG and go" onboarding
# story, and the app crashes hard without it (spawn ENOENT takes down
# the whole Vite process).
set -euo pipefail

TARGET="${1:?target dir required}"
ARCH="${2:-}"

if [ -z "$ARCH" ]; then
  HOST_ARCH="$(uname -m)"
  case "$HOST_ARCH" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64)        ARCH="amd64" ;;
    *) echo "Unsupported host arch: $HOST_ARCH" >&2; exit 2 ;;
  esac
fi

case "$ARCH" in
  arm64) ASSET="cloudflared-darwin-arm64.tgz" ;;
  amd64) ASSET="cloudflared-darwin-amd64.tgz" ;;
  *) echo "Unsupported arch: $ARCH (expected arm64 or amd64)" >&2; exit 2 ;;
esac

URL="https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"

mkdir -p "$TARGET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading cloudflared ($ARCH) from $URL"
curl -fL --progress-bar -o "$TMP/cloudflared.tgz" "$URL"

echo "Extracting"
tar -xzf "$TMP/cloudflared.tgz" -C "$TMP"

# The tarball contains a single file `cloudflared` at its root.
if [ ! -f "$TMP/cloudflared" ]; then
  echo "cloudflared binary not found at expected path: $TMP/cloudflared" >&2
  find "$TMP" -maxdepth 2 -type f >&2
  exit 3
fi

mv "$TMP/cloudflared" "$TARGET/cloudflared"
chmod +x "$TARGET/cloudflared"

# Sanity check — fails loudly if the binary can't run (wrong arch,
# Gatekeeper complaints, etc). The app bundle's ad-hoc codesign later
# in build.sh handles execution rights on end-user machines.
VER="$("$TARGET/cloudflared" --version 2>&1 || true)"
if [[ -z "$VER" ]]; then
  echo "Downloaded cloudflared binary failed to run" >&2
  exit 4
fi
echo "cloudflared installed: $VER"
