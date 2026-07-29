#!/usr/bin/env bash
# Fake claude CLI — scenario: a chatty turn emitting many sentinel lines spread
# across THREE narration messages (4 + 4 + 3).
#
# extractProposedMemories caps per MESSAGE, so without a turn-level cap this
# writes 9 rows from one turn — past a limit that reads like it bounds the turn.
#
# Simulate a real frame write so the no-changes detector does NOT fire.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
printf '{"type":"system","subtype":"init","session_id":"sess-memory-flood"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working.\\n\\n\\u27d0 remember: project | fact a one\\n\\u27d0 remember: project | fact a two\\n\\u27d0 remember: project | fact a three\\n\\u27d0 remember: project | fact a four"}]}}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"\\u27d0 remember: project | fact b one\\n\\u27d0 remember: project | fact b two\\n\\u27d0 remember: project | fact b three\\n\\u27d0 remember: project | fact b four"}]}}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Done.\\n\\n\\u27d0 remember: project | fact c one\\n\\u27d0 remember: project | fact c two\\n\\u27d0 remember: project | fact c three\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
