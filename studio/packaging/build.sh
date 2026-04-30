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

# Version: single source of truth is studio/packaging/VERSION. The build
# stamp also appends a short git SHA so intermediate builds from the same
# released version stay distinguishable in logs, Settings UI, and on disk.
# VERSION_BASE → CFBundleShortVersionString + DMG filename.
# VERSION_BUILD (base+sha) → CFBundleVersion + the runtime version label.
VERSION_BASE="$(head -1 "$PKG_DIR/VERSION" | tr -d '[:space:]')"
if [ -z "$VERSION_BASE" ]; then
  echo "studio/packaging/VERSION is empty" >&2
  exit 2
fi
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo "unknown")"
# If the working tree is dirty, mark the SHA so we never mistake a
# locally modified build for a pinned commit.
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  GIT_SHA="${GIT_SHA}-dirty"
fi
VERSION_BUILD="${VERSION_BASE}+${GIT_SHA}"
export VERSION_BASE VERSION_BUILD
echo "==> Version ${VERSION_BUILD}"

echo "==> Cleaning prior build"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"

echo "==> Installing Info.plist and icon"
# Stamp the version into Info.plist so macOS's Finder "Get Info" and
# About box show what we think the build is. Using a temp file + mv is
# BSD-sed safe (no -i "" quirks across macOS/Linux).
sed \
  -e "s|<key>CFBundleShortVersionString</key>[[:space:]]*<string>[^<]*</string>|<key>CFBundleShortVersionString</key><string>${VERSION_BASE}</string>|" \
  -e "s|<key>CFBundleVersion</key>[[:space:]]*<string>[^<]*</string>|<key>CFBundleVersion</key><string>${VERSION_BUILD}</string>|" \
  "$PKG_DIR/Info.plist" > "$CONTENTS/Info.plist"
cp "$PKG_DIR/icon.icns"  "$RESOURCES/icon.icns"

# Drop a version.json next to the Info.plist so the runtime can read it
# without shelling out to /usr/libexec/PlistBuddy. Referenced by the
# /api/version endpoint wired up in server/middleware/version.ts.
cat > "$RESOURCES/version.json" <<EOF
{
  "base": "${VERSION_BASE}",
  "build": "${VERSION_BUILD}",
  "gitSha": "${GIT_SHA}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Copy the changelog into Resources/ so the "What's new" modal in Settings
# can serve the current version's release notes without shipping the whole
# docs/ tree inside the app. Source of truth stays in studio/CHANGELOG.md.
if [ -f "$REPO_ROOT/studio/CHANGELOG.md" ]; then
  cp "$REPO_ROOT/studio/CHANGELOG.md" "$RESOURCES/CHANGELOG.md"
fi

echo "==> Downloading Node ($NODE_ARCH)"
bash "$PKG_DIR/lib/download-node.sh" "$RESOURCES/node" "$NODE_ARCH"

echo "==> Downloading AWS CLI"
bash "$PKG_DIR/lib/download-awscli.sh" "$RESOURCES/awscli"

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
echo "✓ Built: $APP (${VERSION_BUILD})"
du -sh "$APP"
