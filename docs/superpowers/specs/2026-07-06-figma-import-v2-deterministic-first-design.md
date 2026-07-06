# Figma import v2 — deterministic-first routing

Date: 2026-07-06
Branch: `feat/figma-fidelity-eject`
Status: design — awaiting user review before writing-plans.

## Problem

A Figma-URL prompt asking for a faithful reproduction — **"Implement this design
precisely: <URL>"** — currently routes to the LLM generator (`runClaudeBranch`),
which reconstructs the design from a lossy summary + a screenshot. On the real
nav screen (`JztJjqt3i6uFwB6r4dfewz` / node `139-3839`, project
`implement-this-design-precisely-2`) that engine produced:

- the Computer wordmark as a **solid black blob** (hand-rolled 78×14 SVG path),
- a **hand-rolled sidebar** with wrong geometry instead of the real chrome,
- content pushed off-screen / not vertically centred,
- a hallucinated `ArrowUp` import that triggered an auto-repair turn.

Screenshot of the failure: `precisely2-nav-latest.png` (repo root).

Studio already has a **deterministic import engine** (`kitEmitBranch` →
`kitEmit.ts`) that copies geometry, colour, text, logos (→ exported SVG) and
images verbatim from Figma's REST payload, with real `@xorkavi/arcade-gen`
components dropped in where a mapping matches. It has **no LLM**, so it cannot
produce a black blob, cannot hand-roll wrong geometry, and cannot hallucinate an
import. It is the html.to.design equivalent: faithful by construction.

**The routing sends faithful-reproduction prompts to the wrong engine.** The
router (`shouldGenerateFromFigma` in `server/figma/generationIntent.ts`) treats
hi-fi wording — "precisely", "pixel-perfect", "exactly" — as a reason to wake the
LLM. So asking for *more* accuracy routes you to the engine that is *less*
accurate. This is the core defect.

## Governing principle

**A Figma URL always produces the faithful deterministic import.** The LLM,
when a prompt needs it, only ever *edits that faithful frame* — it never
reconstructs a design from a summary. Fidelity is the floor for every Figma-URL
turn; componentization is a dial on top of that floor, grown by adding
mapping-table rows (`kitMappings.ts`), never by prompting.

Corollary that scopes this work: the "start from ComputerScene but with tweaks"
case is a **template / from-scratch** entry point (no Figma URL). It is out of
scope here. When a user brings a Figma URL, they want a faithful replica of *that
Figma* — not a riff on an existing template.

## Fidelity model (why mapping is not the floor)

Two independent layers, so the reader does not conflate them:

- **Pixel floor** — position, size, colour, text, logos→SVG, images→PNG. Copied
  verbatim from Figma data. **Zero dependence on the mapping table.** Even with
  an empty table, a static import is pixel-faithful.
- **Componentization** — swapping a faithful div-cluster for a real component
  instance (`Button`, `ComputerSidebar`, …). This is what mapping rows buy. More
  rows = more of the faithful pixels are real components instead of divs. It is a
  progressive enhancement on top of an already-faithful floor, never a
  precondition for fidelity.

## Design

### Part A — pure faithful-reproduction routes deterministic (the core fix)

`shouldGenerateFromFigma` today returns true on **hi-fi OR interaction OR build**
intent. Remove hi-fi as a routing trigger:

```
shouldGenerateFromFigma(prompt) =
  detectInteractionIntent(prompt) || detectBuildIntent(prompt)
```

Effect on the four prompt shapes:

| Prompt | Today | After |
|---|---|---|
| Bare import (URL only, "import this") | deterministic | deterministic (unchanged) |
| **"Implement this precisely" (hi-fi only)** | **LLM** | **deterministic** ← the fix |
| "Implement precisely, make input functional, apply purple theme, use ComputerScene as base" | LLM | LLM (build intent still fires) |
| "Clicking Connect opens this modal" (interaction) | LLM/wire | LLM/wire (unchanged) |

