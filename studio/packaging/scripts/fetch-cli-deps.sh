#!/bin/bash
# Pre-build helper: downloads cloudflared + AWS CLI into
# studio/packaging/{cloudflared,aws-cli} so electron-builder's
# extraResources rule can pick them up.
#
# Idempotent — re-running with the binaries already in place is a no-op.
set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../../.." && pwd )"
CF_DIR="$REPO_ROOT/studio/packaging/cloudflared"
AWS_DIR="$REPO_ROOT/studio/packaging/aws-cli"
ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) CF_ARCH=arm64 ;;
  x86_64)        CF_ARCH=amd64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 2 ;;
esac

# cloudflared
if [ ! -x "$CF_DIR/cloudflared" ]; then
  echo "==> Fetching cloudflared ($CF_ARCH)"
  mkdir -p "$CF_DIR"
  curl -fsSL -o "$CF_DIR/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CF_ARCH}.tgz"
  # The download is a tarball despite no .tgz suffix in the URL on some
  # mirrors; guard with a magic-byte check.
  if file "$CF_DIR/cloudflared" | grep -q "gzip compressed"; then
    mv "$CF_DIR/cloudflared" "$CF_DIR/cloudflared.tgz"
    tar -xzf "$CF_DIR/cloudflared.tgz" -C "$CF_DIR"
    rm "$CF_DIR/cloudflared.tgz"
  fi
  chmod +x "$CF_DIR/cloudflared"
  echo "    cloudflared installed: $($CF_DIR/cloudflared --version 2>&1 | head -1)"
else
  echo "==> cloudflared already in place"
fi

# AWS CLI v2
# pkgutil/Payload extraction produces $AWS_DIR/aws-cli/aws (nested), not
# $AWS_DIR/aws — so check the actual landing path for idempotency.
if [ ! -x "$AWS_DIR/aws-cli/aws" ]; then
  echo "==> Fetching AWS CLI v2"
  mkdir -p "$AWS_DIR"
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/AWSCLIV2.pkg" "https://awscli.amazonaws.com/AWSCLIV2.pkg"
  pkgutil --expand "$TMP/AWSCLIV2.pkg" "$TMP/expanded"
  cd "$TMP/expanded"
  for d in *.pkg; do
    [ -f "$d/Payload" ] && tar -xzf "$d/Payload" -C "$AWS_DIR" 2>/dev/null || true
  done
  cd - >/dev/null
  rm -rf "$TMP"
  if [ ! -x "$AWS_DIR/aws-cli/aws" ]; then
    echo "ERROR: AWS CLI extraction did not produce aws-cli/aws" >&2
    exit 1
  fi
  echo "    AWS CLI installed: $($AWS_DIR/aws-cli/aws --version 2>&1 | head -1)"
else
  echo "==> AWS CLI already in place"
fi

echo "✓ CLI deps ready under studio/packaging/{cloudflared,aws-cli}"
