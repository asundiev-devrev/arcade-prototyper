#!/bin/bash
# Usage: download-awscli.sh <target-dir>
#   target-dir: where to put the extracted aws CLI (will end up with
#               <target-dir>/aws-cli/ containing the `aws` binary and its
#               Python runtime, ~220 MB).
#
# Downloads the official AWS CLI v2 installer (.pkg, ~53 MB), extracts
# just the aws-cli payload directory, and throws the rest away. The
# extracted aws binary runs standalone — no /usr/local symlinking or
# post-install scripts needed.
#
# We bundle this because beta testers on fresh Macs don't have awscli
# installed, and asking them to `brew install awscli` before the first
# chat turn kills the "open the DMG and go" onboarding story.
set -euo pipefail

TARGET="${1:?target dir required}"
URL="https://awscli.amazonaws.com/AWSCLIV2.pkg"

mkdir -p "$TARGET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading AWS CLI from $URL"
curl -fL --progress-bar -o "$TMP/awscli.pkg" "$URL"

echo "Expanding .pkg"
pkgutil --expand-full "$TMP/awscli.pkg" "$TMP/expanded" >/dev/null

# The payload we need is aws-cli.pkg/Payload/aws-cli/ — a self-contained
# Python + awscli install. Copy just that into $TARGET. The .pkg wrapper
# layers (BOMs, scripts, install metadata) are macOS installer plumbing
# and aren't useful to a bundled app.
PAYLOAD="$TMP/expanded/aws-cli.pkg/Payload/aws-cli"
if [ ! -d "$PAYLOAD" ]; then
  echo "AWS CLI payload not found at expected path: $PAYLOAD" >&2
  echo "The .pkg layout may have changed — inspect:" >&2
  find "$TMP/expanded" -maxdepth 4 -type d >&2
  exit 2
fi

rsync -a "$PAYLOAD/" "$TARGET/aws-cli/"
chmod +x "$TARGET/aws-cli/aws"

# Sanity check — fails loudly if the extracted binary can't run (wrong
# arch, missing dylib, etc). Better to die at build time than to ship a
# .app that crashes on first chat turn.
VER="$("$TARGET/aws-cli/aws" --version 2>&1 || true)"
if [[ -z "$VER" ]]; then
  echo "Extracted aws binary failed to run" >&2
  exit 3
fi
echo "AWS CLI installed: $VER"
