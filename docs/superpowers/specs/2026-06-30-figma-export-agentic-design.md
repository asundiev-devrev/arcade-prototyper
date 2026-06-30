# Figma Export (Two-Tier Deterministic) — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Area:** `studio/` — Share modal "Export to Figma"

> **Revision history (why this spec churned — kept as a guard against repeating).**
> - Draft 1 assumed the *local* Figma Dev Mode MCP (`:3845`) could write. FALSE —
>   read-only, active-tab gated. Disproven by live probe.
> - Draft 2 went all-agentic on the remote MCP and claimed a spike "proved"
>   headless auth. It only proved token *reuse*, not first-run login.
> - Draft 3 ("hybrid: LLM builds unmapped components") rested on a branch
>   (`executePlan.ts:94`) that production rarely reaches, and on an SLJ that
>   doesn't actually capture the data an LLM/pixel-render would need.
> - **This version (4)** is grounded in a line-by-line code verification (see
>   "Verified foundations") and inverts the architecture: **two deterministic
>   tiers** (mapped + pixel), agent used ONLY for cross-frame flow scaffolding.
>   Every load-bearing claim below is tagged VERIFIED or UNBUILT.

## Problem

Studio's Share modal has an "Export to Figma" button. It errors with "Open the
Arcade export plugin in Figma" — it ships a generated script over a WebSocket
bridge to a **Figma plugin that was never built** (VERIFIED: zero plugin source
tracked in the repo; `figmaExport.ts:53-55` → `wsServer.ts:68` sends
`EXECUTE_CODE` to a client that never connects). The feature has never worked
for any user.

A live prototype is a great *build* artifact but a poor *review* artifact. A
faithful, still rebuild in Figma — using the team's real components — makes it
reviewable and editable in the designer's native tool.

## Goal

Rebuild a selected Studio frame in Figma with **maximum deterministic fidelity**:
- Anything we've **mapped in advance** (components AND tokens, code↔Figma) →
  real Figma component instances + bound variables. Pixel-exact, repeatable.
- Anything **not yet mapped** → a **faithful render** from captured styles
  (the `html.to.design` bar) — never an empty rectangle.
- Coverage **grows over time** by adding mappings; the gap report is the backlog.

Locked product decisions (this session):
- **One-click inside Studio.**
- **No plain rectangles** — unmapped elements are rendered faithfully, not boxed.
- **Fidelity is deterministic**, not LLM-guessed. Map more → more becomes exact.
- Annotated multi-frame **flow** (arrows, interaction notes) is a later phase; if
  built, an agent does ONLY that scaffolding, never per-component fidelity.

## The two-tier model (core)

Every node from the captured frame routes to one of two deterministic handlers.

| Tier | What | Handler | Output |
|---|---|---|---|
| **1 — Mapped** | component or token present in the curated map | instantiate Figma component by published key, pick variant, set label/icon, bind color variable by key | pixel-exact DS instance |
| **2 — Pixel** | everything else (unmapped composites, containers, text) | build frame/text from captured styles (fill, stroke, radius, font, color, layout, box) | faithful render, flagged as a DS gap |

**No third "LLM-builds-it" tier.** The agent never fabricates a component.

### Why this is the right inversion (verified rationale)
- The deterministic engine already does Tier 1 well: `buildExecuteScript.ts` +
  `executePlan.ts` are ALIVE on HEAD (VERIFIED, `git ls-files`) and do
  `importComponentSetByKeyAsync` → `pickVariant` → `createInstance` → `setLabel`
  → `setIcon` → `bindFill` → `applyLayout`. This is the foundation, not phase 2.
- Memory `figma-export-hybrid-validated`: this engine already ran 51 instances / 0
  failures live. The win is real and repeatable.
- DevRev's design system has rename/token traps where "close" is wrong; only an
  exact key is safe. Determinism is a feature, not a limitation.

## Verified foundations (what's real today vs. what we must build)

This section is the antidote to prior drafts. Each item is code-verified.

### Tier 1 (mapped) — mostly works, color-only token binding
- VERIFIED: component instancing by key, variant pick, label/icon set — all work
  (`buildExecuteScript.ts:19,33,52,73,121`).
