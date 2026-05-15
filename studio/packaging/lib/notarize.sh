#!/bin/bash
# Usage: notarize.sh <path-to-dmg>
#
# Submits the DMG to Apple notarization and staples the receipt to it
# in-place when notarization succeeds. After stapling, the DMG works on
# offline first-launch machines (Gatekeeper finds the receipt locally
# without needing a network round-trip).
#
# Requires:
#   - The DMG was signed with a Developer ID Application cert.
#   - The .app inside was signed with --options runtime + entitlements.
#   - A keychain profile named "arcade-studio-notarize" exists, created
#     once via:
#       xcrun notarytool store-credentials arcade-studio-notarize \
#         --apple-id <your-id> --team-id <TEAMID> --password <app-pw>
set -euo pipefail

DMG="${1:?dmg path required}"
PROFILE="${NOTARIZE_PROFILE:-arcade-studio-notarize}"

if [ ! -f "$DMG" ]; then
  echo "Not a file: $DMG" >&2
  exit 1
fi

echo "==> Submitting $DMG to notarization (profile: $PROFILE)"
echo "    This typically takes 1-5 minutes."

# `--wait` blocks until Apple finishes; `--output-format json` makes the
# status machine-readable so we can fail loudly on rejection.
SUBMIT_LOG="$(dirname "$DMG")/notarize-$(date +%Y%m%d-%H%M%S).log"
xcrun notarytool submit "$DMG" \
  --keychain-profile "$PROFILE" \
  --wait \
  --output-format json | tee "$SUBMIT_LOG"

# Extract the status from the last line of JSON (notarytool prints
# multiple JSON objects; the final one has the terminal status).
STATUS="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")"

if [ "$STATUS" != "Accepted" ]; then
  echo "" >&2
  echo "ERROR: notarization status was '$STATUS', not 'Accepted'." >&2
  echo "Submission log saved to: $SUBMIT_LOG" >&2
  echo "" >&2
  echo "To inspect the rejection reason:" >&2
  SUBMISSION_ID="$(tail -1 "$SUBMIT_LOG" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || echo "")"
  if [ -n "$SUBMISSION_ID" ]; then
    echo "  xcrun notarytool log $SUBMISSION_ID --keychain-profile $PROFILE" >&2
  fi
  exit 1
fi

echo "==> Stapling receipt to DMG"
xcrun stapler staple "$DMG"

echo "==> Verifying"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG" 2>&1 || true

echo ""
echo "✓ Notarized + stapled: $DMG"
