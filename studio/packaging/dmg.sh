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
DMG_RW="$DIST/Arcade Studio.rw.dmg"
MOUNT="/Volumes/Arcade Studio"
cleanup() {
  # Best-effort unmount in case AppleScript left it attached.
  hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$STAGE"
  rm -f "$DMG_RW"
}
trap cleanup EXIT

cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# Pre-rendered background image (800x500 logical, rasterized at 2x).
# Shipped as a hidden .background/ directory on the DMG so it doesn't
# clutter the user-visible window. Source SVG + regeneration command
# live next to the PNG in studio/packaging/dmg-background.svg.
BG_PNG="$PKG_DIR/dmg-background.png"
if [ -f "$BG_PNG" ]; then
  mkdir -p "$STAGE/.background"
  cp "$BG_PNG" "$STAGE/.background/background.png"
fi

# Build a read-write DMG first so we can script the Finder window layout —
# icon positions and window bounds — before compressing. Without this step
# Finder auto-arranges the two icons alphabetically, putting Applications on
# the left and the app on the right, which makes the drag-install go
# right-to-left (opposite of the macOS convention testers expect).
rm -f "$DMG_RW"
hdiutil create \
  -volname "Arcade Studio" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDRW \
  -fs HFS+ \
  "$DMG_RW"

hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
hdiutil attach "$DMG_RW" -nobrowse -noautoopen

# Hide the .background directory from Finder. The leading dot alone is not
# enough on modern macOS — Finder only respects the UF_HIDDEN flag. Same
# trick the Applications symlink gets no special treatment because a visible
# Applications shortcut is the whole point of the drag target.
if [ -d "$MOUNT/.background" ]; then
  chflags hidden "$MOUNT/.background" || true
fi

osascript <<'APPLESCRIPT'
tell application "Finder"
  tell disk "Arcade Studio"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    -- Window is 800x500 interior. Icon positions, arrow curve, and caption
    -- placement in the background PNG are all tuned to these bounds —
    -- changing the numbers here requires regenerating dmg-background.svg.
    set the bounds of container window to {400, 200, 1200, 700}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 13
    -- Background picture must be a POSIX path expressed as a HFS-style
    -- colon path via the disk name. If this line throws (font cache cold,
    -- image missing, etc.) we continue — the window is still usable with
    -- the default backdrop, just less branded.
    try
      set background picture of viewOptions to file ".background:background.png"
    end try
    set position of item "Arcade Studio.app" of container window to {200, 200}
    set position of item "Applications" of container window to {600, 200}
    update without registering applications
    delay 1
    close
  end tell
end tell
APPLESCRIPT

# Give Finder a moment to flush the .DS_Store it just wrote before we
# detach — otherwise the positions can be lost on some macOS versions.
sync
sleep 2

hdiutil detach "$MOUNT"

rm -f "$DMG"
hdiutil convert "$DMG_RW" -format UDZO -imagekey zlib-level=9 -o "$DMG"

echo ""
echo "✓ DMG: $DMG"
du -sh "$DMG"
