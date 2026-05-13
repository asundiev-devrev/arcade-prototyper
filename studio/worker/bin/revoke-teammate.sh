#!/usr/bin/env bash
# Revoke a teammate's access to the Arcade Studio share Worker.
#
# Removes their Keychain entry, rebuilds ALLOWED_KEYS from the remaining
# entries, uploads the new secret to the Worker, and redeploys.
#
# Revocation takes effect immediately after `wrangler deploy` finishes —
# the teammate's next share attempt fails with a 401 invalid_key.
#
# Usage:  ./bin/revoke-teammate.sh <name>
#   e.g.  ./bin/revoke-teammate.sh alice

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=./_keychain.sh
source "$SCRIPT_DIR/_keychain.sh"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <name>"
  echo "  e.g. $0 alice"
  exit 2
fi

NAME="$1"

EXISTING=$(keychain_get "$NAME")
if [ -z "$EXISTING" ]; then
  echo "No Keychain entry found for '$NAME'. Nothing to revoke."
  echo "(Current teammates: $(keychain_list_names | paste -sd, -))"
  exit 0
fi

WRANGLER=$(wrangler_bin)

echo "Removing Keychain entry for '$NAME'..."
keychain_delete "$NAME"

echo "Rebuilding ALLOWED_KEYS from remaining Keychain entries..."
ALLOWED=$(build_allowed_keys_value)

# Guard against nuking the last key — the Worker still boots, but share
# would 401 for everyone including you.
if [ -z "$ALLOWED" ]; then
  echo "WARNING: no teammates remain after this revoke." >&2
  echo "The Worker will reject all share attempts until you add someone." >&2
fi

echo "Uploading ALLOWED_KEYS to the Worker..."
cd "$WORKER_DIR"
printf '%s' "$ALLOWED" | "$WRANGLER" secret put ALLOWED_KEYS >/dev/null

echo "Deploying the Worker..."
"$WRANGLER" deploy >/dev/null

ALL_NAMES=$(keychain_list_names | paste -sd, -)
echo
echo "Revoked '$NAME'. Authorized teammates are now: ${ALL_NAMES:-<none>}"
