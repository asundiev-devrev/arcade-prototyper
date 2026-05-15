#!/bin/bash
# Usage: notarize-app.sh <path-to-.app>
#
# Zips the signed .app, submits it to Apple notarization, then staples
# the receipt onto the .app in-place. Without this, Gatekeeper's runtime
# deep-verify fails on extracted .apps with "Arcade Studio is damaged"
# even when the surrounding DMG is itself notarized — the DMG's ticket
# does not propagate into the .app it contained.
#
# Requires:
#   - The .app was signed with --options runtime + entitlements
#     (Developer ID Application identity, hardened runtime, secure timestamp).
#   - A keychain profile named "arcade-studio-notarize" exists, created
#     once via:
#       xcrun notarytool store-credentials arcade-studio-notarize \
#         --apple-id <your-id> --team-id <TEAMID> --password <app-pw>
#
# Skipped silently when CODESIGN_IDENTITY is unset (dev rebuilds).
set -euo pipefail

APP="${1:?app path required}"
PROFILE="${NOTARIZE_PROFILE:-arcade-studio-notarize}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

if [ -z "${CODESIGN_IDENTITY:-}" ]; then
  echo "==> Skipping .app notarization (CODESIGN_IDENTITY not set)"
  exit 0
fi

ZIP="$(dirname "$APP")/$(basename "$APP" .app)-notarize.zip"
echo "==> Zipping $APP for notarization"
# `ditto -c -k --keepParent` is what Apple's notarytool docs recommend —
# preserves resource forks and symlinks that a plain `zip` would mangle.
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo "==> Submitting .app to notarization (profile: $PROFILE)"
echo "    This typically takes 1-5 minutes."

SUBMIT_LOG="$(dirname "$APP")/notarize-app-$(date +%Y%m%d-%H%M%S).log"
xcrun notarytool submit "$ZIP" \
  --keychain-profile "$PROFILE" \
  --wait \
  --output-format json | tee "$SUBMIT_LOG"

STATUS="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")"

if [ "$STATUS" != "Accepted" ]; then
  echo "" >&2
  echo "ERROR: .app notarization status was '$STATUS', not 'Accepted'." >&2
  echo "Submission log saved to: $SUBMIT_LOG" >&2
  SUBMISSION_ID="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")"
  if [ -n "$SUBMISSION_ID" ]; then
    echo "  xcrun notarytool log $SUBMISSION_ID --keychain-profile $PROFILE" >&2
  fi
  exit 1
fi

echo "==> Stapling receipt to .app"
xcrun stapler staple "$APP"

echo "==> Verifying"
xcrun stapler validate "$APP"

# Clean up the zip — Apple has the receipt stapled into the .app now,
# the zip was just transport.
rm -f "$ZIP"

echo ""
echo "✓ Notarized + stapled: $APP"
