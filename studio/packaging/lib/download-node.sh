#!/bin/bash
# Usage: download-node.sh <target-dir> <arch>
#   target-dir: where to extract Node (its bin/, lib/, include/, share/).
#   arch:       arm64 | x64
#
# Downloads the official Node.js darwin tarball, extracts it, and flattens
# the "node-vXX.YY.ZZ-darwin-<arch>/" prefix so the final layout is:
#   <target-dir>/bin/node
#   <target-dir>/lib/...
#
# Node version is pinned to NODE_VERSION below. Bump manually.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.14.0}"
TARGET="${1:?target dir required}"
ARCH="${2:?arch required (arm64|x64)}"

case "$ARCH" in
  arm64|x64) ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

TARBALL="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"

mkdir -p "$TARGET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $URL"
curl -fL -o "$TMP/$TARBALL" "$URL"

echo "Extracting into $TARGET"
tar -xzf "$TMP/$TARBALL" -C "$TMP"
INNER="$TMP/node-v${NODE_VERSION}-darwin-${ARCH}"
# rsync to merge into any pre-existing TARGET contents.
rsync -a "$INNER/" "$TARGET/"

chmod +x "$TARGET/bin/node"
echo "Node installed: $("$TARGET/bin/node" --version)"
