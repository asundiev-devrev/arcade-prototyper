# Figma Export via Agent — Design Spec

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Area:** `studio/` — Share modal "Export to Figma"

> **Revision note.** An earlier draft of this spec was built on a false premise
> (that the *local* Figma Dev Mode MCP at `:3845` could write to Figma). An
> adversarial review + live probing disproved it: the local MCP is read-only
> and gated on an active design tab. This version is rebuilt around the
> **remote** Figma MCP (`mcp.figma.com`) with a one-time interactive login,
> a path proven feasible by a live spike (see "Auth spike — proven").

## Problem

Studio's Share modal has an "Export to Figma" button. Clicking it errors with
"Open the Arcade export plugin in Figma, then try again" — because the export
ships a generated script over a WebSocket bridge to a **Figma Desktop Bridge
plugin that was never built**. The data pipeline is complete and tested up to
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
the **remote** Figma MCP (no custom plugin) to rebuild selected frames as an
**annotated flow** in the designer's Figma, built from real Arcade
design-system components.

Product decisions, locked during brainstorming:
- **One-click inside Studio** (not a copy-paste prompt for the user's own editor).
- **Annotated-flow output** (the full article treatment), not a single faithful
  frame.
- **Auth baked into first-run export.** No separate "Connect Figma" button. The
  first time the user clicks Export to Figma, if not yet authed, the Figma login
  runs inline, then the export continues. Every later click goes straight to
  export.

## Approach (chosen: A — agentic skill)

Studio already spawns a `claude` CLI subprocess for frame generation. For
export, spawn a **second, differently-configured** subprocess: the remote Figma
MCP wired in, a vendored "prototype-to-figma" skill loaded, handed the selected
frames + our curated Arcade→Figma component map. The agent reads frames, infers
the flow, and rebuilds it in Figma with annotations and arrows, then verifies.

Rejected alternatives:
- **B (deterministic transport swap):** feed our existing
  `fiberWalk → SLJ → executePlan` plan to the Figma MCP instead of the dead
  plugin. Rejected as the *primary* approach because that pipeline only does
  single-frame rebuilds; the annotated-flow output (multi-frame, arrows,
  interaction inference) is exactly what it can't do, so an agent is needed
  anyway. NOTE: a validated hybrid swap pipeline (51 instances / 0 failures) was
  built and then deleted in commit `05afed4` when its plugin transport died. It
  is recoverable via `git revert` and is the natural basis for a future
  fidelity pass (see "Phase 2").
- **C (hybrid):** agent owns flow scaffolding, deterministic swap owns per-frame
  fidelity. Best quality, most integration work. Held as **phase-2** if the
  agent's per-frame fidelity proves insufficient at DevRev's bar.

## Architecture

```
Share modal → "Export to Figma" (multi-frame select)
   └─ auth gate: is the export Figma MCP authed?
        • NO  → run interactive OAuth inline (browser opens, user approves once)
        • YES → continue
   └─ Studio spawns export subprocess (SEPARATE from generator):
        • --mcp-config → { "<FIXED_SERVER_NAME>": { type:"http", url:"https://mcp.figma.com/mcp" } }
        • --strict-mcp-config (scopes to OUR config; ignores ambient servers)
        • --append-system-prompt → vendored prototype-to-figma skill
        • allowed-tools → mcp__<FIXED_SERVER_NAME>__{use_figma, search_design_system,
                            get_design_context, get_metadata, get_variable_defs,
                            create_new_file, whoami}
        • --disallowedTools → AskUserQuestion (backstop against interactive stalls)
        • input → selected frames' TSX + SLJ + curated Arcade component map
   └─ agent: map components → build one frame per state →
              annotate interactions → draw flow arrows → overview/legend →
              verify (no overlaps, all rows present)
   └─ stream agent narration → modal progress line
   └─ done → Figma file URL + DS-gaps summary
```

`<FIXED_SERVER_NAME>` is a single constant (e.g. `arcade-figma-export`) used
**identically** at login time and at export time. This is load-bearing — see
"Transport + auth".

### Deleted (dead transport)
- `studio/server/figmaBridge/wsServer.ts` — custom WebSocket bridge.
- `studio/src/export/figma/buildExecuteScript.ts` — ES5 plugin-sandbox script
  builder.
- `studio/server/middleware/figmaExport.ts` — the `to-figma` route that drove
  them, **plus** its wiring in `vite.config.ts` (the only non-test caller).
- Associated tests: `__tests__/server/figmaBridge/wsServer.test.ts`,
  `__tests__/export/figma/buildExecuteScript.test.ts`.
- The current `ShareModal.tsx` `handleExportToFigma` posts to the dead route;
  rewire it to the new flow as part of this work (don't leave it pointing at a
  deleted endpoint).

(Verified: these three modules are imported only by each other + `vite.config.ts`
+ their own tests. Deleting them breaks no unrelated feature. The validated
fiber-walk/swap import pipeline under `src/export/` is NOT touched — it's kept.)

### Kept and repurposed
- `componentEntries.ts`, `iconEntries.ts`, `tokenMap.ts` — curated Arcade→Figma
  component/icon/token mappings. Rendered into a table injected into the skill
  prompt so the agent swaps by **exact key** instead of fuzzy
  `search_design_system` (which becomes the fallback for unmapped elements).
  **Caveat (from review):** these keys were captured from "Arcade UI Kit v0.3"
  on 2026-06-06; some entries are already `status:"ambiguous"` / `figma:null`,
  and published component keys rot when the kit republishes. See "Component-map
  freshness" — the plan MUST include a re-resolution + validation step, and the
  agent MUST gracefully fall back to `search_design_system` on a dead key.
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

## Transport + auth (the corrected core)

**Use the REMOTE Figma MCP at `https://mcp.figma.com/mcp`.** It is the only
transport that can WRITE to Figma without a custom plugin. (The local Dev Mode
MCP at `:3845` is read-only and won't even list tools unless a design tab is
active — disproven as a write path.)

### Why this is feasible — the auth spike (PROVEN)
The open question was whether Studio's *headless* subprocess could use the remote
MCP, which requires an interactive OAuth the subprocess can't run. Live spike on
the dev machine settled it:

1. Registered a remote MCP server under a fixed name (`figma-export`).
2. Logged in once interactively (`/mcp` → Authenticate → browser approve). Token
   stored in `~/.claude/.credentials.json` under `mcpOAuth`.
3. Ran headless exactly as Studio spawns:
   `claude -p --strict-mcp-config --mcp-config <figma-export.json>` — all 25
   Figma tools (incl. `use_figma`, `create_new_file`) surfaced, and a real
   `whoami` call returned the authed email. **No browser, no re-auth.**

Two facts the spike established:
- **The stored OAuth token IS reused by the headless subprocess** — auth once,
  export many times.
- **The token is keyed to the SERVER NAME.** A config naming the server
  differently than the login used does NOT reuse the token (it fails to a fresh
  OAuth, which can't run headless). Therefore Studio MUST use one fixed server
  name at both login and export. This is the single most important
  implementation invariant.

### How Studio handles env (verified)
Studio's spawn inherits the user's real `$HOME` (it only strips
`CLAUDE_CODE_*`/`CLAUDECODE_*` env keys; never touches HOME / CLAUDE_CONFIG_DIR /
XDG). So the subprocess reads `~/.claude/.credentials.json` exactly as the user's
own CLI would — no credential plumbing needed. We only pass `--mcp-config` to
register the server (kept `--strict-mcp-config`, matching existing isolation).

### First-run auth flow
- Studio checks whether the export server is authed (e.g. a probe run, or
  presence of the token under the fixed server name).
- Not authed → trigger the interactive OAuth (`claude mcp` login flow under the
  fixed server name) — opens a browser, user approves with their DevRev Figma
  account, once. This mirrors how connecting Figma in Settings already feels.
- Authed → proceed straight to export. Token auto-refreshes; re-auth only if it
  fully expires.

### Auth/permission realities (not hidden)
- **Figma Full seat required to write.** Per Figma, writing to files with agents
  needs a Full seat; Dev-seat users get read-only. A Dev-seat user can't export.
  The modal must surface this as a distinct state, not a generic failure.
- **Edit permission on the target file** (or creating a new file) is required.

## The skill (fork of alima-max/prototype-to-figma)

A markdown skill (`SKILL.md` + `figma-patterns.md`) vendored in the repo (e.g.
`studio/figma-export-skill/`), shipped in the `.app`, loaded via
`--append-system-prompt`. Self-contained in Studio, versioned with the app — NOT
installed into the user's `~/.claude`.

> **Reliability caveat (from review):** Studio's own code notes that
> `--append-system-prompt` text is obeyed *more loosely* than CLAUDE.md. The
> skill is mostly behavior. Mitigation: keep the skill's rules tight and
> imperative; the plan should test that a representative export actually follows
> the flow/annotation steps, and consider a project-level CLAUDE.md in the export
> cwd for the hardest rules if append-prompt adherence proves weak.

### Changes from upstream
1. **Inject the curated map; demote guessing.** Generate an Arcade component
   table from `componentEntries.ts` / `iconEntries.ts` / `tokenMap.ts` and paste
   it into the prompt (component → set key + variants; token → variable key).
   Agent swaps by exact key. `search_design_system` is the fallback for unmapped
   elements or dead keys.
2. **Read frame source + SLJ, not a live browser.** Frames are on disk as React
   TSX (`frames/<slug>/index.tsx`); the SLJ from our fiber-walk is passed as a
   structured hint with resolved styles/layout/colors.
3. **Arcade specifics.** Point `search_design_system` at the Arcade UI Kit
   library; teach token naming (`--fg-*`, `--bg-*`) and the two themes
   (Arcade / DevRev App); set `figma-patterns.md` primitive fallbacks to Arcade
   defaults.
4. **No interactivity.** HARD-DELETE upstream's "Phase 1b" flow-selection
   question (it waits for a reply a headless subprocess can't give). Frames are
   passed up front from the modal; the agent infers ordering/branches. Backstop:
   `AskUserQuestion` in the export subprocess's `--disallowedTools`.

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
| First-run auth | "Connecting Figma…" while the browser OAuth completes, then auto-continues into export. |
| Not authenticated / wrong account | "Log into Figma with your DevRev account to export." + the auth trigger. |
| No Full seat | "Exporting to Figma needs a Figma Full seat. Read-only seats can't create files." (distinct, actionable — not a generic error). |
| Running | Live progress line — agent narration streamed via the generator's stream-json plumbing ("Mapping components… Building Sign-in… Annotating… Verifying…"). Cancelable. |
| Done | "Built N frames in Figma" + **Open in Figma** (deep link) + DS-gaps summary ("2 elements had no DS match — built as primitives"). |
| Partial | "Built 3 of 5 frames. 2 failed: …" + Open in Figma anyway. |
| Error | Plain message + action (see categories). |

**Streamed narration** because export runs tens of seconds to minutes (an agent
making many MCP calls); a featureless spinner reads as broken. Reuses existing
progress plumbing.

**DS-gaps summary is a feature:** unmapped elements are candidate components for
the Arcade kit — "design-system parity as a byproduct." Surfacing it turns export
into a kit-improvement signal. (Honest note: only ~20 components are mapped today
vs. a large kit, so the long tail will rely on `search_design_system`; the gap
report doubles as a coverage signal.)

**v1 cuts (YAGNI):** no interactive flow-picker, no per-frame options, no Code
Connect mapping. Code Connect is a strong phase-2 add.

## Error handling

| Kind | Cause | Designer sees |
|---|---|---|
| `figma_not_authed` | no stored token for the export server | first-run auth trigger / "Log into Figma" |
| `figma_wrong_account` | authed, not DevRev org | "Log into Figma with your DevRev account." |
| `figma_no_seat` | authed but Dev/viewer seat | "Needs a Figma Full seat to create files." |
| `agent_failed` | subprocess crash / Bedrock throttle | "Export failed — retry." (reuse generator throttle detection) |
| `agent_timeout` | past cap | "Export took too long and was stopped. Try fewer frames." |
| `partial` | some frames built, some not | "Built 3 of 5 frames. 2 failed: …" + Open in Figma anyway |
| `cancelled` | user cancel | silent → idle |

`partial` is first-class: don't discard good frames because others failed.

### Timeout / retry — export-specific (from review)
The generator wraps spawns in a 15-min hard timeout, a 120s stall watchdog, and a
2-attempt `--resume` auto-retry. That recovery model is WRONG for export: a long,
stateful, side-effecting Figma build can exceed 120s of stdout silence between
large MCP results (watchdog kills it mid-build), and `--resume` re-running a
half-built file is not idempotent (duplicate frames/arrows). The export spawn
MUST use its own config: a longer/disabled stall watchdog and **no auto-resume
retry** (or an idempotency guard). The plan picks concrete numbers.

## Telemetry (PostHog)

Extend the existing `events.ts` typed catalog (replaces the old `figma_export_run`
single event):
- `figma_export_started` — `frame_count`
- `figma_export_succeeded` — `frame_count`, `duration_ms`, `ds_instances`,
  `ds_primitives`, `annotations`
- `figma_export_failed` — `duration_ms`, `error_kind` (the table above)

Gives visibility the old button never had: auth-failure rate, seat-block rate,
export latency, DS-gap rate (feeds kit priorities). Same typed-event discipline
as the rest of the catalog.

## Component-map freshness (from review)

The curated keys are a perishable asset. The plan MUST:
- Re-resolve all `componentEntries.ts` / `iconEntries.ts` keys against the
  currently-published Arcade kit before relying on them (some are already known
  dead/ambiguous).
- Make the agent fall back to `search_design_system` on any key that fails to
  instantiate, and record it as a DS gap (so a stale key degrades to "primitive
  + flagged," never a hard failure).
- Note that re-curation is a recurring cost per kit release; consider a
  validation script as a follow-up so drift is caught, not discovered.

## Testing

Unit-testable (CLAUDE.md: every piece gets a test):
- **Auth gate** — mock "no token" → first-run auth state, not a spawn; mock
  "token present" → proceeds.
- **Export command builder** — asserts `--mcp-config` names the FIXED server,
  the matching `mcp__<name>__*` allowed-tools, the skill loaded, `AskUserQuestion`
  disallowed; and asserts the config is **distinct** from the generator's
  locked-down args (regression guard against un-isolating the generator).
- **Server-name invariant** — a test that login-name and export-config-name come
  from the same constant (guards the one fact the spike proved load-bearing).
- **Curated-map rendering** — `componentEntries.ts` → correct skill table; a dead
  key path renders the fallback instruction.
- **Result parsing** — agent stream → `{built, failed, dsGaps}` → correct state
  (done/partial/error) + telemetry.
- **Modal states** — checkbox multi-select, auth/seat states, partial render
  (arcade-gen mocked).
- **No-resume guard** — export spawn config asserts auto-resume retry is off.

Manual gates (real run required, called out in the plan):
- The packaged `.app` subprocess reaches `mcp.figma.com` and reuses the stored
  token (the spike proved this on the dev machine + dev CLI; confirm on a real
  notarized DMG, where hardened-runtime/network entitlements could differ).
- A real export produces a sane annotated flow at DevRev's fidelity bar.

## Phase 2 (out of scope for v1)
- Code Connect mapping.
- Deterministic fidelity pass: revive the deleted hybrid swap pipeline
  (commit `05afed4`, 51/0 validated) so the agent owns only flow scaffolding
  while exact per-frame fidelity is deterministic. Gated on whether v1's
  agent-built fidelity is good enough.
- Component-map auto-validation script.

## Open questions for the plan
- The exact fixed server name constant + where it's defined (shared by auth
  trigger and export spawn).
- Frame-count / timeout caps — concrete numbers.
- Where the curated-map → skill-table renderer lives (build-time vs. spawn-time).
- Whether `server/middleware/export.ts` (SLJ storage) survives or the new path
  reads SLJ in-process.
