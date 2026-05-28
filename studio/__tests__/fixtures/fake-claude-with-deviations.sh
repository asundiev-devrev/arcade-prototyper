#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a response WITH a valid
# `### Deviations` section. Used to verify the middleware passes the
# response through unchanged.
#
# Simulate a real frame write so the no-changes detector does NOT fire and
# pollute the assertion. We're testing the deviations contract here.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-has-dev"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the frame.\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
