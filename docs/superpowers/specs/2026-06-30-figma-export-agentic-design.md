# Figma Export via Agent — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Area:** `studio/` — Share modal "Export to Figma"

## Problem

Studio's Share modal has an "Export to Figma" button. Clicking it errors with
"Open the Arcade export plugin in Figma, then try again" — because the export
ships a generated script over a WebSocket bridge to a **Figma Desktop Bridge
plugin that was never built**. The pipeline is data-complete and tested up to
that boundary, but the transport is dead, so the feature has never worked for
any user.

The feature is valuable: a live prototype is a great *build* artifact but a poor
*review* artifact (it only exists in motion). Rebuilding it as a still,
annotated flow in Figma makes it reviewable async — PMs, designers, engineers
can comment on individual states, see the whole flow, and jump to buried
screens. (Reference: southleft.substack.com/p/code-prototypes-are-fast-feedback
and the open-source skill github.com/alima-max/prototype-to-figma-skill.)

## Goal

Replace the broken plugin-based export with an **agent-driven export** that uses
the native Figma MCP (no custom plugin) to rebuild selected frames as an
**annotated flow** in the designer's Figma, built from real Arcade
design-system components.

Two product decisions, locked during brainstorming:
- **One-click inside Studio** (not a copy-paste prompt for the user's own editor).
- **Annotated-flow output** (the full article treatment), not a single faithful
  frame.

## Approach (chosen: A — agentic skill)

Studio already spawns a `claude` CLI subprocess for frame generation. For
export, spawn a **second, differently-configured** subprocess: Figma MCP wired
in, a vendored "prototype-to-figma" skill loaded, handed the project's frames +
our curated Arcade→Figma component map. The agent reads frames, infers the flow,
and rebuilds it in Figma with annotations and arrows, then verifies.

Rejected alternatives:
- **B (deterministic transport swap):** feed our existing
  `fiberWalk → SLJ → executePlan` plan to the Figma MCP instead of the dead
  plugin. Rejected as the *primary* approach because that pipeline only does
  single-frame rebuilds; the annotated-flow output (multi-frame, arrows,
  interaction inference) is exactly what it can't do, so an agent is needed
  anyway.
- **C (hybrid):** agent owns flow scaffolding, deterministic swap owns per-frame
  fidelity. Best quality, most integration work. Held as a **phase-2** option if
  fidelity needs it.

## Architecture

```
Share modal → "Export to Figma" (multi-frame select)
   └─ preflight: ping local Figma MCP (127.0.0.1:3845)
        • not reachable → no_figma_mcp state, no spawn
   └─ Studio spawns export subprocess (SEPARATE from generator):
        • --mcp-config → { figma: local Dev Mode MCP }
        • --append-system-prompt → vendored prototype-to-figma skill
        • allowed-tools → Figma MCP read+write tools only
        • input → selected frames' TSX + SLJ + curated Arcade component map
   └─ agent: map components → build one frame per state →
              annotate interactions → draw flow arrows → overview/legend →
              verify (no overlaps, all rows present)
   └─ stream agent narration → modal progress line
   └─ done → Figma file URL + DS-gaps summary
```

### Deleted (dead transport)
- `studio/server/figmaBridge/wsServer.ts` — custom WebSocket bridge.
- `studio/src/export/figma/buildExecuteScript.ts` — ES5 plugin-sandbox script
  builder.
- `studio/server/middleware/figmaExport.ts` — the `to-figma` route that drove
  them. (Confirm during implementation whether `server/middleware/export.ts`
  SLJ-storage routes are still needed; the new path may read SLJ directly.)
- Associated tests: `__tests__/server/figmaBridge/wsServer.test.ts`,
  `__tests__/export/figma/buildExecuteScript.test.ts`.

### Kept and repurposed
- `componentEntries.ts`, `iconEntries.ts`, `tokenMap.ts` — curated Arcade→Figma
  component/icon/token mappings. Rendered into a table injected into the skill
  prompt so the agent swaps by **exact key** instead of fuzzy
  `search_design_system` (which becomes the fallback for unmapped elements).
- `fiberWalk.ts` / `slj.ts` / `inferLayout.ts` / `tokenIndex.ts` — the
  fiber-walk serializer. Its SLJ output (computed styles, layout, token-resolved
  colors) is passed to the agent as a **structured hint** so it reads resolved
  values instead of guessing CSS.

### Why a separate subprocess (not the generator)
The generator is intentionally locked down: `--strict-mcp-config` with no MCP
config, `mcp__figma-console` explicitly disallowed, tools limited to
`Read,Edit,Write,Glob,Grep,Bash`, cwd = project dir (to write frames). Export is
a different job (Figma MCP, read-only on frames). Two separate spawn configs on
the same machinery keeps the generator's guardrails intact.

## Transport: local Figma MCP

**Use the local Figma Dev Mode MCP at `http://127.0.0.1:3845/mcp`**, served by
Figma Desktop when "Enable Dev Mode MCP server" is on. Chosen over the remote
`https://mcp.figma.com/mcp` because:
- No OAuth brokering from inside Studio — it rides the desktop app's existing
  session.
- It's the canonical Dev Mode MCP the article/skill assume.
- Verified live + authenticated on the dev machine during brainstorming
  (`whoami` → andrey.sundiev@devrev.ai, DevRev org, full seat; `:3845`
  listening; `figma_agent` process present).

Remote MCP stays a documented fallback for a later iteration.

### Subprocess flags added vs. the generator
```
--mcp-config <inline JSON>   { "figma": { "type":"http", "url":"http://127.0.0.1:3845/mcp" } }
--strict-mcp-config          (kept — now scopes to OUR config, only the figma server)
--allowedTools               + mcp__figma__{use_figma,search_design_system,get_design_context,
                                            get_metadata,get_variable_defs,create_new_file,whoami}
--append-system-prompt       <vendored skill content>
```
The MCP URL is a constant with a settings override (default `:3845`), not
hardcoded — cheap insurance against Figma changing the port.

### Preflight
Before spawning, Studio pings `127.0.0.1:3845`. Not reachable → `no_figma_mcp`
state with actionable copy + Retry; never spawn a doomed agent.

### Known risk (manual checkpoint, not assumption)
The packaged `.app` bundles its own vendored `claude` binary and runs under
Bedrock auth (`CLAUDE_CODE_USE_BEDROCK=1`). MCP is independent of model auth, and
`--mcp-config` is a standard flag the vendored binary supports — but **whether
the vendored binary inside the .app sandbox actually reaches `:3845`** must be
verified on a real DMG. This is an explicit manual gate in the plan, not a unit
test.

## The skill (fork of alima-max/prototype-to-figma)

A markdown skill (`SKILL.md` + `figma-patterns.md`) vendored in the repo (e.g.
`studio/figma-export-skill/`), shipped in the `.app`, loaded via
`--append-system-prompt`. Self-contained in Studio, versioned with the app — NOT
installed into the user's `~/.claude`.

### Changes from upstream
1. **Inject the curated map; demote guessing.** Generate an Arcade component
   table from `componentEntries.ts` / `iconEntries.ts` / `tokenMap.ts` and paste
   it into the prompt (component → set key + variants; token → variable key).
   Agent swaps by exact key. `search_design_system` becomes the fallback for
   unmapped elements only.
2. **Read frame source + SLJ, not a live browser.** Frames are on disk as React
   TSX (`frames/<slug>/index.tsx`); the SLJ from our fiber-walk is passed as a
   structured hint with resolved styles/layout/colors.
3. **Arcade specifics.** Point `search_design_system` at the Arcade UI Kit
   library; teach token naming (`--fg-*`, `--bg-*`) and the two themes
   (Arcade / DevRev App); set `figma-patterns.md` primitive fallbacks to Arcade
   defaults.
4. **Frames passed up front.** No interactive "which flows?" step — the selected
   frames come from the modal; the agent infers ordering/branches. No mid-run
   questions (a subprocess can't cleanly do interactive back-and-forth).

### Kept from upstream
Flow/annotation/arrow/overview logic; the verify-before-done pass (re-examine
output, confirm nothing overlaps, all mapping rows present); "annotate flows not
tap targets"; "never createComponent"; "never omit an element". The skill header
records the upstream commit forked from, for drift tracing.

## Modal UX + states

The export path uses **multi-frame checkbox** selection (default: all frames in
project order). The deploy/share path keeps its single-frame radio. Same modal,
mode depends on the button.

| State | UI |
|---|---|
| Idle | Frame checkboxes + "Export to Figma" |
| Preflight fail (`no_figma_mcp`) | Inline: "Open Figma Desktop and enable the Dev Mode MCP server (Preferences → Enable Dev Mode MCP), then retry." + Retry. No spawn. |
| Running | Live progress line — agent narration streamed via the generator's stream-json plumbing ("Mapping components… Building Sign-in… Annotating… Verifying…"). Cancelable. |
| Done | "Built N frames in Figma" + **Open in Figma** (deep link) + DS-gaps summary ("2 elements had no DS match — built as primitives"). |
| Error | Plain message + action (see categories). |

**Streamed narration** because export runs tens of seconds to minutes (an agent
making many MCP calls); a featureless spinner reads as broken. Reuses existing
progress plumbing.

**DS-gaps summary is a feature:** unmapped elements are candidate components for
the Arcade kit — "design-system parity as a byproduct." The agent already tracks
drift; surfacing it turns export into a kit-improvement signal.

**v1 cuts (YAGNI):** no interactive flow-picker, no per-frame options, no Code
Connect mapping. Code Connect is a strong phase-2 add.

## Error handling

| Kind | Cause | Designer sees |
|---|---|---|
| `no_figma_mcp` | Figma closed / MCP off | "Open Figma Desktop, enable Dev Mode MCP, retry." (preflight, pre-spawn) |
| `figma_auth` | MCP up, not logged in / wrong org | "Log into Figma Desktop with your DevRev account." |
| `agent_failed` | subprocess crash / Bedrock throttle | "Export failed — retry." (reuse generator throttle detection) |
| `agent_timeout` | past cap (~5 min) | "Export took too long and was stopped. Try fewer frames." |
| `partial` | some frames built, some not | "Built 3 of 5 frames. 2 failed: …" + Open in Figma anyway |
| `cancelled` | user cancel | silent → idle |

`partial` is first-class: don't discard good frames because others failed — open
what worked, name what didn't.

## Telemetry (PostHog)

Extend the existing `events.ts` typed catalog (replaces the old `figma_export_run`
single event):
- `figma_export_started` — `frame_count`
- `figma_export_succeeded` — `frame_count`, `duration_ms`, `ds_instances`,
  `ds_primitives`, `annotations`
- `figma_export_failed` — `duration_ms`, `error_kind`

Gives visibility the old button never had: how often Figma is missing, export
latency, and DS-gap rate (feeds kit priorities). Same typed-event discipline as
the rest of the catalog.

## Testing

Unit-testable (CLAUDE.md: every piece gets a test):
- **Preflight probe** — mock `:3845`; no-Figma → `no_figma_mcp`, no spawn.
- **Export command builder** — asserts `--mcp-config` (figma server), Figma
  allowed-tools, skill loaded; asserts it is **distinct** from the generator's
  locked-down args (regression guard against un-isolating the generator).
- **Curated-map rendering** — `componentEntries.ts` → correct skill table
  keys/variants.
- **Result parsing** — agent stream → `{built, failed, dsGaps}` → correct state
  (done/partial/error) + telemetry.
- **Modal states** — checkbox multi-select, preflight-fail notice, partial
  render (arcade-gen mocked).

Manual gates (real run required, called out explicitly in the plan):
- Vendored `claude` in the **packaged .app** reaches `:3845`.
- A real export produces a sane annotated flow in Figma.

## Out of scope (v1)
- Code Connect mapping (phase 2).
- Remote Figma MCP / OAuth brokering (fallback, later).
- Hybrid deterministic-swap fidelity pass (approach C, phase 2).
- Interactive flow selection mid-export.

## Open questions for the plan
- Does `server/middleware/export.ts` (SLJ storage) survive, or does the new path
  read SLJ in-process? Decide during implementation.
- Frame-count / timeout caps — pick concrete numbers in the plan.
- Where the curated-map → skill-table renderer lives (build-time vs. spawn-time).
