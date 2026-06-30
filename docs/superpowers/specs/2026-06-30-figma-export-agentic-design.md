# Figma Export (Hybrid Deterministic + LLM) — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Area:** `studio/` — Share modal "Export to Figma"

> **Revision history (why this spec churned).**
> - Draft 1 assumed the *local* Figma Dev Mode MCP (`:3845`) could write. It
>   can't — read-only, active-tab gated. Disproven by live probe.
> - Draft 2 switched to the remote MCP + an all-agentic rebuild, and claimed a
>   spike "proved" headless auth. A second adversarial review showed the spike
>   only proved token *reuse*, not first-run *login*, and that a working
>   deterministic fidelity engine already exists on HEAD (I had it marked for
>   deletion). Both corrected here.
> - This version: hybrid engine (deterministic for mapped components, LLM for
>   unmapped components + flow), with the auth path now proven end-to-end (see
>   "Auth — proven end-to-end").

## Problem

Studio's Share modal has an "Export to Figma" button. It errors with "Open the
Arcade export plugin in Figma" — it ships a generated script over a WebSocket
bridge to a **Figma plugin that was never built**. The data pipeline is complete
and tested up to that boundary; only the transport is dead. The feature has
never worked for any user.

A live prototype is a great *build* artifact but a poor *review* artifact (it
only exists in motion). Rebuilding it as a still, annotated flow in Figma makes
it reviewable async — reviewers can comment on a single state, see the whole
flow, jump to a buried screen.

## Goal

Replace the dead plugin transport with an export that rebuilds selected frames
in Figma as an **annotated flow**, using the **remote Figma MCP** (no custom
plugin), driven by Studio's bundled `claude` subprocess.

Locked product decisions:
- **One-click inside Studio** (auth handled in-app on first export; no leaving
  the app).
- **Annotated-flow output** (multi-frame, arrows, interaction annotations,
  overview frame, DS-gap report).
- **No plain rectangles, ever.** Anything in the prototype that isn't a mapped
  component must be intelligently *built* by the LLM (real layout + tokens +
  text), never dropped in as an empty box. This is a hard requirement — see
  "The three-bucket model".

## The three-bucket model (core of the hybrid)

Every node in a prototype frame falls into exactly one bucket. The engine treats
each differently — this is the heart of the design.

| Bucket | Example | Handler | Output |
|---|---|---|---|
| **1. Mapped component** | Button, Card, Chip, Select — in our curated map | **Deterministic** | Exact Figma component instance by published key, correct variant, label, icon, token-bound fills. Perfect fidelity, zero non-determinism. |
| **2. Unmapped component** | a real component we have no key for (large kit, ~20 mapped → long tail is big) | **LLM** | A faithful build from the node's source + resolved SLJ (auto-layout, design-token fills, real text, structure), **flagged as a DS gap**. NEVER a gray rectangle. |
| **3. Container / text** | layout divs, text runs | **Deterministic** | Auto-layout frame / text node with bound tokens. (Legitimate frames — not the bad "rectangle stand-in".) |

**Why this split is correct:**
- Bucket 1 includes the components with nasty rename-traps (Chip/Tag,
  Toggle/Switch) and silent token-drift where "close" is wrong — only an exact
  key is safe. Deterministic guarantees it.
- Bucket 2 is frequent, not rare (coverage is ~20 components vs a large kit), so
  the LLM is doing real, constant building — and the user's hard requirement is
  that these are built faithfully, not boxed. This is unavoidable
  non-determinism, deliberately **confined** to the gaps.
- Every bucket-2 build is, by definition, a **candidate component for the Arcade
  kit** — the "design-system parity as a byproduct" signal, made concrete in the
  DS-gap report.

### Today's gap (verified)
`executePlan.ts:94` currently returns `{ kind: "frame" }` (an empty box) for any
unmapped component — exactly the "plain rectangle" outcome the user forbids. The
hybrid replaces that branch: unmapped components are handed to the LLM to build,
not boxed.

## Architecture

