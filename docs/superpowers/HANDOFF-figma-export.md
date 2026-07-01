# Handoff — Figma Export v1 (deterministic rebuild)

**Date:** 2026-07-01
**Branch:** `docs/figma-export-agentic-spec`
**Status:** Spec + implementation plan written, reviewed, committed. **Not executed.**
**Read this first, then the plan.**

---

## TL;DR

Studio's "Export to Figma" button has **never worked for any user** — it ships a
generated Plugin-API script over a WebSocket bridge (`server/figmaBridge/
wsServer.ts`) to a Figma plugin that was never built. We are rebuilding it as a
**two-tier deterministic** export. The design is verified against real code and
adversarially reviewed three times. Your job: **execute the plan.**

- **Spec:** `docs/superpowers/specs/2026-06-30-figma-export-agentic-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-01-figma-export-v1-deterministic.md`
  (6 tasks, TDD, bite-sized steps, all code inline)

---

## The architecture (don't re-litigate — it's verified)

Two **deterministic** tiers. No agent, no LLM in v1.

1. **Tier 1 — mapped:** components/tokens we've mapped code↔Figma in advance →
   instantiate the real Figma component by published key, bind color variables
   by key. `buildExecuteScript.ts` + `executePlan.ts` are ALIVE on HEAD and
   already do this (validated live: 51 instances, 0 failures).
2. **Tier 2 — unmapped:** everything else → **faithful pixel render** from
   captured styles (fill, stroke, radius, text). **Never an empty rectangle.**
3. Coverage grows over time by adding mappings; the DS-gap report is the backlog.

Later (v2, out of scope): multi-frame annotated flow + arrows + an agent for
*flow scaffolding only*; spacing/radius/typography variable binding; a
Studio-owned bridge plugin.

---

## Hard-won facts — DO NOT re-discover these (they cost 4 spec rewrites)

1. **The packaged app has NO MCP.** `use_figma` /
   `mcp__plugin_figma_figma__*` exist only in a *Claude Code chat session*, not
   in Studio's Vite middleware or its vendored `claude` subprocess. The product
   writes to Figma via **plugin + ws-bridge only**. Do not design around
   `use_figma`.
2. **Transport plugin already exists — reuse it, don't rebuild.** The
   `figma-console-mcp` "Figma Desktop Bridge" (`~/.figma-console-mcp/plugin/`)
   speaks Studio's exact protocol (verified: `{id,method,params}` in →
   `{id,result|error}` out, has an `EXECUTE_CODE` handler that evals
   `params.code`). Plan Task 1 is now just a *transport verification gate*, not
   a build. A Studio-owned branded plugin is a v2 hardening item.
3. **SLJ does NOT capture text styling today.** `fiberWalk.ts elementStyle`
   (~:29-38) reads only bg-color/radius/border; text leaves (~:84, ~:101) carry
   only `characters`. Faithful Tier-2 text needs extending the serializer —
   that's plan Task 2 (the `ElementStyle` *type* already has the fields; the
   producer just never fills them).
4. **The "empty box" real cause** = transparent recursed wrapper frames
   (`fills:[]`), NOT the `executePlan.ts:94` unmapped-component branch (rarely
   reached — unmapped composites are classified `"composite"` and recurse as
   element-frames). Fix style capture, not that branch.
5. **Token binding is COLOR-only.** `bindFill` bails on non-COLOR;
   spacing/gap/padding come through as raw numbers; **cornerRadius is never
   applied to a frame** in the current runtime. v1 keeps color-only + adds
   radius-as-raw-number (plan Tasks 3-4). Spacing/typography variables = v2.
6. **DevRev fonts are already in Figma.** Don't hardcode font substitutions; the
   runtime's `ensureFont` loads a node's own font. (Custom font "Chip Text
   Variable" must be loadable — it is, in the DS file.)

---

## What is PROVEN (verified live in DevRev Figma this session)

- ✅ Plugin-API renders faithful nested pixels (full inbox screen, no drift)
- ✅ Real Arcade components instantiate by key — 7/7 (Button, Chat Item, Bubble,
  Icon Button, Menu, Input, Toggle…), instant against the Arcade DS file
- ✅ The REAL pipeline `buildExecuteScript(live ComputerScene SLJ)` → valid
  output: 54 instances (Icon Button×6, Button×2, Chat Item×30, Menu×1,
  Bubble×15), correct keys/variants/token-binds
- ✅ Transport class (plugin + ws-bridge) works; existing plugin is compatible

## What is NOT proven (and why)

- ❌ The single assembled full-ComputerScene screenshot side-by-side with Studio.
  **Blocked ONLY by a chat-loop limitation:** an agent driving Figma from chat
  must hand-type the ~30KB script into a tool call, which corrupts at that scale
  (proven 3×). `fetch` is sandbox-blocked. This is **not** an architecture gap —
  it's the reason to run the actual feature: Studio's middleware sends the script
  over the bridge programmatically (no human in the byte-path). The screenshot
  is a natural OUTPUT of executing the plan (gates G1/G4), not a pre-req.

**Do not** try to reproduce the screenshot by pasting the script into
`use_figma`/`figma_execute`. It will waste your session. Build the feature; the
screenshot falls out.

---

## How to execute

Use `superpowers:subagent-driven-development` (recommended) or
`superpowers:executing-plans`. Tasks are TDD, independently testable, with all
code inline. Order matters (Task 3 depends on Task 2's SLJ fields, Task 4 on
Task 3's plan fields).

- Task 1 — transport gate (no code; confirm existing plugin connects)
- Task 2 — capture text styling in `fiberWalk.ts`
- Task 3 — carry text style + radius into `executePlan.ts`
- Task 4 — apply them in the `buildExecuteScript.ts` runtime
- Task 5 — DS-gap counts + typed telemetry (⚠️ migrates ShareModal's 3
  `figma_export_run` call sites — deleting the event breaks them otherwise)
- Task 6 — setup doc + full-suite gate
- **Gates G1-G5** (manual, real Figma): transport, tier-1 fidelity, tier-2
  fidelity, **G4 = the side-by-side screenshot**, packaged-app.

Repo conventions: pnpm only; `pnpm run studio:test <path>`; Conventional Commits
scope `studio/figma-export`; never `git add -A`; Vite middleware needs a full
restart to pick up `server/**` changes.

## The adversarial-review discipline that made this solid

Every spec/plan revision here was checked by parallel adversarial agents that
verify claims against real code and try to refute, not rubber-stamp. Four spec
drafts each died on an unverified assumption caught this way; the plan's own
review caught 4 defects (fixed pre-handoff). **Keep doing this** — before
executing a task, and especially before claiming a task done, verify against the
actual code + run the tests. Evidence before assertions.

## Open product decisions already made (don't reopen)
- One-click in Studio · deterministic (not LLM) fidelity · no plain rectangles
  (faithful render for unmapped) · annotated flow is v2 · reuse existing bridge
  plugin for v1 · all beta testers have Figma Full seats (seat-gating not a v1
  concern).
