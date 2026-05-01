#!/usr/bin/env bash
# Fake claude CLI. Emits stream-json events to stdout, line-by-line.
# Reads user prompt from -p "<msg>". Fixture output is selected via the env var FAKE_CLAUDE_SCENARIO.
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  # The claude CLI takes the prompt as the last non-flag argument. Dumping the
  # full argv is simpler and sufficient for assertion purposes.
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
case "${FAKE_CLAUDE_SCENARIO:-default}" in
  default)
    printf '{"type":"system","subtype":"init","session_id":"sess-001"}\n'
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it"}]}}\n'
    printf '{"type":"result","subtype":"success"}\n'
    ;;
  auth_error)
    printf '{"type":"result","subtype":"error_during_execution","error":"aws sso expired"}\n'
    exit 1
    ;;
  *) exit 2 ;;
esac
