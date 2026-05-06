#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a response with NO
# `### Deviations` section. Used to verify the chat middleware appends a
# warning trailer.
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-no-dev"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the frame."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
