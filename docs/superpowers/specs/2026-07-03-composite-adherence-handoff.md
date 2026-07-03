# Handoff: composite-adherence — the agent hand-rolls chrome the kit already provides

Date: 2026-07-03
Branch: `feat/figma-fidelity-eject` (HEAD after the token-class hook: `012459a`)
Status: **investigation brief for the next agent — NOT yet brainstormed/spec'd.** Start with the
`superpowers:brainstorming` skill; do NOT jump to a fix. Two adversarial rounds this session
killed two different "obvious" fixes in this exact area — assume your first idea is wrong until
verified against real files + a live gate.

## Read these first (context you must not re-derive)

- Memory `studio-fidelity-metric-keystone` — why fidelity is unmeasured and DSPy/render-diff
  were rejected. The through-line: deterministic checks are largely done; what's LEFT is
  generation *judgment*, which is prompt-governed and unreliable. This handoff is that residual.
- `docs/superpowers/specs/2026-07-03-structured-fidelity-diff-design.md` — SUPERSEDED. Read the
  "Why superseded" header: it explains why you CANNOT build a "did it use the composite" check
  the naive way (composites expand one element into a big DOM subtree with no Figma-tree
  counterpart; `fidelityDirective.ts:144` MANDATES faithful frames diverge structurally from the
  Figma layer tree). Any composite-adherence enforcement must not repeat that mistake.
- `.superpowers/sdd/progress.md` — the full session ledger (every fix + every adversarial finding).

## The problem (concrete, reproduced live 2026-07-03)

Prompt: *"Implement this design precisely: <Figma Navigation URL>"* (a Computer/Agent-Studio nav
screen). Project `implement-this-design-precisely-2`, frame `01-computer-navigation`.

The token-class hook (shipped this session) fixed COLOR — the frame now renders with real greys/
violet/green, not the earlier flat-unstyled disaster. Verified: 0 bad token classes, 51 correct
paren-form. That layer is DONE.

But the frame is still visibly broken, and the cause is **the agent hand-rolls chrome the kit
already provides.** Its own `### Deviations` said, verbatim:

> - Dismissed NavSidebar/ComputerSidebar — reference shows a hybrid layout (DevRev nav structure
>   with Computer product pill), hand-rolled the sidebar from primitives matching the exact
>   geometry and group structure.
> - Computer wordmark — rendered the full SVG path from the design (78×14px logo)…
> - Agent studio icon — hand-rolled the lock/shield glyph… kit has no exact match…
> - Sun icon — hand-rolled the rays-around-circle glyph… kit's closest (LightingBolt) reads as
>   lightning, not sun.

Visible symptoms in the render (screenshot `precisely2-nav-latest.png` in repo root):
- **Black blob top-left** where the Computer wordmark should be — the hand-rolled 78×14 SVG path
  rendered as a solid black box.
- **Hand-rolled sidebar** instead of `ComputerSidebar` — subtly wrong geometry/spacing vs the
  real composite.
- Content clipped at top / not vertically centered.

None of these are token/import bugs (the existing hooks don't and can't catch them). They are
**"you should have used the composite" judgment failures.**

## Root-cause hypothesis (verify before acting)

The CLAUDE.md template's OWN rules gave the agent license to hand-roll. Read these lines in
`studio/templates/CLAUDE.md.tpl`:

- **Line 14** (rule 2): *"the request is LAW, even when it breaks the kit… build it LITERALLY —
  inline styles, a raw value, a hand-rolled `<div>`/`<svg>` — then note it in ONE Deviations line."*
- **Line 179**: *"Something the user explicitly asked for, but the kit has no slot/prop/composite
  for… **BUILD IT.** Hand-roll the smallest, sturdiest thing…"*
- **Line 196** section: *"When the kit can't express the request — hand-roll FAST, don't hunt."*

