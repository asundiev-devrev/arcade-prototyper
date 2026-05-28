#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a response with NO
# `### Deviations` section. Used to verify the chat middleware appends a
# warning trailer.
#
# Simulate a real frame write so the no-changes detector does NOT also
# fire. We're testing the deviations contract here, not the change detector.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-no-dev"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the frame."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
