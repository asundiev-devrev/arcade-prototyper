#!/bin/bash
# Arcade Studio .app build.
# Produces studio/packaging/dist/Arcade Studio.app (and .dmg via dmg.sh).
#
# Stages, each handled by a dedicated script under lib/:
#   1. Clean any prior dist/Arcade Studio.app/
#   2. Scaffold Contents/{MacOS,Resources}/ and drop Info.plist + icon.
#   3. Download Node into Resources/node/.
#   4. Copy repo into Resources/app/.
#   5. Install node_modules (incl. claude-code + figmanage) into Resources/app/.
#   6. Install launcher.sh into MacOS/ (renamed to the bundle executable).
#   7. Ad-hoc codesign the bundle.
set -euo pipefail

ARCH="${ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64)        NODE_ARCH=x64 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 2 ;;
esac

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$PKG_DIR/../.." && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
MACOS="$CONTENTS/MacOS"

echo "==> Cleaning prior build"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

echo "==> Installing Info.plist and icon"
cp "$PKG_DIR/Info.plist" "$CONTENTS/Info.plist"
cp "$PKG_DIR/icon.icns"  "$RESOURCES/icon.icns"

echo "==> Downloading Node ($NODE_ARCH)"
bash "$PKG_DIR/lib/download-node.sh" "$RESOURCES/node" "$NODE_ARCH"

echo "==> Copying repo into Resources/app"
bash "$PKG_DIR/lib/copy-sources.sh" "$REPO_ROOT" "$RESOURCES/app"

echo "==> Installing dependencies"
bash "$PKG_DIR/lib/install-deps.sh" "$RESOURCES/app" "$RESOURCES/node/bin"

echo "==> Installing launcher"
cp "$PKG_DIR/launcher.sh" "$MACOS/Arcade Studio"
chmod +x "$MACOS/Arcade Studio"

echo "==> Ad-hoc codesigning"
bash "$PKG_DIR/lib/codesign.sh" "$APP"

echo ""
echo "✓ Built: $APP"
du -sh "$APP"
