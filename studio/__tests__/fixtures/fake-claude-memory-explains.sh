#!/usr/bin/env bash
# Fake claude CLI — scenario: the designer asked HOW memory works, and the reply
# SHOWS the sentinel inside a fenced code block while explicitly saying nothing
# was recorded.
#
# The line is illustrative, not a proposal. Recording it would write a permanent
# every-future-project standing instruction off an explanation, while the reply
# on screen says "I have not recorded anything this turn" — a false memory with
# no cue.
#
# Simulate a real frame write so the no-changes detector does NOT fire.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
printf '{"type":"system","subtype":"init","session_id":"sess-memory-explains"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"You asked how memory works. I record a line like this:\\n\\n```\\n\\u27d0 remember: global | use sentence case for all headings\\n```\\n\\nI have not recorded anything this turn.\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