- VERIFIED: color tokens bind by Figma variable key
  (`tokenMap.ts:26-30`, `executePlan.ts:61-65`, `bindFill` at
  `buildExecuteScript.ts:85-95`).
- **UNBUILT / must add:** binding for **spacing, radius, typography** variables.
  `bindFill` bails on any non-COLOR variable (`:89`); `applyLayout` writes
  padding/gap as **raw numbers**; **corner radius is never applied to a frame at
  all**; created text hardcodes Inter Regular (`:151-152`). The snapshot has 179
  FLOAT + 26 STRING variables (`figma-variables.json`) that are currently unused.
  → "map tokens in advance" must extend the binder to FLOAT/STRING + apply radius.
- VERIFIED coverage: **17 components mapped, 3 ambiguous; 10/15 icons**; keys from
  Arcade UI Kit v0.3, confirmed 2026-06-06 (`CURATION-NOTES.md`). Mapping is a
  finite, closeable backlog against one library — but perishable; keys rot on kit
  republish. → plan must include re-resolution + a dead-key fallback to Tier 2.

### Tier 2 (pixel) — the SLJ does NOT yet capture enough (key correction)
- **UNBUILT / must add (producer side):** the serializer captures geometry, fill,
  stroke, radius, layout — but **NOT text styling in practice**. `fiberWalk.ts`
  `elementStyle` (`:29-38`) only reads `background-color`, radius, border; **text
  leaves carry only `characters`** (`:84-89`), no fontSize/family/weight/color/
  lineHeight. The `ElementStyle` type has these fields but the producer never
  fills them. → faithful pixel text REQUIRES extending `elementStyle` + the
  text-leaf emission to capture computed `color`, `font-size`, `font-weight`,
  `font-family`, `line-height`.
- **The real "empty box" cause (corrected):** unmapped composites are classified
  `"composite"` (`exportFrameToSlj.ts:109-113`) and recurse as element-frames —
  they do NOT hit the `executePlan.ts:94` component-fallback branch. The empty box
  is **transparent recursed wrapper frames** (`fills:[]`) because `elementStyle`
  only samples non-transparent `background-color`. → fixing Tier 2 = fixing
  style capture + the planner's frame emission, NOT the `:94` branch.
- **Also missing for pixel fidelity:** opacity, image fills/`src`, gradients,
  multi-fill, box-shadow, per-corner radius, per-side borders. Scope these
  explicitly in the plan (capture the common ones; list the rest as known gaps).

### Transport — the dead plugin is gone; use the official Figma MCP
- VERIFIED: no plugin source exists. The ws-bridge path is a dead end unless we
  build a plugin.
- VERIFIED available this session: the **official remote Figma MCP**
  (`mcp__plugin_figma_figma__use_figma`) executes the same Plugin-API JS the
  bridge wanted a plugin for. (figma-console MCP is NOT available and Studio
  blocks it — `claudeCode.ts:198`.)
- Decision: **the deterministic script runs via the official Figma MCP**, not the
  ws bridge. Delete the bridge + the never-built-plugin assumption.

### Spawn config — only relevant IF/when we add the agent flow phase
- VERIFIED: `RunTurnOptions` exposes no `mcpConfig/allowedTools/disallowedTools/
  appendSystemPrompt/skipManifest/noResume`; `--strict-mcp-config`, the tool
  lists, and kit-manifest injection are hardcoded (`claudeCode.ts:187,198,288,
  292-293,303-311`). → the agent-flow phase needs a real `RunTurnOptions`
  refactor. **v1 deterministic export does NOT need this** (it runs through MCP
  from the host, not a generator subprocess) — so v1 avoids that whole cost.

## Architecture (v1 — deterministic single frame)

```
Share modal → "Export to Figma" (one frame)
   └─ Studio serializes the live frame → SLJ
        • EXTENDED capture: text color/size/weight/family + radius + (common) fills
   └─ Studio builds the deterministic plan (sljToExecutePlan + extended binder):
        • Tier 1: mapped component → PlanInstance (key+variant+label+icon+var binds)
        • Tier 1: mapped token     → bound variable (color now; +radius/space/type)
        • Tier 2: everything else  → PlanFrame/PlanText from captured styles
                                     (real fills/strokes/text/radius — never empty)
        • dead/ambiguous mapping   → falls back to Tier 2 (never an empty box)
   └─ Studio runs the script through the official Figma MCP (use_figma)
        → real components instantiated + faithful frames built, in the user's file
   └─ result → Figma URL + DS-gap report (every Tier-2 node = a mapping candidate)
```

