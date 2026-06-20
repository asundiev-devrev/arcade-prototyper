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
  throttle)
    # Bedrock rate limit: init, then go silent on stdout while emitting a
    # ThrottlingException on stderr (as the real CLI does), then hang. The
    # studio stderr watchdog should detect the throttle and kill us fast,
    # well before the stall/timeout budget.
    printf '{"type":"system","subtype":"init","session_id":"sess-throttle"}\n'
    printf 'ERROR: ThrottlingException: Too many requests, please wait before trying again. (HTTP 429)\n' >&2
    sleep 30
    ;;
  *) exit 2 ;;
esac