```
Share modal → "Export to Figma" (multi-frame select)
   └─ auth gate (see "Auth"):
        • not authed → PTY-driven Figma login (browser opens, approve once)
        • authed     → continue
        • seat check via whoami → Full seat? else → figma_no_seat state
   └─ Studio builds the deterministic plan from each frame's SLJ:
        • bucket 1 (mapped)    → PlanInstance (exact key + variant + text + icon)
        • bucket 3 (container) → PlanFrame / PlanText (auto-layout + token fills)
        • bucket 2 (unmapped)  → marked as a GAP node (NOT a frame) for the LLM
   └─ Studio spawns export subprocess (SEPARATE config from generator):
        • remote Figma MCP wired via --mcp-config (fixed server name)
        • vendored prototype-to-figma skill via --append-system-prompt
        • Figma MCP write tools allowed; AskUserQuestion disallowed
        • input: the plan (with gap nodes) + selected frames' TSX/SLJ + curated map
   └─ agent:
        • emits the deterministic instances/frames for buckets 1 & 3 (via use_figma)
        • BUILDS each bucket-2 gap node faithfully (layout/tokens/text), flags it
        • assembles the flow: order frames, draw arrows, annotate interactions
        • builds overview/legend + DS-gap list
        • verifies (no overlaps, every node present)
   └─ stream agent narration → modal progress
   └─ done → Figma file URL + DS-gaps summary
```

**Division of labor:** deterministic owns what we can guarantee (mapped
components, containers, text); the LLM owns what requires judgment (building
unmapped components, and all flow scaffolding). Non-determinism never touches a
mapped component.

### Deleted (dead transport only)
- `studio/server/figmaBridge/wsServer.ts` — WebSocket bridge.
- `studio/server/middleware/figmaExport.ts` + its `vite.config.ts` wiring
  (`:28,:74`) — the `to-figma` route.
- Associated test: `__tests__/server/figmaBridge/wsServer.test.ts`.
- Rewire `ShareModal.tsx` `handleExportToFigma` off the dead route.

> **Correction from review:** an earlier draft also listed
> `buildExecuteScript.ts` for deletion. It is NOT deleted — it's the live
> deterministic engine. `buildExecuteScript.ts` (ES5 runtime that built nodes in
> the old plugin sandbox) is REPLACED by emitting the same plan through the
> Figma MCP's `use_figma`; `executePlan.ts` (SLJ → plan) is KEPT and extended
> with the bucket-2 gap path. (The deleted `swapPlan/swapOps/...` in commit
> `05afed4` were a *different, older* strategy — not these files.)

### Kept and repurposed
- `executePlan.ts` — SLJ → plan. **Extended:** the unmapped-component branch
  (line 94) stops returning an empty frame and instead emits a typed `gap` node
  the LLM must build.
- `componentEntries.ts` / `iconEntries.ts` / `tokenMap.ts` — curated map,
  rendered into the skill prompt for exact bucket-1 swaps. **Caveat:** keys are
  from "Arcade UI Kit v0.3" (2026-06-06); some already `ambiguous`/`null`. Plan
  MUST re-resolve keys against the live kit; a dead key degrades to a **bucket-2
  LLM build** (never a rectangle), and is recorded as a DS gap.
- `fiberWalk.ts` / `slj.ts` / `inferLayout.ts` / `tokenIndex.ts` — produce the
  SLJ (resolved styles/layout/colors) that feeds both the deterministic plan and
  the LLM's bucket-2 builds.

### Why a separate subprocess config (refactor called out)
The generator's spawn (`claudeCode.ts`) hardcodes `--strict-mcp-config` (no
config), `--allowed-tools "Read,Edit,Write,Glob,Grep,Bash"`,
`--disallowed-tools "mcp__figma-console,AskUserQuestion"`, and unconditionally
injects the kit manifest via `--append-system-prompt`. None are parameterizable
today, and tests pin them. **Prerequisite task:** extend `RunTurnOptions` with
`{ mcpConfig, allowedTools, disallowedTools, appendSystemPrompt, skipManifest,
noResume, stallMs, maxAttempts }` so export gets its own config WITHOUT loosening
the generator (its locked test assertions must still pass). This is real work,
scoped as the first implementation task — not "reuse existing machinery".

## Auth — proven end-to-end

