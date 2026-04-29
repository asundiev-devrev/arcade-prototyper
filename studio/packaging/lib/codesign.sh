#!/bin/bash
# Usage: codesign.sh <path-to-.app>
# Ad-hoc signs the .app so Gatekeeper on Apple Silicon does not quarantine
# it as "damaged". First launch still requires right-click → Open once.
set -euo pipefail

APP="${1:?app path required}"

if [ ! -d "$APP" ]; then
  echo "Not a directory: $APP" >&2
  exit 1
fi

codesign --force --deep --sign - --timestamp=none "$APP"
codesign -dv "$APP"
echo "Ad-hoc signed: $APP"
