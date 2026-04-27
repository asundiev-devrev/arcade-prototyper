# Roadmap

Prioritized list of enhancements for Arcade Studio. Items are grouped by priority (P0–P2) and roughly ordered within each tier.

## P0 — Stability and trust

- **Studio shell theme switching.** The toggle in the top bar currently switches only the iframe. Extend it to re-theme the Studio chrome (chat pane, viewport header, dev panel) so dark mode is usable end to end.
- **Consistent chat history across turns.** Some tool calls and narrations vanish or fail to re-render after the agent finishes. Audit the SSE → `chat-history.json` → UI path and make the post-turn state authoritative.

## P1 — Readable streaming output

Rewrite the agent-activity rendering in the chat pane to be structured and scannable. Tool calls should show the verb + truncated args; results should be summarized rather than dumped as raw JSON. Reference: Claude.ai's activity feed or Lovable's console output. This unblocks designers to understand what the agent is doing at a glance.

## P1 — Loading and success feedback

Replace silent long operations with explicit states:
- Creating a project — spinner + "creating…" copy.
- Frame generation — progress indicator in the viewport area, not just the chat pane.
- Vercel deploy — toast on publish with a click-to-copy link.
- Figma fetch — inline chip status (loading / attached / failed).

## P1 — Project dashboard polish

- Replace placeholder tint cover images on the project list with the latest generated frame thumbnail (`thumbnails/` already holds PNGs — wire them in).
- Surface the active DevRev PAT / AWS SSO status from the project list so users can tell at a glance whether the environment is ready before they open a project.

## P2 — Multi-frame workflows

- "Duplicate frame" is stubbed (`FrameCard.duplicateFrame` is a TODO) — implement server-side copy.
- Frame reorder within a project.

## P2 — Cross-platform support

Today everything assumes macOS paths (`~/Library/Application Support/...`) and dependencies (`brew`). Port the project storage root and preflight checks to Linux/Windows so the tool is usable outside DevRev laptops.
