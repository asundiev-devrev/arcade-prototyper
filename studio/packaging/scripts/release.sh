#!/usr/bin/env bash
#
# Cut a notarized auto-updatable release of Arcade Studio.
#
# Produces dmg + zip + latest-mac.yml, notarizes BOTH artifacts, staples the
# .app, and publishes all three to the public mirror repo so the in-app
# auto-updater (electron-updater) can find and apply the update.
#
# Prereqs (same as the old manual flow in studio/CLAUDE.md):
#   - notarytool keychain profile "arcade-studio-notarize" set up
#   - gh authenticated with access to asundiev-devrev/arcade-studio-releases
#   - run from the repo root
#
# Usage:  bash studio/packaging/scripts/release.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
MIRROR="asundiev-devrev/arcade-studio-releases"
DIST="dist"
APP="$DIST/mac-arm64/Arcade Studio.app"
DMG="$DIST/Arcade Studio-${VERSION}-arm64.dmg"
ZIP="$DIST/Arcade Studio-${VERSION}-arm64-mac.zip"
YML="$DIST/latest-mac.yml"

echo "==> Releasing Arcade Studio ${VERSION}"

# 1. Build dmg + zip + latest-mac.yml (no auto-publish; we publish manually
#    after notarizing). --publish never matches studio:pack.
echo "==> Packing (dmg + zip)…"
pnpm run kit:build
bash studio/packaging/scripts/fetch-cli-deps.sh
pnpm exec tsc -p electron/tsconfig.json
node studio/packaging/scripts/gen-telemetry-config.mjs
pnpm exec electron-builder --mac --config electron-builder.yml --publish never

for f in "$DMG" "$ZIP" "$YML"; do
  [ -f "$f" ] || { echo "ERROR: expected build artifact missing: $f"; exit 1; }
done

# 2. Notarize the dmg, then staple the .app + dmg. The .app must be stapled
#    BEFORE we re-zip it (Gatekeeper checks the extracted app's ticket; a zip
#    itself can't be stapled).
echo "==> Notarizing dmg…"
xcrun notarytool submit "$DMG" --keychain-profile arcade-studio-notarize --wait
echo "==> Stapling .app + dmg…"
xcrun stapler staple "$APP"
xcrun stapler staple "$DMG"

# 3. Re-zip the now-stapled .app, replacing electron-builder's (pre-staple) zip.
#    ditto produces the archive format electron-updater expects.
echo "==> Re-zipping stapled .app…"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"

# Rename to the space→dash "safe" name electron-updater expects in the manifest
# url. The uploaded asset, the on-disk file, and the manifest url must all be
# byte-identical or the auto-update download 404s.
SAFE_ZIP="$DIST/$(basename "$ZIP" | tr ' ' '-')"
if [ "$ZIP" != "$SAFE_ZIP" ]; then mv -f "$ZIP" "$SAFE_ZIP"; fi

# 4. Rewrite latest-mac.yml's sha512/size to match the re-zipped bytes.
echo "==> Rewriting latest-mac.yml for the stapled zip…"
node studio/packaging/scripts/rewrite-latest-mac.mjs "$SAFE_ZIP" "$YML" "$VERSION"

# 5. Notarize the (stapled-app) zip too.
echo "==> Notarizing zip…"
xcrun notarytool submit "$SAFE_ZIP" --keychain-profile arcade-studio-notarize --wait

# 6. Publish dmg + zip + latest-mac.yml to the mirror. The dmg keeps its on-disk
#    space name as before — it's manual-install-only, not the auto-update payload.
echo "==> Publishing v${VERSION} to ${MIRROR}…"
NOTES_FILE="$(mktemp)"
awk "/^## \\[${VERSION}\\]/{f=1;next} /^## \\[/{f=0} f" studio/CHANGELOG.md > "$NOTES_FILE" || true
gh release create "v${VERSION}" \
  "$DMG" "$SAFE_ZIP" "$YML" \
  --repo "$MIRROR" \
  --title "Arcade Studio ${VERSION}" \
  --notes-file "$NOTES_FILE" \
  --latest
rm -f "$NOTES_FILE"

echo "==> Done. v${VERSION} published with dmg + zip + latest-mac.yml."
