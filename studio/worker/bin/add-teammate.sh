#!/usr/bin/env bash
# Add a teammate to the Arcade Studio share Worker.
#
# Generates a fresh 64-char hex key, stores it in macOS Keychain under
# the teammate's name, rebuilds ALLOWED_KEYS from every Keychain entry,
# uploads the new secret to the Worker, and redeploys.
#
# Usage:  ./bin/add-teammate.sh <name>
#   e.g.  ./bin/add-teammate.sh alice
#
# The generated key is printed ONCE at the end, ready to paste into
# https://password.link for a one-time Slack DM.

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
if ! [[ "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Name must be lowercase alphanumeric + hyphens (got: $NAME)" >&2
  exit 2
fi

EXISTING=$(keychain_get "$NAME")
if [ -n "$EXISTING" ]; then
  echo "A key for '$NAME' already exists in Keychain." >&2
  echo "To rotate their key, run: ./bin/revoke-teammate.sh $NAME && ./bin/add-teammate.sh $NAME" >&2
  exit 1
fi

WRANGLER=$(wrangler_bin)
NEW_KEY=$(openssl rand -hex 32)

echo "Generating new key for '$NAME'..."
keychain_put "$NAME" "$NEW_KEY"

echo "Rebuilding ALLOWED_KEYS from Keychain..."
ALLOWED=$(build_allowed_keys_value)

echo "Uploading ALLOWED_KEYS to the Worker..."
# shellcheck disable=SC2155
cd "$WORKER_DIR"
printf '%s' "$ALLOWED" | "$WRANGLER" secret put ALLOWED_KEYS >/dev/null

echo "Deploying the Worker..."
"$WRANGLER" deploy >/dev/null

# Current list of authorized names (for your own sanity check).
ALL_NAMES=$(keychain_list_names | paste -sd, -)

cat <<EOF

───────────────────────────────────────────────────────────────
Added '$NAME'.

Authorized teammates are now: $ALL_NAMES

Share key for $NAME (copy this to https://password.link, send the
one-time URL via Slack DM, then close this terminal window):

    $NEW_KEY

After they confirm they've pasted it into Studio → Settings →
"Share to web", the key can't be retrieved again — Keychain keeps
it, but you should not need to look at it in plaintext again.

EOF
