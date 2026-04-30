#!/bin/bash
# Regenerate studio/packaging/icon.icns from source.
#
# Design: flat Jabuticaba (#8854F6) background, thick Hardy (#78FF2A)
# letter "S" rendered in Chip Display Variable at weight 900. macOS
# Big Sur+ rounded-square plate (22% corner radius).
#
# The icon is committed to the repo, so this script only needs to run
# when the design changes. `build.sh` does NOT call it — it just copies
# the committed icon.icns into the bundle. This keeps the build fast
# (no Playwright/Chromium invocation per build).
#
# Run manually after design changes:
#   ./studio/packaging/lib/make-icon.sh
#
# Requirements:
#   - macOS (sips, iconutil)
#   - pnpm install (playwright browsers)
#   - the Chip Display Variable font at repo root
set -euo pipefail

PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
REPO_ROOT="$( cd "$PKG_DIR/../.." && pwd )"
FONT="$REPO_ROOT/Chip_Display_Variable-Regular.ttf"
OUT="$PKG_DIR/icon.icns"

if [ ! -f "$FONT" ]; then
  echo "Missing $FONT. The Chip Display font must live at repo root." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Write the HTML source. Font path is absolute so Chromium can load it.
cat >"$TMP/icon.html" <<HTML
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Chip Display Variable';
    src: url('file://$FONT') format('truetype-variations');
    font-weight: 100 900;
  }
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: 1024px; height: 1024px; }
  .icon {
    width: 1024px;
    height: 1024px;
    border-radius: 228px;
    background: #8854F6;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .s {
    font-family: 'Chip Display Variable', sans-serif;
    font-variation-settings: 'wght' 900;
    font-weight: 900;
    color: #78FF2A;
    font-size: 900px;
    line-height: 0.75;
    letter-spacing: -0.04em;
    user-select: none;
  }
</style>
</head>
<body>
<div class="icon"><span class="s">S</span></div>
</body>
</html>
HTML

# Render at 1024×1024 using Playwright (already in devDeps).
# The inline require() keeps this self-contained — no script file to ship.
(
  cd "$REPO_ROOT"
  node -e "
    const { chromium } = require('playwright');
    (async () => {
      const b = await chromium.launch();
      const p = await b.newPage({
        viewport: { width: 1024, height: 1024 },
        deviceScaleFactor: 1,
      });
      await p.goto('file://$TMP/icon.html');
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({
        path: '$TMP/1024.png',
        omitBackground: true,
        clip: { x: 0, y: 0, width: 1024, height: 1024 },
      });
      await b.close();
    })();
  "
)

# Build the iconset with all required macOS sizes.
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
SRC="$TMP/1024.png"

sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"       >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"       >/dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"     >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"     >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_512x512.png"     >/dev/null
cp "$SRC"                   "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUT"
echo "Wrote $OUT ($(du -h "$OUT" | awk '{print $1}'))"
