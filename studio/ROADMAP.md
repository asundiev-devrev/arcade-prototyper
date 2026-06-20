# Roadmap

Prioritized list of enhancements for Arcade Studio. Items are grouped by
priority (P0–P2) and roughly ordered within each tier. Shipped items are no
longer listed here — see [STATUS.md](./STATUS.md) for what works today.

## P0 — Rebuilds

- **Multiplayer (live sharing + spectator).** The legacy session-invite (Plan 2a) and shared-project relay (Plan 2b) implementations were removed to clear the tree. Rebuild from scratch: a host shares a project, invited teammates watch frames generate live and leave comments.
- **Richer Figma export.** The legacy "swap" export strategy was removed; the fiber-walk export remains. Extend it toward higher-fidelity, round-trippable export (layout + component swap with containment matching).

## P0 — Generation fidelity

Systemic accuracy over per-frame patching. Grow the kit-emit `kitMappings`
coverage, keep the drift audit (`pnpm run studio:audit`) green, and close the
gaps between a Figma reference and the generated frame.

## P1 — Project dashboard polish

- Cover images for the project list (a frame preview, generated on demand — the old `thumbnails/` capture path was removed because it depended on an uninstalled puppeteer).
- Surface the active DevRev PAT / AWS SSO status from the project list so users can tell at a glance whether the environment is ready before they open a project.

## P2 — Multi-frame workflows

- "Duplicate frame" — server-side copy of a frame within a project.
- Frame reorder within a project.

## P2 — Cross-platform support

Today everything assumes macOS paths (`~/Library/Application Support/...`) and
dependencies. Port the project storage root and preflight checks to
Linux/Windows so the tool is usable outside DevRev laptops.
