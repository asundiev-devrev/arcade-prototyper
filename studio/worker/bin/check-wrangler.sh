#!/usr/bin/env bash
# Pre-deploy lint for studio/worker/wrangler.toml. Fails loudly if the
# KV_RENDEZVOUS namespace id is still the placeholder. Wired into
# `pnpm run worker:deploy` so a forgotten provisioning step can't silently
# ship a Worker that points at no KV namespace.
set -euo pipefail

WRANGLER="$(dirname "$0")/../wrangler.toml"

if grep -qE '^[[:space:]]*id[[:space:]]*=[[:space:]]*"REPLACE_WITH_REAL_NAMESPACE_ID"' "$WRANGLER"; then
  echo "ERROR: $WRANGLER still contains REPLACE_WITH_REAL_NAMESPACE_ID." >&2
  echo "Run: cd studio/worker && wrangler kv namespace create RENDEZVOUS" >&2
  echo "Then paste the returned id into the [[kv_namespaces]] block." >&2
  exit 1
fi
