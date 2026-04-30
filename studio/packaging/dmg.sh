#!/bin/bash
# Wrap dist/Arcade Studio.app in dist/Arcade Studio.dmg.
# Includes a symlink to /Applications so users can drag-install.
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DIST="$PKG_DIR/dist"
APP="$DIST/Arcade Studio.app"

if [ ! -d "$APP" ]; then
  echo "Missing $APP. Run build.sh first." >&2
  exit 1
fi

# Read the version the build recorded next to Info.plist. Falling back to
# "unknown" just means the DMG gets a generic name — we never block on
# this because the .app itself is the source of truth for what version
# was built.
VERSION_BASE="unknown"
if [ -f "$APP/Contents/Resources/version.json" ]; then
  # Pull "base" out without pulling in jq. The file is tiny and our own,
  # so a grep+sed is fine.
  VERSION_BASE="$(grep '"base"' "$APP/Contents/Resources/version.json" \
    | sed -E 's/.*"base": "([^"]+)".*/\1/')"
fi

# Put the version in the DMG filename so testers downloading multiple
# builds in the same week can tell them apart at a glance.
DMG="$DIST/Arcade Studio ${VERSION_BASE}.dmg"

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
