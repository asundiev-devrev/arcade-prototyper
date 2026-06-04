#!/usr/bin/env bash
# Fake claude CLI for testing stale-session auto-recovery.
# Fails like the real CLI does on a dangling `--resume <id>` (non-zero exit
# with "No conversation found..." on stderr). When invoked WITHOUT --resume
# (i.e. a fresh session), it succeeds and emits a new session id.
resume=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--resume" ]; then resume="$a"; fi
  prev="$a"
done
if [ -n "$resume" ]; then
  printf 'No conversation found with session ID: %s\n' "$resume" >&2
  exit 1
fi
printf '{"type":"system","subtype":"init","session_id":"fresh-sess-002"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Recovered"}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
