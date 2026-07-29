#!/usr/bin/env bash
# Fake claude CLI — scenario: the sentinel arrives on a line that ALSO carries
# the journey marker (`→ `).
#
# The stream parser classifies `→ ` lines into `journey` events, which bypass the
# memory seam in chat.ts entirely — so the plumbing line rendered to the designer
# verbatim and the fact was never recorded.
#
# Simulate a real frame write so the no-changes detector does NOT fire.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
printf '{"type":"system","subtype":"init","session_id":"sess-memory-journey"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"\\u2192 \\u27d0 remember: project | journey-smuggled fact\\n\\nBuilt the page.\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