`detectHiFiIntent` is **not deleted.** It stays alive as the *directive* inside
`runClaudeBranch` (`chat.ts:484`, `buildHiFiDirective`) for prompts that
legitimately land on the LLM (build/interaction) and also carry hi-fi wording —
those still get the "read the real tree, treat the PNG as ground truth" nudge.
We remove hi-fi only from **routing**, not from the LLM's directive assembly.

This is the entire copy-case fix. It is ~1 line of behaviour change in
`generationIntent.ts` plus flipped test expectations.

### Part B — behavior/theme prompts edit the faithful frame (deferred, spec'd for context)

Prompts with build/theme intent still route to `runClaudeBranch`, which today
assembles context from the Figma *summary*. Under the governing principle these
should also start from the faithful deterministic import (run the import, hand
the LLM the real frame, scoped-edit only the requested behaviour/theme). This is
the same shape the **wire-an-interaction** branch already uses (import
faithfully, then a scoped LLM pass that only wires state) — Part B generalizes
that to behaviour/theme.

**Part B is NOT in the first implementation.** It touches the LLM branch's
context assembly (larger surface) and is only worth building once Part A's copy
case is proven on the real nav screen. Recorded here so the principle is whole;
the plan will schedule A first, B as a follow-on.

## Scope

**In (Part A, ship first):**
- Drop hi-fi from the `shouldGenerateFromFigma` routing gate.
- Update `generationIntent.test.ts`: the pure-hi-fi expectation flips to
  deterministic; the multi-instruction motivating prompt stays LLM (build intent).
- Verify on the real nav screen (see Acceptance).

**Out:**
- Part B (LLM-edits-the-import) — deferred, spec'd above for context only.
- The "tweak ComputerScene" / template entry point — different feature.
- Growing `kitMappings.ts` coverage — orthogonal, ongoing; not required for
  fidelity, only for componentization.
- The handoff-doc directions (auto-eject on scene-shaped designs, advisory
  nudges, composite-used metric) — those all try to make the *LLM* stop
  hand-rolling. Deterministic-first removes faithful imports from the LLM
  entirely, so they are moot for this path.

## Risks

1. **Deterministic output on this exact nav screen is unproven in this thread.**
   The failure we have seen is the LLM branch; nobody here has rendered the
   deterministic engine on `139-3839`. Mitigation: the acceptance gate is a live
   render + screenshot of the deterministic output on that exact node, not
   theory. If it has gaps (e.g. an unmapped icon renders as an SVG fallback
   rather than a kit component), those are incremental mapping-row adds — a
   worse-componentized but still pixel-faithful result — not a regression to LLM
   reconstruction.
2. **A prompt that wants a genuine build but omits build/interaction keywords**
   now routes deterministic and silently drops the (unstated) build ask. This is
   the pre-existing keyword-classifier limitation, unchanged in kind. `detectBuildIntent`
   already covers modify/functional/theme verbs; hi-fi wording was never a
   reliable build signal (it means "copy well", not "build new"). Accept as-is.

## Acceptance

Re-run in Studio: **"Implement this design precisely:
https://www.figma.com/design/JztJjqt3i6uFwB6r4dfewz/Navigation--where-to-next?node-id=139-3839"**
(fresh project or `implement-this-design-precisely-2`).

Pass criteria:
- The turn routes to the **deterministic engine** (log: `[kitEmit] … kit
  instances`), not `runClaudeBranch`.
- The Computer wordmark renders as the **logo**, not a black blob.
- Sidebar + content geometry match the Figma layout (no off-screen content).
- **No** hallucinated-import auto-repair turn.
- Screenshot compared against the Figma PNG for the node.

Genuinely-novel bits with no kit match may render as faithful SVG/div fallbacks —
that is acceptable (pixel-faithful, less componentized). Judge on "faithful floor
achieved + no LLM-reconstruction artifacts", not pixel-perfect componentization.

## Verification

- `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts` — unit
  gate for the routing change.
- `pnpm run studio:test` — full suite green (no collateral).
- Live render + screenshot per Acceptance — the fidelity gate (unmeasured layer
  per `studio-fidelity-metric-keystone`; eyeballed until a metric exists).