Transport note: in the packaged app the script is handed to the MCP
programmatically (a string in code) — there is no 30KB hand-paste limit (that
constraint only existed when driving Figma from a chat loop during spikes).

### v1 scope (thin, deterministic, proves the chain)
- ONE frame. Tier 1 + Tier 2. No flow, no arrows, no agent.
- Success bar: a real Studio frame (e.g. ComputerScene) rebuilt in Figma where
  mapped components are exact and unmapped parts are faithfully rendered (no empty
  boxes), good enough that a designer trusts it. Verified side-by-side on a real
  frame.

### Phase 2+ (explicitly later)
- Multi-frame **annotated flow** (ordering, arrows, interaction annotations,
  overview). IF an agent is used, it does ONLY this; per-frame fidelity stays
  deterministic. This is where the `RunTurnOptions` refactor + Figma-MCP-in-
  subprocess work lands.
- Extend token binding to spacing/radius/typography variables (start color-only).
- Grow the component/token map; promote recurring Tier-2 gaps into Tier 1.
- Code Connect mapping.

## Modal UX + states (v1)

| State | UI |
|---|---|
| Idle | Frame picker + "Export to Figma" |
| Running | Progress ("Serializing… Building… Instantiating components…"). Cancelable. |
| Done | "Rebuilt in Figma" + Open in Figma + DS-gap summary ("N elements rendered as pixels — candidates for the kit") |
| Partial | "Rebuilt with N gaps" + Open anyway |
| Error | Plain message + action |

Auth: writing needs a Figma login. v1 may rely on a **one-time interactive Figma
login** (the headless-reuse loop was proven; first-run login via PTY was proven
to *run* but the once-and-sticks-in-packaged-app path is still a manual gate).
The simplest v1 is: user authenticates Figma once (in Settings or first export),
the host MCP reuses it. Keep auth out of the deterministic critical path.

## Telemetry (PostHog)

Replaces the old single `figma_export_run` (whose only real-world outcome was
`no_bridge` — zero successful uses ever, VERIFIED):
- `figma_export_started` — frame
- `figma_export_succeeded` — `ds_instances` (Tier 1), `pixel_nodes` (Tier 2),
  `bound_vars`, `duration_ms`
- `figma_export_failed` — `error_kind`, `duration_ms`
- DS-gap list (Tier-2 component names) → feeds the mapping backlog.

## Testing

Unit-testable (CLAUDE.md: every change gets a test):
- **Extended SLJ capture** — `elementStyle` + text leaves now carry
  color/size/weight/family/lineHeight; regression test on a fixture fiber tree.
- **Tier routing** — mapped→instance, mapped-token→bound var, unmapped→faithful
  frame/text with real fills (NOT empty). Direct regression for the no-rectangle
  requirement, asserting the corrected cause (transparent recursed frames get
  their captured fill).
- **Binder extension** — color binds today; radius applied; (later) FLOAT/STRING
  bind. Test each as built.
- **Dead-key fallback** — an ambiguous/missing mapping degrades to Tier 2, never
  an empty box.
- **Plan output** — `sljToExecutePlan` on a real ComputerScene SLJ fixture →
  expected instance/variant/var-key counts.

Manual gates (real run):
- A real ComputerScene exported through the Figma MCP, eyeballed side-by-side vs.
  Studio at DevRev's fidelity bar.
- (Phase 2 / packaging) the packaged app's transport + auth on a real DMG.

## Open questions for the plan
- v1 transport: run the deterministic script via the official Figma MCP from the
  host vs. a thin in-app path. (Plan picks; either avoids the generator-subprocess
  refactor.)
- How much Tier-2 style capture to do in v1 (text+fill+radius now; image/gradient/
  shadow later) — commit a concrete cut.
- Token-binding scope in v1: color-only (works today) vs. also radius/spacing.
- Auth UX for v1: Settings "Connect Figma for export" vs. first-export prompt.
- Where the curated-map → script wiring lives now that the ws bridge is removed.
