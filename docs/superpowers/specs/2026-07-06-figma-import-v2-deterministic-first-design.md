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

## Live verification (2026-07-06) — the bet is proven, not assumed

Before writing the fix, the deterministic engine was run headless on the exact
failing node (`runFigmaKitEmitBranch` with production deps, node `139:3839`,
into project `implement-this-design-precisely-2`) and the output rendered in
Studio + screenshotted against the Figma ground-truth PNG. This settles the
adversarial review's load-bearing doubt:

- **Faithful, no black blob.** Render (`kitemit-nav-deterministic.png`) is
  near-identical to the Figma reference (`/tmp/nav-ref.png`): sidebar with the
  "computer" wordmark pill, ⌘K search, +button, all nav sections, real avatars,
  Agent-studio/Explore footer, full "Good morning, Polina" digest.
- **The wordmark is real and renders.** `Computer/Logo` IS a node in the design
  (the LLM's 78×14 "wordmark" was itself a hallucination of a slightly different
  element). It exported as faithful SVG letter-vectors — NOT a black box, NOT a
  generic monitor glyph. The reviewer's "wordmark may go blank" and "may map to
  `<Computer/>` glyph" failure modes did not fire here.
- **Fast, no timeout.** Whole branch ran in **7.7s** (getNode + 24 asset exports
  + emit), 0 download failures. The reviewer's 30s-hard-cap fear did not bite
  this file class (see Risk 2 — still real for very large files).
- **41% componentized.** 15/37 instances are real kit components (AgentStudio,
  ArrowUpSmall, Avatar, Bell, Computer, DotInLeftWindow, IconButton,
  MagnifyingGlassInSquare, PlusSmall, Window); the rest are faithful markup.
- **One real gap surfaced:** the "Today's Top Priorities" bullet list renders as
  narrow mispositioned columns instead of clean bullets (rich-text list items
  captured as fragments). Readable, all text present — an incremental text-layout
  fix, tracked below, not a blocker.

Compared against the current LLM render (`precisely2-nav-latest.png`: black-blob
wordmark, hand-rolled sidebar, off-screen content, a hallucinated `ArrowUp`
import), the deterministic engine is decisively better on the screen that was
failing. The core bet holds.

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

**Companion change — don't drop a build ask silently (adversarial finding 4).**
Removing hi-fi from routing exposes a class of mixed prompts that carry an edit
verb NOT in `BUILD_INTENT_PATTERNS`: "recreate this exactly, **remove** the
search bar", "implement precisely but make the sidebar **dark**", "build this 1:1
but **swap** the logo". Today hi-fi wording swept these to the LLM; after Part A
they route deterministic and the edit is dropped with no acknowledgment. Two-part
mitigation, both cheap:
1. Widen `BUILD_INTENT_PATTERNS` with the common edit verbs (`remove`, `delete`,
   `swap`, `replace`, `rename`, `dark`/`light mode`) so these route to the LLM
   where the edit can be attempted.
2. The kit-emit trailer already says "tell me what to change next" — keep that as
   the backstop for anything the widened set still misses. The turn is never
   silently wrong; the faithful import lands and the follow-up hook is explicit.

This is the copy-case fix. Code change is small (drop one clause in
`shouldGenerateFromFigma`, add verbs to one pattern array) plus test updates.

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
- Widen `BUILD_INTENT_PATTERNS` with the common edit verbs (per the companion
  change above) so mixed hi-fi+edit prompts still reach the LLM.
- Update the tests below. This is NOT "no collateral" — two files change:
  - `generationIntent.test.ts`: the pure-hi-fi expectation
    (`shouldGenerateFromFigma("implement this precisely")`, line 25-28) flips
    `true → false`; the multi-instruction motivating prompt (line 11) stays
    `true` (build intent); add cases for the new edit verbs.
  - `__tests__/server/middleware/chat-figma-context.test.ts` — the
    "hi-fi directive survives a Figma digest miss" block (lines ~171-199) posts
    `"Implement this precisely <url>"` and asserts the **Claude** branch ran with
    `<high_fidelity_mode>` + "precise mode" narration. After Part A that pure-hi-fi
    prompt routes to kit-emit, so these assertions must be **rewritten**, not
    left to break. See Risk 3 — this test guarded a real guarantee we are
    consciously moving, and the rewrite must re-assert the guarantee in its new
    home (a pure-hi-fi prompt routes deterministic AND produces a faithful frame),
    not just delete it.
- Verify on the real nav screen (see Acceptance).

**Out:**
- Part B (LLM-edits-the-import) — deferred, spec'd above for context only.
- The "tweak ComputerScene" / template entry point — different feature.
- Growing `kitMappings.ts` coverage — orthogonal, ongoing; not required for
  fidelity, only for componentization. Note this explicitly means Part A does
  NOT deliver the handoff doc's stated bar ("sidebar IS `ComputerSidebar`"):
  `ComputerSidebar` is unmapped (`Sidebar` is in `NON_RENDERABLE_KIT_EXPORTS`),
  so the sidebar imports as faithful positioned divs. The live gate confirms that
  is visually faithful. We are deliberately redefining success from the handoff's
  "uses the composite" (a componentization-judgment goal) to "faithful floor +
  componentization as a mapping-table dial" — the deterministic-first frame.