These exist for a good reason (an earlier failure mode was the agent STALLING for minutes hunting
for a slot that didn't exist — see the worked example at line 208). But the cure has become the
disease: the agent now reads *"reference shows a hybrid layout"* as *"the kit can't express this,
so hand-roll the whole sidebar"* — when `ComputerSidebar` + `ComputerPage` slots almost certainly
COULD express it (the reference IS a Computer nav screen). The template optimizes hard against
stalling and under-specifies **when to prefer the composite over a fast hand-roll.**

So the tension to resolve: **"hand-roll fast, don't hunt" (avoid stalling) vs. "use the kit
composite" (fidelity + mergeable output).** Right now the former dominates and the agent
hand-rolls chrome that has a real composite.

## Why this is HARD (do not skip — this killed prior attempts)

1. **You cannot deterministically enforce "use the composite."** A write-time hook can check
   "is this class/import real" (facts). It CANNOT check "you should have used ComputerSidebar
   here" — that's a judgment about a design the hook can't see. The adversarial review of the
   composite-used check (see the superseded spec) proved it misfires: it can't fire on a bare
   "implement precisely" prompt (no composite named → `detectComposeBaseIntent` false), and it
   false-flags ejected frames (local `./ComputerScene` import). Do NOT resurrect that check
   without solving both.
2. **Some hand-rolling is CORRECT.** The sun icon (kit's LightpingBolt reads as lightning) and a
   genuinely novel element SHOULD be hand-rolled. The problem is specifically hand-rolling
   **chrome that has a composite** (sidebar, wordmark). A fix must not swing back to "never
   hand-roll" — that reintroduces the stalling bug.
3. **The eject feature exists** (this session): when a prompt names a composite as a base, Studio
   ejects its editable source. But a bare "implement precisely" prompt does NOT trigger eject and
   does NOT name the composite — so the agent is on its own to recognize "this is a ComputerScene
   screen." That recognition is the gap.

## Directions to explore (brainstorm these; none is chosen)

- **Prompt/template rebalance (cheapest, but you distrust prompts — and rightly):** add a rule
  that BEFORE hand-rolling chrome, the agent must check whether a whole-scene composite
  (`ComputerScene`/`ComputerPage`/`NavSidebar`) matches the design's *shape*, and prefer it +
  eject-to-edit over a from-scratch hand-roll. Risk: same as every prompt rule — the agent may
  ignore it (this session is a graveyard of ignored prompt rules). Measure, don't assume.
- **Auto-eject on scene-shaped designs (no naming required):** the phase-2 classifier already
  tries to match a design to a composite (`classifyComposites`, runs in the ingest). If it
  matches `ComputerScene`/`ComputerPage` with confidence, Studio could auto-eject that composite
  into the turn and tell the agent "this design matches ComputerScene — start from the ejected
  copy" EVEN on a bare prompt. This turns "recognize + use the composite" from agent judgment
  into a deterministic pre-step. Verify: does the classifier actually fire + match on this nav
  design? (It was crashing earlier — `classifier failed with exit null` — check that's fixed by
  the 120s bump from this session.)
- **A post-turn ADVISORY (not a block):** a check that notices "the design's Figma tree contains
  a sidebar/nav region AND the frame hand-rolled an `<aside>` instead of using ComputerSidebar"
  and surfaces it as a deviation-quality warning or a verify-loop nudge — NOT a hard block (can't
  be, per HARD #1). Honest about being heuristic.
- **The composite-used metric, done right:** if revived, derive "expected composite" from the
  classifier match (not the prompt), and detect the ejected LOCAL import — the two things the
  adversarial review said were missing.

## Acceptance (what "fixed" looks like)

Re-run the bare *"Implement this design precisely: <Navigation URL>"* prompt (project
`implement-this-design-precisely-2` or fresh). Success = the sidebar is `ComputerSidebar` (or an
ejected+edited copy), the Computer wordmark renders as the wordmark (not a black blob), and the
Deviations list does NOT say "dismissed ComputerSidebar, hand-rolled from primitives." Genuinely-
novel bits (a truly-absent icon) may still be hand-rolled + flagged — that's fine. Judge on
"did it use the kit chrome that exists," not pixel-perfection.

## State of the branch (so you don't re-do shipped work)

`feat/figma-fidelity-eject`, 64 commits ahead of main. SHIPPED + tested this session (do not
redo): routing fix, always-on hi-fi directive + cap-safe self-fetch, node/depth caps 16/1200,
classifier timeout 120s, eject-to-source, Vite module-graph invalidation on frame write,
theme-overrides.css imported-last (purple theme works), token-class enforcement hook (full suite
1903 pass). SUPERSEDED (do not build): the structured fidelity-diff / vision-judge. The token-
class hook's live gate passed for ITS scope (color); this handoff is the NEXT layer.

Branch is large + carries one shelved spec — a PR-slicing decision is pending, separate from this
work.