**Remote Figma MCP at `https://mcp.figma.com/mcp`** — the only no-plugin write
transport.

### Live spike results (this machine, dev CLI)
1. **First-run login needs a TTY.** A headless spawn (stdin=/dev/null) fails:
   "stdin isn't a terminal." Studio's normal spawn can't log in directly.
2. **A PTY clears it.** Running `claude mcp login <name>` under a pseudo-terminal
   (Studio would use a `node-pty` helper) opens the browser, runs a localhost
   callback, and completes: "Authenticated." `--no-browser` is a fallback that
   prints a paste-able URL.
3. **The loop sticks.** After ONE PTY login under a fixed server name, TWO
   separate fresh headless processes (`claude -p --strict-mcp-config
   --mcp-config`, stdin=/dev/null — Studio's exact export spawn) both reused the
   credential with no re-auth, returning the authed email.
4. **Seat is detectable pre-write.** `whoami` returned email + "DevRev org, Full
   seat" headlessly — so `figma_no_seat` can be a real pre-flight state, not a
   mid-build failure.

### Invariants (load-bearing)
- **Fixed server name** (e.g. `arcade-figma-export`) used identically at login
  and at export. The OAuth token is keyed to the server registration; a mismatch
  forces a fresh (impossible-when-headless) login.
- Studio's spawn inherits the user's real `$HOME` (verified: it only strips
  `CLAUDE_CODE_*`/`CLAUDECODE_*` env keys), so the export subprocess reads the
  same credential store the PTY login wrote to.

### First-run flow
- Export click → check authed (cheap probe under the fixed name).
- Not authed → PTY login (browser, approve once). Then seat check. Then export.
- Authed → seat check → export. Token auto-refreshes.

### Auth realities (not hidden)
- **Full seat required to write** (Figma rule). Dev/viewer seats are read-only →
  `figma_no_seat` state, detected up front via `whoami`.
- **The packaged-`.app` confirmation remains a manual gate:** does the vendored
  `claude` binary (v2.1.142, vs the dev v2.1.196 used in the spike) do PTY login
  + headless reuse under hardened-runtime/notarization, and does a PTY work from
  inside Electron. This is now a *verification of a proven mechanism*, not an
  open question — but it MUST be checked on a real DMG before shipping.

## v1 scope — thin, prove the chain

**v1 = deterministic frames + LLM-built gaps, SINGLE frame, no flow scaffolding.**

Rationale: three layers are each only proven on the dev machine (packaged-app MCP
reach, bucket-2 LLM fidelity, the skill driving multi-step work). Ship the
smallest thing that exercises the whole chain end-to-end on a real DMG:
- buckets 1 + 3 deterministic, bucket 2 LLM-built (the no-rectangle requirement
  is in v1 — it's not optional), one frame, no arrows/flow.
- If a single faithful frame (mapped components exact, unmapped built, no boxes)
  lands in a real DMG, the auth + transport + fidelity chain is proven.

**v2 = the full annotated flow:** multi-frame select, ordering, arrows,
interaction annotations, overview/legend. Layered on top of v1's proven
per-frame builder. The agent's flow reasoning is added where it's low-risk
(arrangement), never to rebuild a frame's pixels.

This sequences the user's chosen annotated-flow output safely — it's still the
destination, just not the first landing.

## Modal UX + states

Export uses **multi-frame checkbox** select (v2; v1 single). Deploy/share keeps
its single radio. NOTE (from review): `ShareModal` is currently built on a single
`selectedFrame: string | null` consumed by deploy + copy + export. Multi-select
is a real state-model change (add `selectedFrames: string[]`, conditional
checkbox vs radio), scoped in the plan — not a trivial swap.

| State | UI |
|---|---|
| Idle | Frame select + "Export to Figma" |
| First-run auth | "Connecting Figma…" during PTY login, auto-continues |
| Not authed / wrong account | "Log into Figma with your DevRev account." |
| No Full seat | "Exporting to Figma needs a Figma Full seat. Read-only seats can't create files." (distinct, pre-flight) |
| Running | Live narration (see below). Cancelable. |
| Done | "Built N frames in Figma" + Open in Figma + DS-gaps summary |
| Partial | "Built 3 of 5 frames. 2 failed: …" + Open in Figma anyway |
| Error | Plain message + action |

### Progress narration (scoped, not free)
The generator's stream-json parser only pretty-prints `Read/Write/Edit/Glob/
Grep/Bash`; MCP tool calls fall to a generic "Using <tool>" line. To show
"Building Sign-in… Annotating…", the plan must either add `prettyTool` cases for
the Figma MCP tools or have the skill emit assistant-text milestones. Scoped, not
assumed-free.

## Error handling

| Kind | Cause | Designer sees |
|---|---|---|
| `figma_not_authed` | no token under fixed name | first-run auth trigger |
| `figma_wrong_account` | authed, not DevRev org | "Log into Figma with your DevRev account." |
| `figma_no_seat` | Dev/viewer seat | "Needs a Figma Full seat." (pre-flight via whoami) |
| `agent_failed` | crash / Bedrock throttle | "Export failed — retry." |
| `agent_timeout` | past cap | "Took too long. Try fewer frames." |
| `partial` | some frames built | "Built 3 of 5…" + Open anyway |
| `cancelled` | user cancel | silent → idle |

### Timeout / retry — export-specific
The generator's 120s stall watchdog + 2-attempt `--resume` retry are WRONG for a
long, stateful, side-effecting build (silence between large MCP results →
mid-build kill; `--resume` re-run → duplicate frames). Export uses its own config
(longer/disabled stall, **no auto-resume**). This rides on the `RunTurnOptions`
refactor above. A test asserts auto-resume is off for export.

## Telemetry (PostHog)

Replaces the old single `figma_export_run` (whose only real-world outcome was
`no_bridge` — i.e. zero successful uses ever):
- `figma_export_started` — `frame_count`
- `figma_export_succeeded` — `frame_count`, `duration_ms`, `ds_instances`
  (bucket 1), `llm_built` (bucket 2), `annotations`
- `figma_export_failed` — `duration_ms`, `error_kind`
- Optional `figma_seat_observed` — `seat_type` (cheap way to learn the addressable
  audience early; see "Open questions").

## Component-map freshness

The curated keys are perishable. Plan MUST: re-resolve all keys against the live
kit before relying on them; on any key that fails to instantiate, degrade to a
**bucket-2 LLM build** (never a rectangle) and record a DS gap; consider a
validation script as a follow-up.

## Testing

Unit-testable:
- **`RunTurnOptions` refactor** — export config has Figma MCP + write tools +
  skill + no-resume; generator config UNCHANGED (existing locked assertions pass).
- **Bucket routing** — `executePlan` maps mapped→instance, container→frame/text,
  **unmapped→gap node (NOT empty frame)**. Direct regression for the
  no-rectangle requirement.
- **Auth gate** — no token → first-run state, not a spawn; token present →
  proceed; fixed-server-name constant shared by login + export config.
- **Curated-map rendering** — entries → skill table; dead key → bucket-2 fallback
  instruction.
- **Result parsing** — agent stream → `{built, llmBuilt, failed, dsGaps}` →
  correct state + telemetry.
- **Modal states** — select model, auth/seat states, partial render.

Manual gates (real DMG):
- Vendored binary does PTY login + headless reuse under notarization; PTY works
  inside Electron.
- A single exported frame: mapped components exact, unmapped components built
  faithfully (NO rectangles), at DevRev's fidelity bar.

## Phase 2 / later
- Full annotated flow (multi-frame, arrows, annotations, overview).
- Code Connect mapping.
- Component-map auto-validation script.
- Promote frequently-recurring bucket-2 builds into the curated map.

## Open questions for the plan
- Fixed server-name constant + where defined (shared by login + export).
- v1 frame cap / v2 batching strategy (context budget: N×(TSX+SLJ) is heavy;
  SLJ snapshots are large — commit to a cap + degradation path, don't leave
  fully open).
- Where the curated-map → skill-table renderer lives.
- Whether `server/middleware/export.ts` (SLJ storage) survives or SLJ is read
  in-process.
- How to learn beta-tester Full-seat distribution early (Slack ask or
  `figma_seat_observed` probe) — gates how much v2 to build.
