# Session handoff — 2026-04-29

Short-form snapshot so a fresh session can pick up cold. The broader
project status is in `STATUS.md`; this doc is specifically about the
generator-reliability work from the past few days.

## Where we started

Generator was producing "close but never right" frames at best, and
most of the time failing silently with no output. Successful runs
were rare; failed ones hung for minutes and then blanked the UI.

## Where we are now

First successful end-to-end vista generation landed on
`list-view-14` (2026-04-29). Frame runs, uses the kit, and isn't a
hand-rolled wall of divs. Visual fidelity vs production is still
loose — mock data is duplicated, counts are misread, group rail is
collapsed. But the infrastructure now *supports* iteration instead
of blocking it.

## What changed across the recent commits

In order, most recent first:

1. **`24d72b3` — Tighten prompt against source re-reads and extend hard timeout.**
   Rewrote the "don't read composite sources" rule to target behavior
   instead of tool name. Added a "Tool budget" section listing the
   exploration patterns agents were using (`ls`/`find`, `grep | awk`,
   re-reading Figma to verify). Bumped hard timeout 300s → 420s.

2. **`462f5d0` — Fill in vista kit gaps generators kept working around.**
   Added `VistaRow.Select` (leading checkbox), `VistaFilterPill`
   (segmented filter chip), `VistaPagination` (footer band).
   Upgraded `NavSidebar.Item` to accept `icon`, `trailing`, `label`,
   `indent` props the agents were already trying to pass. Regenerated
   `KIT-MANIFEST.md`.

3. **`2dc6a1b` — Add model selector and expandable tool-call detail.**
   Settings modal gets Sonnet/Opus/Haiku picker, persists to
   `settings.json` → threaded through to `runClaudeTurn --model`.
   Tool-call rows in the chat UI now expand to show full call +
   result with live elapsed-time counter.

4. **`a050de7` — Harden chat middleware against Bedrock stalls.**
   `runClaudeTurnWithRetry` auto-retries on 120s-silent stalls via
   `--resume sessionId`. `--bare` flag strips user plugin MCP
   handshakes that were wedging turns at boot. New `hasBedrockAuth()`
   preflight recognizes `AWS_BEARER_TOKEN_BEDROCK` (keychain-read
   bearer token) in addition to SigV4. Crash logs persist to
   `last-error.log` + `last-stdout.log` in each project dir.

5. **`31e8e4b` — Generate KIT-MANIFEST from kit source and trim prompt.**
   Auto-extracted single-file reference replaces per-composite source
   reads. `@counterexample` + `@tokens` JSDoc tags surface as
   dedicated manifest sections. Template dropped "eight principles"
   to four rules, removed ritual steps, added "Common wrong choices"
   table and primitives quick-ref (25+ arcade components with prop
   enums, so agents don't read story files).

6. **`9969433` — Fix Vista composite tokens and add VistaRow.**
   Replaced invented tokens (`--bg-interactive-primary-resting`,
   `--surface-overlay-hovered`) with real arcade-gen tokens.
   `VistaRow` captures the canonical row + column vocabulary so
   generated frames stop inventing per-cell styles.

## Key files to know

- `studio/prototype-kit/KIT-MANIFEST.md` — auto-generated. Single
  reference the agent consults for kit APIs. Regenerates on kit
  source change via `kitManifestPlugin`.
- `studio/templates/CLAUDE.md.tpl` — rendered into each project's
  `CLAUDE.md`. The generator's system-prompt-equivalent.
- `studio/server/claudeCode.ts` — spawns the claude CLI with
  `--bare`, threads model + stall detection + crash logging.
- `studio/server/middleware/chat.ts` — per-turn: reads model setting,
  calls `runClaudeTurnWithRetry`, writes crash logs on failure.
- `studio/prototype-kit/composites/` — every kit composite. Each
  `.tsx` header JSDoc feeds the manifest.
- `~/Library/Application Support/arcade-studio/projects/<slug>/` —
  where each project lives. `last-error.log` + `last-stdout.log`
  here on crash.

## What's still broken / loose

1. **Mock data realism.** Agent duplicates IDs across rows. Not a
   kit problem; a prompt rule about "each mock row gets a distinct
   identifier" might fix it.
2. **Title count parsing.** `16,556` got read as `160.58`. Could be
   a prompt rule or a visual-recognition quirk.
3. **Empty sidebar sections.** Agent renders the workspace heading
   but doesn't populate items when Figma has them at low contrast.
4. **Primary CTA color.** Arcade's `Button variant="primary"` is a
   dark/inverted button. DevRev's vista "+ Issue" is blue. Not a
   bug — but we should add a `VistaPrimaryButton` or a variant
   override so vista CTAs render DevRev-blue automatically.
5. **Agent occasionally uses `Bash cat` on kit sources.** Latest
   prompt tightens this at the behavior level ("don't consume the
   source regardless of tool") but it's a behavior rule, not an
   enforced gate. If it recurs we can add a studio-side read filter.
6. **Group rail fallback.** When Figma's groups aren't obvious, agent
   collapses to `<VistaGroupRail.Item label="All" />`. Worth
   documenting: "render the rail only when Figma shows multiple
   groups on the left — omit it otherwise".

## Config knobs

- **Model** — Settings modal → "Generation model". Stored in
  `~/Library/Application Support/arcade-studio/settings.json` as
  `studio.model`. Env var `ARCADE_STUDIO_MODEL` also works.
- **Bedrock auth** — `AWS_BEARER_TOKEN_BEDROCK` in the launching
  shell, OR SigV4 creds resolvable by `aws sts get-caller-identity`.
- **Timeouts (code-level)** — in `claudeCode.ts`: `timeoutMs`
  defaults to 420,000 (hard), `stallMs` defaults to 120,000 (silent
  stdout).

## Debugging a failed turn

1. `cat ~/Library/Application\ Support/arcade-studio/projects/<slug>/last-error.log`
2. `tail -c 4000 ~/Library/Application\ Support/arcade-studio/projects/<slug>/last-stdout.log`
3. `grep -oE '"name":"[^"]+","input":\{[^}]*\}' <last-stdout.log> | head -25`
   to see the full tool-call sequence.
4. Interpreting `exitCode: 143`:
   - `timedOut: true, stalled: false` — hard 420s timeout. Agent was
     actively emitting; probably legitimately slow on a large input.
     Consider bumping timeout, or the agent was over-reading.
   - `timedOut: false, stalled: true` — 120s of silence. Bedrock wedged
     mid-turn. Auto-retry should have kicked in; if both attempts
     stalled, the error message surfaces that.
   - `exitCode !== 143` — actual crash. Check `--- stderr ---` section.

## Suggested next priorities

1. Run `list-view-15` (or equivalent) with the kit upgrades from
   commit `462f5d0` live. See how much the agent uses the new
   `NavSidebar.Item` props, `VistaPagination`, `VistaFilterPill`.
2. If the agent uses them: close the remaining cosmetic gaps
   (duplicate IDs, count parsing) via small prompt rules.
3. If the agent ignores them: the kit composites need to be more
   discoverable — either move them higher in `KIT-MANIFEST.md` or
   add a "when you see a filter pill / pagination / checkbox column
   in Figma, here's the kit piece" hint.
4. Add `VistaPrimaryButton` if vista CTAs should auto-render as
   DevRev-blue.
