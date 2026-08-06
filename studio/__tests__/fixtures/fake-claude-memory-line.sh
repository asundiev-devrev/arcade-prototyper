#!/usr/bin/env bash
# Fake claude CLI — scenario: the assistant obeys the response-shape memory
# instruction and emits a `⟐ remember:` sentinel line. Used to verify the
# middleware strips it from BOTH the live SSE stream and chat-history.json.
#
# Three narration messages, covering the shapes that actually occur:
#   1. summary + sentinel + Deviations in one message (the common case)
#   2. a message that is NOTHING but a sentinel line (must vanish entirely)
#   3. a message echoing the template placeholder (must not be recorded, must
#      still be stripped)
#
# Simulate a real frame write so the no-changes detector does NOT fire and
# pollute the assertions.
mkdir -p frames/01-fake
printf 'export default () => null;\n' > frames/01-fake/index.tsx
printf '{"type":"system","subtype":"init","session_id":"sess-memory"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Built the settings page.\\n\\n\\u27d0 remember: project | Filter chips go in the toolbar\\n\\n### Deviations\\n\\nNone."}]}}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"\\u27d0 remember: global | Active nav rows use neutral gray"}]}}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"\\u27d0 remember: <global|project> | <the preference, one short sentence>"}]}}\n'
printf '{"type":"result","subtype":"success"}\n'
