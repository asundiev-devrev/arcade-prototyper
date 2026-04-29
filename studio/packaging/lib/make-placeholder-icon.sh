#!/bin/bash
# Generate a placeholder .icns for Arcade Studio.
# Produces studio/packaging/icon.icns (relative to this script's parent of parent).
# A designer will replace this with a branded icon later.
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
OUT="$PKG_DIR/icon.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Seed from Finder.app's icon — guaranteed present on every Mac, ensures we
# get a valid PNG even on minimal Xcode CLT installs without ImageMagick etc.
SEED="$TMP/seed.png"
sips -s format png \
  "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns" \
  --out "$SEED" >/dev/null

ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"

# macOS icns requires these exact sizes and suffixes.
sips -z 16 16     "$SEED" --out "$ICONSET/icon_16x16.png"       >/dev/null
sips -z 32 32     "$SEED" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
sips -z 32 32     "$SEED" --out "$ICONSET/icon_32x32.png"       >/dev/null
sips -z 64 64     "$SEED" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
sips -z 128 128   "$SEED" --out "$ICONSET/icon_128x128.png"     >/dev/null
sips -z 256 256   "$SEED" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
sips -z 256 256   "$SEED" --out "$ICONSET/icon_256x256.png"     >/dev/null
sips -z 512 512   "$SEED" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
sips -z 512 512   "$SEED" --out "$ICONSET/icon_512x512.png"     >/dev/null
sips -z 1024 1024 "$SEED" --out "$ICONSET/icon_512x512@2x.png"  >/dev/null

iconutil -c icns "$ICONSET" -o "$OUT"
echo "Wrote $OUT"
