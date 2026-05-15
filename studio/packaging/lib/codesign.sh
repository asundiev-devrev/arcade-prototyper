#!/bin/bash
# Usage: codesign.sh <path-to-.app>
#
# Signs the .app for distribution. Mode is controlled by CODESIGN_IDENTITY:
#
#   CODESIGN_IDENTITY=""        → ad-hoc sign (dev rebuilds, local testing)
#   CODESIGN_IDENTITY="<id>"    → Developer ID sign + hardened runtime
#                                 (release builds; required for notarization)
#
# When signing for release, every helper binary inside Contents/Resources/
# must be signed first, in dependency order: leaf binaries before bundles
# that contain them. Apple's `--deep` flag skips a lot — we don't trust it.
set -euo pipefail

APP="${1:?app path required}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

IDENTITY="${CODESIGN_IDENTITY:-}"
PKG_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
ENTITLEMENTS="$PKG_DIR/entitlements.plist"

if [ -z "$IDENTITY" ]; then
  echo "==> Ad-hoc signing (no CODESIGN_IDENTITY set)"
  codesign --force --deep --sign - --timestamp=none "$APP"
  codesign -dv "$APP" 2>&1 || true
  echo "Ad-hoc signed: $APP"
  exit 0
fi

echo "==> Developer ID signing with: $IDENTITY"

if [ ! -f "$ENTITLEMENTS" ]; then
  echo "Missing entitlements file: $ENTITLEMENTS" >&2
  exit 1
fi

# Sign every Mach-O object inside the bundle, leaves first. We can't
# rely on the execute bit alone — `.node` native add-ons (rolldown,
# lightningcss, tailwindcss-oxide, fsevents, keytar, etc.) ship as
# 0644 from npm and would be silently skipped, then rejected by Apple
# notarization with "The signature of the binary is invalid". So we
# cast a wider net: any *.node / *.dylib / *.so file, plus anything
# with the user execute bit set. This catches every Mach-O member
# while keeping the candidate set small enough that the per-file
# `file` probe doesn't add minutes to the build (a naive `-type f`
# alone would run `file` against ~17k node_modules entries).
# Scripts and other non-Mach-O candidates are filtered out by the
# `grep -q "Mach-O"` check below.
sign_one() {
  local target="$1"
  codesign --force \
    --options runtime \
    --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" \
    "$target"
}

echo "==> Signing nested Mach-O binaries"
# `--null` + `read -d ''` handles paths with spaces (the bundle root has one).
while IFS= read -r -d '' bin; do
  if file "$bin" | grep -q "Mach-O"; then
    echo "    $bin"
    sign_one "$bin"
  fi
done < <(find "$APP/Contents/Resources" -type f \
  \( -name "*.node" -o -name "*.dylib" -o -name "*.so" -o -perm -u+x \) -print0)

# Sign nested .app bundles (none today, but keytar ships helper bundles).
while IFS= read -r -d '' nested_app; do
  echo "    $nested_app (nested bundle)"
  sign_one "$nested_app"
done < <(find "$APP/Contents/Resources" -type d -name "*.app" -print0)

# Sign the .framework bundles bundled-Node ships under
# Contents/Resources/node/.../.framework — none currently, but if Node's
# install layout changes this catches them.
while IFS= read -r -d '' fw; do
  echo "    $fw (framework)"
  sign_one "$fw"
done < <(find "$APP/Contents/Resources" -type d -name "*.framework" -print0)

echo "==> Signing the outer bundle"
sign_one "$APP"

echo "==> Verifying signature"
codesign --verify --verbose=2 --strict "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 || true

# Gatekeeper assessment: confirms the signature would be accepted on a
# fresh machine. Won't pass yet (notarization staples come later) but
# reveals problems with the signing itself.
spctl --assess --type execute --verbose=4 "$APP" 2>&1 || \
  echo "    (spctl may report 'rejected' until notarization staples — that's expected)"

echo "Signed: $APP"
