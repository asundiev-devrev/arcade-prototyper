#!/usr/bin/env bash
# List all teammates with an Arcade Studio share key in Keychain.
#
# Keys themselves are NOT printed — only names. This is the master
# list; the Worker's ALLOWED_KEYS secret is a derived snapshot.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_keychain.sh
source "$SCRIPT_DIR/_keychain.sh"

NAMES=$(keychain_list_names)
if [ -z "$NAMES" ]; then
  echo "No teammates configured."
  exit 0
fi

echo "Teammates with an Arcade Studio share key:"
for name in $NAMES; do
  echo "  - $name"
done
