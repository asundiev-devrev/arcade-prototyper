#!/bin/bash
# Wrap dist/Arcade Studio.app in dist/Arcade Studio.dmg.
# Includes a symlink to /Applications so users can drag-install.
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"
DMG="$DIST/Arcade Studio.dmg"

if [ ! -d "$APP" ]; then
  echo "Missing $APP. Run build.sh first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "Arcade Studio" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG"

echo ""
echo "✓ DMG: $DMG"
du -sh "$DMG"
