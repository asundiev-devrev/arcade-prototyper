#!/usr/bin/env bash
# Shared Keychain helpers for the Arcade Studio share Worker.
#
# MUST be sourced from bash, not zsh or sh. Word-splitting semantics
# differ between shells and several of the helpers here rely on bash's
# default IFS handling. Guard up front so a zsh-sourced caller fails
# loudly instead of silently producing an empty ALLOWED_KEYS value —
# which, uploaded, locks every teammate out of sharing.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: _keychain.sh must be sourced from bash (e.g. via ./bin/add-teammate.sh)." >&2
  echo "       Current shell does not appear to be bash." >&2
  return 1 2>/dev/null || exit 1
fi
#
# We store one Keychain entry per teammate under:
#   service = arcade-studio-share-key
#   account = <teammate name>     e.g. "andrey", "alice"
#   password = <64-char hex share key>
#
# Keychain is the master list — wrangler's ALLOWED_KEYS secret is a
# derived snapshot of whatever these entries hold at deploy time.

set -euo pipefail

KEYCHAIN_SERVICE="arcade-studio-share-key"

# List all teammate names currently in Keychain.
# Uses `security dump-keychain` because there's no direct "list all items
# for a service" command — we filter the dump by service. The dump format
# is stable across macOS versions back to 10.9.
keychain_list_names() {
  # `security dump-keychain` emits each item as a block of fields; the
  # service and account lines look like:
  #   "svce"<blob>="arcade-studio-share-key"
  #   "acct"<blob>="andrey"
  # We look for any "svce" line matching our service, then grab the
  # nearest "acct" line that follows. Using POSIX awk (macOS default) —
  # no gawk-only features like three-arg match() or mktime().
  #
  # Fields can arrive in either order across macOS versions, so we
  # buffer within each item delimited by the "attributes:" header line
  # that precedes every generic-password entry.
  security dump-keychain 2>/dev/null \
    | awk -v svc="$KEYCHAIN_SERVICE" '
        function extract_val(line) {
          sub(/^[^=]*="/, "", line)
          sub(/"[[:space:]]*$/, "", line)
          return line
        }
        function flush() {
          if (this_svc == svc && this_acct != "") print this_acct
          this_svc=""; this_acct=""
        }
        /^attributes:/ { flush() }
        /"svce"<blob>=/ { this_svc=extract_val($0) }
        /"acct"<blob>=/ { this_acct=extract_val($0) }
        END            { flush() }
      ' \
    | sort -u
}

# Read the secret for a given teammate. Empty output if not found.
keychain_get() {
  local name="$1"
  security find-generic-password -a "$name" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true
}

# Upsert a teammate's key (delete-then-add is the idempotent pattern;
# `add-generic-password -U` exists but is flaky on older macOS).
keychain_put() {
  local name="$1" value="$2"
  security delete-generic-password -a "$name" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
  security add-generic-password \
    -a "$name" \
    -s "$KEYCHAIN_SERVICE" \
    -w "$value" \
    -l "Arcade Studio share key — $name" \
    -j "Arcade Studio share key for teammate: $name"
}

# Remove a teammate's key. Returns 0 whether it existed or not.
keychain_delete() {
  local name="$1"
  security delete-generic-password -a "$name" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 || true
}

# Build the comma-separated ALLOWED_KEYS value from every Keychain entry.
# Order is stable (alphabetized by name) so redeploys produce identical
# secret values when nothing changed.
build_allowed_keys_value() {
  local names
  names=$(keychain_list_names)
  local first=1 key
  for name in $names; do
    key=$(keychain_get "$name")
    [ -z "$key" ] && continue
    if [ $first -eq 1 ]; then
      printf '%s' "$key"; first=0
    else
      printf ',%s' "$key"
    fi
  done
}

# Resolve the wrangler binary the same way it was installed (pnpm global).
wrangler_bin() {
  if command -v wrangler >/dev/null 2>&1; then echo wrangler; return; fi
  if [ -x "$HOME/Library/pnpm/wrangler" ]; then echo "$HOME/Library/pnpm/wrangler"; return; fi
  echo "wrangler not found. Install with: pnpm add -g wrangler@latest" >&2
  exit 1
}
