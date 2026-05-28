#!/usr/bin/env bash
# Fake claude CLI — scenario: assistant produces a clean response that
# satisfies the deviations contract on shape, but never actually writes
# any file. Used to verify the chat middleware appends a "no frame
# changes" warning trailer in this case.
#
# DO NOT touch frames/ or shared/ here — the whole point is that the
# subprocess "claims" work without performing any.
if [ -n "$ARCADE_TEST_PROMPT_OUT" ]; then
  printf "%s\n" "$@" > "$ARCADE_TEST_PROMPT_OUT"
fi
printf '{"type":"system","subtype":"init","session_id":"sess-no-changes"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Split the skill list into two columns.\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