- The bullet-list text-layout gap the gate surfaced — real but incremental
  (`kitEmit` rich-text/list handling), not required to prove the bet. Tracked as
  a follow-on fidelity fix, not part of the routing change.
- The handoff-doc directions (auto-eject on scene-shaped designs, advisory
  nudges, composite-used metric) — those all try to make the *LLM* stop
  hand-rolling. Deterministic-first removes faithful imports from the LLM
  entirely, so they are moot for this path.

## Risks

1. **RESOLVED — deterministic output on this nav screen.** Was: "unproven". The
   live gate (see Live verification above) rendered the deterministic engine on
   `139:3839`: faithful, no black blob, 7.7s, 0 download failures. The bet is no
   longer a bet on this design. Residual: other designs may have unmapped icons
   that fall to SVG (worse-componentized but still faithful) — incremental
   mapping-row adds, never a regression to LLM reconstruction.
2. **Silent build-ask drop — mitigated, not eliminated (finding 4).** A prompt
   with an edit verb outside the widened `BUILD_INTENT_PATTERNS` still routes
   deterministic and drops that edit. This is narrower than pre-Part-A only after
   we widen the verb set (Design companion change). The backstop is the kit-emit
   trailer's explicit "tell me what to change next" — the faithful import always
   lands, the follow-up is one prompt away. Accept the residual: an over-broad
   verb set would re-route pure copies to the LLM (the exact defect we are
   removing), so the set stays tight and leans on the follow-up hook.
3. **Faithfulness-directive guarantee moves engines (finding 1).** The test
   `chat-figma-context.test.ts` guarded "a precise prompt always carries the
   faithfulness directive." Part A moves pure-hi-fi prompts off the LLM, so that
   directive no longer applies to them — the deterministic engine IS the
   faithfulness guarantee for the copy case (it copies pixels; no directive
   needed). The test must be rewritten to assert the guarantee in its new form
   (pure-hi-fi → deterministic → faithful frame), not deleted. If Part B is
   deferred indefinitely, build/theme prompts keep the LLM directive as today —
   nothing regresses there.
4. **30s getNode cap on very large files (finding 2).** kit-emit calls
   `figmanageGetNode` (30s default) with a hard error and no LLM fallback, vs the
   LLM path's 65s digest budget + self-fetch fallback. The gate ran in 7.7s so
   this file class is safe, but a much larger file could time out. Residual, not
   a blocker for Part A; a follow-on can raise the kit-emit timeout or add a
   retry. Do NOT reintroduce the LLM as the fallback — that reopens the
   reconstruct-from-summary failure.

## Acceptance

Re-run in Studio: **"Implement this design precisely:
https://www.figma.com/design/JztJjqt3i6uFwB6r4dfewz/Navigation--where-to-next?node-id=139-3839"**
(fresh project or `implement-this-design-precisely-2`).

Pass criteria (all confirmed once in the pre-spec live gate; the acceptance run
proves the shipped routing reaches the same output through the real chat path):
- The turn routes to the **deterministic engine** (log: `[kitEmit] … kit
  instances`), not `runClaudeBranch`.
- The `Computer/Logo` element renders **faithfully** (exported SVG), not a black
  blob and not a substituted generic glyph.
- Sidebar + content geometry match the Figma layout (no off-screen content).
- **No** hallucinated-import auto-repair turn.
- Screenshot compared against the Figma PNG for the node
  (`kitemit-nav-deterministic.png` vs the exported reference).

Known-acceptable at this bar (do NOT fail the gate on these):
- Unmapped elements render as faithful SVG/div fallbacks (pixel-faithful, less
  componentized) — including the sidebar as positioned divs rather than
  `ComputerSidebar`.
- The "Today's Top Priorities" bullet list renders as narrow columns rather than
  clean bullets — the tracked incremental text-layout gap.

Judge on "faithful floor achieved + no LLM-reconstruction artifacts", not
pixel-perfect componentization.

## Verification

- `pnpm run studio:test __tests__/server/figma/generationIntent.test.ts` and
  `__tests__/server/middleware/chat-figma-context.test.ts` — the two files whose
  expectations change (Scope). Both must be updated as part of Part A, not
  discovered red.
- `pnpm run studio:test` — full suite green after those two are updated. There
  IS collateral (the chat-figma-context block); it is enumerated, not denied.
- Live render + screenshot per Acceptance — the fidelity gate (unmeasured layer
  per `studio-fidelity-metric-keystone`; eyeballed until a metric exists). The
  pre-spec gate already passed; the acceptance run confirms it through the real
  routing.
