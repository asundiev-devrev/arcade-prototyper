# Figma turn routing — provenance + constraints (Option A, reduced)

**Date:** 2026-08-06
**Status:** **SHIPPED.** L2 + L3 + the cascade landed as task 1; the wiring (§5.2–§5.4) and
the template edits (§6) landed as task 2. Full suite **2606 passed / 0 failed / 2 skipped**
(2461 baseline + exactly the 145 new tests; the arithmetic closes, §7).

**REVISION 7 (2026-08-06, independent verification pass before commit).** Every load-bearing
claim in this document was re-measured from primary sources — the corpus fixture, real frame
files on disk, the actual source files, a clean full-suite run, `tsc`, and one deliberate
poison test. **The design claims all held. The MEASUREMENT REPORTING did not**, in four places,
and all four are now corrected in place:

| # | What was wrong | Corrected to |
|---|---|---|
| 1 | Full suite reported **2581**; a "verified" run said **2617** | **2606** on a clean tree. Both earlier numbers were taken with three untracked scratch probe files (`zz-probe1`, `zz-probe2`, `zz-corpus-measure`) sitting in `__tests__/`, which `vitest run` counted as real tests. They are deleted. §7 |
| 2 | Per-file test counts (22 / 22 / …) | 42 / 27 / 18 / 18 / 13 / 11 / 10 / 6 = **145**, each from running the file alone. The old numbers were counted from `it(` source lines, which undercounts `it.each` tables. §7 |
| 3 | §5.2 and §8 said the brain+glue closure is **8** files; §7 said **9** | **9**. The test's `toEqual` list is the authority; the two "8"s predated `turnDirectives.ts`. |
| 4 | §1(c)/(e) cited line numbers as if current | Marked as PRE-EDIT, with the post-wiring numbers added. This branch's own edits moved every one of them. |

**The arithmetic now closes, which is the check that matters: 2461 baseline + 145 new = 2606.**
No pre-existing test was deleted or skipped to make room.

**Independently re-confirmed as TRUE** (verbatim commands in the commit message): 67 prompts /
15 labelled corrections / 13 carrying a Figma URL; the residue distribution 0,0,0,25,64,113,
121,155,161,168,191,441,919 exactly as §1(a) states; `data-figma-id="5678:118877"` occurs
exactly once in the live frame `01-figma-5678-118876` while the frame's own root node
`5678:118876` appears **nowhere** in that file (so source 3 is load-bearing, §2.3); 12 distinct
nested-instance `I…;…` ids exist in that one file, so the attribute-exact matcher is doing real
work; across **11 live projects exactly 2 files** carry the attribute (§9 item 2 is honest);
`shouldUseHiFi` fires on `classified && !hasHighConfidenceComposite` regardless of wording and
`buildHiFiDirective` does say *"each section has the SAME number of rows, same order, as the
PNG"*; `suppressWholeFrameDirective` does not exist, `suppressHiFiDirective` does; #39 really
has no Figma URL; the L3 fire set is asserted as exactly `[2, 30, 39]`; the resolver seam is
genuinely absent from the tree (only comments and a test's rationale mention it).

**The headless guard is NOT vacuous — verified by poisoning it.** Prepending
`import { frameDir } from "../paths"` to `turnConstraints.ts` fails **4 of 18** tests and names
all three chains, e.g. `reaches server/paths.ts via server/figma/turnDirectives.ts ->
server/figma/turnConstraints.ts -> server/paths.ts`. Restored to clean afterwards.

**REVISION 6 (2026-08-06, task 2's resolver-seam brief).** The brief asked for L4 to be built.
It was re-measured from scratch instead of built or refused on trust — **the cut holds**, on a
sharper argument than revision 4's (there is no gate that decides *whom to ask*, and asking
unconditionally destroys the deterministic fast path in the headless host). What shipped is the
seam's two guarantees held by the cascade, plus **two real defects the tests exposed**: a
host-supplied reader returning a non-array crashed the whole turn, and `decidedBy` still
advertised two unreachable `"resolver"` states. See §0.1.

**REVISION 5 (2026-08-06, task 2 — the constraint now REACHES the agent).** Task 1 produced
correct plans; nothing acted on them (`buildSingleFrameDirective` had zero non-test callers).
Five things changed, and two revision-4 instructions were corrected against measurement:

| # | Change | Where |
|---|---|---|
| 1 | **New brain module `server/figma/turnDirectives.ts`** — `buildTurnDirectives(plan)` (owning the directive set AND its order) + `shouldSuppressWholeFrame(plan, ctx)`. This is revision 4's finding 7-adjacent blocker: turning a plan into words was the one part of the feature that lived only in `chat.ts` (61-module closure), so #30 was fixed inside the .dmg only | §3.5, §8 |
| 2 | **Directives are built BEFORE any ingest and survive a digest MISS.** Verified by mutation: reverting the guard fails 5 of the 10 middleware tests | §3.5 |
| 3 | **A new `<target_frame>` directive** carries `plan.targetFrame` / `frameCandidates`. It deliberately does NOT go through `prependEditContext`, whose `if (!frameSlugs.length) return prompt` would silently drop it (revision 4's §5.4 warning) | §5.4 |
| 4 | **`makeStudioFrameReader`** (`server/figma/adapters/studioFrameReader.ts`) — the only Studio filesystem path in the feature. Enumerates every `*.tsx` per frame dir, recovers `fileKey` from `LIFT.json#intentSummary` and the origin node from the slug | §5.2 |
| 5 | **Three template edits** landed, with a marker-phrase test | §6 |

**CORRECTION A — §5.3's suppression widening needed an EXPLICIT-HI-FI CARVE-OUT, which the
spec did not have.** Widening `suppressHiFiDirective` unconditionally means
`"Implement this precisely, but keep it in the same frame: <url>"` loses the
`<high_fidelity_mode>` block it gets today AND gains the constraint — revision 4 identified
that as "strictly worse" but only for the miss path; it is true on the hit path too.
`shouldSuppressWholeFrame` therefore returns `false` when `detectHiFiIntent` is true: the
frame question is settled by the constraint directive, which is appended LAST and opens by
overriding everything else about frames, so nothing is lost by keeping the fidelity rules.
Measured, the carve-out fires on **zero** real prompts — `detectHiFiIntent` is false for #1,
#2, #30 and #39 — so suppression is total for every prompt this design fixes. Pinned by test.

**CORRECTION B — revision 4's finding 8 remedy was WRONG, and I am not doing it.** It said
"the single-frame rule must ALSO be added to the root `SKILL.md`, which is the real
foreign-host surface". Measured: `SKILL.md` is the **other product** — the Arcade Prototyper
skill — and line 98 says *"This skill builds prototypes in plain HTML, CSS, and vanilla
JavaScript — always. It never produces a React app… Do not reach for React, JSX, npm
packages, or a framework."* It has zero occurrences of `FrameLink`, `frames/`, or
`separate frame` because it has **no frame model at all**: every prototype is one HTML file.
Adding a rule about React `useState` and frame directories there would be instructions for a
product that cannot follow them. Finding 8's *measurement* stands (the template renders only
into a Studio project dir), but the remedy was aimed at the wrong file. **The real
foreign-host surface for this rule is `buildTurnDirectives`, which now exists and travels to
every host that calls the cascade** — that is what item 1 above is for, and it is a better
answer than the template ever was, because it is prompt-region text rather than a project
file.

**Still open, honestly:** no live gate has run (§9 item 7). Every claim here is from source
reading, the committed corpus, real frame files on disk, and mutation-testing the new code.

**REVISION 4 (2026-08-06, adversarial review of the landed L2/L3) — eight findings, every
one reproduced by running the real modules before acting on it.** Two of the fifteen were
STALE (they described `origin` diverting, which revision 3 had already fixed) and one was
WRONG (the "wire turn drops its constraint" finding — the wire branch imports URL#2 into the
SAME frame dir and its prompt already forbids a second frame, so the constraint is satisfied
by construction; the proposed fix would have removed correct behaviour). The rest were real:

| # | Finding | Where fixed |
|---|---|---|
| 1 | A bare noun phrase `/(same\|one\|single)\s+frame/` **INVERTED 8 of 8 multi-frame asks** — the worst class of bug here, since the directive is a hard override | §3.2 — pattern deleted, survivors negation-anchored |
| 2 | Provenance was **paste-order sensitive**: a weak `origin` hit on URL#1 shadowed a divertible `exact` hit on URL#2 | §2.5 — loops inverted to source-major |
| 3 | **Node ids collide across Figma files** and multi-file projects exist on disk | §2.5 — optional `fileKey` filter |
| 4 | `parseFigmaUrl` — part of the host INPUT CONTRACT — lived in a `node:child_process` module the brain forbids | §5.2 — extracted to a zero-import leaf; guard widened to the glue |
| 5 | §2.3 told the implementer to import from `kitEmitBranch.ts`, which re-couples the brain **transitively** (20-file closure reaching `paths.ts`) | §2.3 — leaf-module rule, stated as general |
| 6 | The guard needle `server/paths` **can never match** (28 × `"../paths"`, 0 × the literal) | §5.5 — resolved-path closure walk, self-tested |
| 7 | §3.5's attach point is **unreachable on a digest MISS** — `chat.ts:854` returns first, and all four fixed prompts have `detectHiFiIntent === false` | §3.5 — corrected attach point + mandatory miss test |
| 8 | §6/§8 claimed the template ships to foreign hosts; measured, it renders **only** into a Studio project dir and `SKILL.md` has none of these rules | §6, §8 — claim retracted, `SKILL.md` added to task 2 |

Three under-specified decisions were also forced into the open rather than left to a reader:
a child-node hit means **edit the parent** (§2.5, with the cost argument), `nested` is
**defensive-only** (§2.5, measured to be reachable by nothing), and the `hasFigmaNode` scope
guard means **#39 is fixed by the template alone, not by routing** (§3.3). Also: apostrophe
normalisation must NOT strip non-word characters — that erases Cyrillic and Slovenian (§3.2).

**L4 (the resolver seam) is now DELETED FROM THE TREE, not merely cut on paper.**
`resolveTurn.ts` and its ~34 tests are gone; `planFigmaTurn` takes one injected dep.
**REVISION 3 (2026-08-06, implementation pass) — two independent re-measurements of the
§0 cuts, both of which FAILED, i.e. the cuts hold.** Recorded because the next person
will have the same two ideas:

1. **"Raise the L1 threshold so it clears the must-miss band."** Tried. The band has no
   ceiling. A *long* faithful-copy ask — `"The spinner animates in the prototype but keep
   it static for now, and the chart animates on load in Figma — ignore both, just draw the
   frame as it is"` — measures residue **141**, which is *exactly* corpus #25's and #32's
   residue (141 and 141). Not merely overlapping: identical. There is no threshold, at any
   value, that admits #25/#32 and excludes descriptive prose, because prose length measures
   verbosity and the decision needs intent. §0's cut is confirmed by a second method.
2. **"Skip length; use a STRUCTURAL signal instead."** Tried two, since a structural
   signal is not a vocabulary and so is not covered by the keyword ban.
   - *2+ numbered list items* (`1. … 2. …`): fires on #25 and #3, and on **2 of 46**
     adversarial faithful-copy strings — a designer describing a stepper
     (`"copy this exactly - the stepper reads 1. Account 2. Billing 3. Done"`) is
     indistinguishable from one issuing a numbered instruction list.
   - *Requirement modal* (`must` / `should` / `needs to`): fires on #2 #22 #25 #32 with
     **0/46** false positives on the committed must-miss lists — briefly promising, and it
     would have fixed both remaining prompts. Then tested against fidelity hedges, which
     the committed lists happen not to contain: **19 of 19 false positives**
     (`"it should look exactly like this"`, `"this must look exactly like the figma"`,
     `"needs to look exactly like the design"`, …). `should` in designer prose most often
     means *"the copy should be faithful"*, not *"here is a requirement"*. This is the
     speech-act-versus-vocabulary trap the corrective detector already died of, wearing a
     grammatical costume. **Rejected.**

   Both attempts are kept here so the next person does not spend the afternoon: the
   measurement scripts were throwaway, the conclusion is not. §9 item 1 stands — **#25 and
   #32 are genuinely unfixed by any deterministic rule we have found**, and a test pins
   that rather than hiding it.

**REVISION 3 also changed the design in one place, found BY the tests.** `origin`
provenance (§2.3 source 3) must **name a frame but never divert a turn on its own.**
Measured against the live frames, `origin` fires on exactly two corpus prompts: #2,
which escapes the importer anyway via interaction intent + a constraint, and **#0 —
the verbatim `"Implement this precisely: <url>"`, whose URL points at the ROOT node of
frame `01-figma-5678-118876`.** So a plain re-import of a frame's own URL is
indistinguishable from `origin`, and diverting on it pulls the canonical bare import
off the 16–26s deterministic fast path (hard constraint 4) to fix **zero** prompts:
`origin` is the sole escape for none of the 13. Only `exact` and `nested` — "the node
is DRAWN INSIDE an existing frame" — divert. `ProvenanceResult` therefore carries a
`via` field so the router can tell the sources apart; collapsing them would lose the
distinction that decides routing. Two tests pin this
(`planFigmaTurn.test.ts`: "re-pasting a frame's OWN root url stays on the importer",
"a nested-instance containment hit DOES divert").

A second implementation finding, about the guard rather than the design: §7's static
import guard **must strip comments before matching.** The first version failed on all
four brain modules because each one *documents* the rule ("must not read
`process.env`") and a raw source grep cannot tell a prohibition from a violation. A
guard that fires on its own documentation trains people to delete the documentation.
The shipped guard walks the transitive relative-import closure, reports the offending
chain, strips comments, **and self-tests** — it asserts it still detects both failure
shapes against `kitEmitBranch.ts` (a known-dirty module), because a guard that cannot
fail is worse than no guard. Verified by hand: injecting `import { frameDir } from
"../paths"` into `provenance.ts` fails it with
`reaches server/paths.ts via server/figma/provenance.ts -> server/paths.ts`.

Also in revision 3: the nine review findings against the first draft (commit `89b01cd`)
were each verified by running the real modules; all nine were real. The largest —
cascade ORDER — is fixed in §4 by putting `wantsGeneration` and the wire check ABOVE
anything new, so the new layers can only ever REMOVE turns from the importer. Two smaller
ones survive into implementation notes: the frame-slug comparison must be **exact after
stripping the numeric prefix**, not `includes` (`'01-figma-5678-118876'.includes('figma-5678-11887')`
is `true` — a sibling-node collision that would confidently name the wrong frame, §2.3),
and the constraint patterns must **normalise curly apostrophes** (5 of 67 corpus prompts
use U+2019; `don’t separate these screens` matches nothing without it, §3.2).
**Branch:** `fix/studio-brain-figma-edit-routing` (on top of `e891443` interaction widening + `d9e7c4a` blur)
**Motivating session:** the 2026-08-06 designer session (project `implement-this-precisely-3`
on Onboarding 3.0, and `polina-s-prototype` on the Untitled tabbed-canvas file) plus the
67-prompt corpus at `studio/__tests__/fixtures/designer-prompts.json`.

**This revision REPLACES the first draft of this file (commit `89b01cd`).** That draft
specified four layers. Two of them were then measured and cut. §0 records what was cut, what
the measurement said, and why the cut is not a retreat. Everything after §0 describes only
what ships.

---

## The bug in one paragraph

A designer pastes a Figma URL with instructions attached. Studio's router asks "does this
prompt contain build-intent keywords?" — and when the answer is no, sends the turn to the
deterministic importer, which has **no LLM and therefore cannot read one word of the
prose**. Measured on the real corpus, 4 of the 13 Figma prompts lose their instructions this
way. One of them (#30) literally reads `DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!` and was
ignored — the importer stamped a separate frame, and the designer's very next turn (#31) is
them explaining the failure back to us: *"You just imported the reference design as a
separate frame `Frame 36 7860`"*. That is the whole bug: **we throw away instructions we can
see.**

A keyword corrective-detector was built and removed on this branch (27% recall on 15
labelled corrections, and it fired on descriptive faithful-copy prose). It is **banned** here
— see the long note at case 4 in `studio/server/figma/turnRouting.ts`. Nothing in this spec
re-adds correction keywords under any name.

---

## 0. SCOPE — what ships, and what was cut after measurement

**SHIPS: two deterministic layers.**

```
Figma-URL prompt
  L2  PROVENANCE   deterministic; reads rendered frame sources through an INJECTED accessor
                   is the pasted node ALREADY in a frame we rendered?
                   yes → this is an EDIT of that frame, and the frame is named exactly
  L3  CONSTRAINTS  deterministic, 0ms, pure
                   explicit "single frame" / "don't separate these screens"
                   → attach a HARD single-frame directive, and divert off the importer
```

Plus one **template edit** (`studio/templates/CLAUDE.md.tpl`), which is where the
single-frame complaint actually gets fixed for hosts that never assemble our directive.

**CUT — L1, the prose gate.** Rejected on measurement, not taste. The idea was: strip URLs +
faithful-copy boilerplate, and if little survives, the turn is provably a bare import. The
measurement kills it:

| string | must go to | residue after URL-strip |
|---|---|---|
| corpus #1 `"You haven't implemented this background blur properly: … try again"` | **the model** | **64** |
| committed must-miss `"the spinner animates in the prototype but keep it static for now"` | **the importer** | **64** |
| committed must-miss `"No need to animate the loader, just draw it as it is in the frame."` | **the importer** | 66 |

Identical length, opposite required destination. The distributions overlap across roughly
33–84 characters. Measured with the full strip list, adding the prose gate does fix corpus
#25 and #32, but it also flips **20 of the 32 committed must-stay-deterministic strings** onto
the LLM — destroying the deterministic fidelity guarantee the whole Figma-import lane is
built on. L2+L3 alone fix #1 and #30 with **zero** regressions (measured, §2.6). That is a
strictly better trade. **Do not build a prose gate. Do not reintroduce it under another
name** (a "residue budget", a "boilerplate ratio", a "token count"). Any such proposal must
first show a rule that separates 64 from 64.

**CUT — L4, the resolver seam** (`TurnQuestion`, `TurnAnswerSchema`, `TurnResolver`,
`resolveTurnOrFallback`, `studioCliResolver`, and their ~10 tests). Rejected on measurement.
Running the cascade over the 13 corpus Figma prompts with the resolver present versus absent
gives **"prompts whose KIND differs: 0."** Every prompt that would reach L4 already needs the
generator, which is exactly what the no-resolver fallback hands it. It was the largest chunk
of the spec and bought nothing. It also cost more than nothing: a resolver on the routing
path is a new failure surface and a new latency surface on every non-bare Figma turn.

Add it later when a **real** prompt needs a `targetFrame` that provenance cannot name — with
that prompt as the evidence. The place it plugs in is deliberately obvious: the
`decidedBy: "default"` exit at the bottom of the cascade in §4.

**Revision 4: the cut is now EXECUTED in the tree**, not just declared here.
`server/figma/resolveTurn.ts`, `__tests__/server/figma/resolveTurn.test.ts` and
`__tests__/server/figma/planFigmaTurnResolver.test.ts` are deleted, and `planFigmaTurn`'s
signature is back to one injected dep with no `opts`. A half-removed seam is worse than either
end state: it leaves a reader unable to tell what the design is.

### 0.1 REVISION 6 — the L4 cut, RE-MEASURED independently (task 2, 2026-08-06)

Task 2 was briefed to BUILD the resolver seam. The brief predates revision 4's cut and its
gating condition ("consulted only when the prose gate passed") names L1, which is also gone —
so the instruction could not be followed as written, and the cut was re-measured from scratch
rather than taken on trust. **The cut holds, and the argument for it is stronger than the one
on record.** Revision 4 justified it with "prompts whose KIND differs: 0", which is an
argument about the *outcome* being unchanged. The sharper finding is about *feasibility*:
there is no gate that decides WHO to ask.

Exactly **six** prompts reach `decidedBy: "default"`, the sole plug-in point:

| prompt | residue | needs |
|---|---|---|
| #37, #45, #53 (bare URL) | 0 | the importer — must NOT be asked |
| #0 `"Implement this precisely:"` | 25 | the importer — must NOT be asked |
| #25 `"There must be three buttons on the right hand side…"` | 156 | a model |
| #32 `"When a new tab is created, a user must see this page…"` | 169 | a model |

A resolver only pays if something separates those groups with no model. Two candidate gates
were measured; both fail, and both fail in the way §0's other cuts already document:

1. **Residue length.** At step 8 the committed must-stay-deterministic strings top out at 111
   and the model-needing prompts start at 156 — an apparently clean 45-char gap, but fit to
   **two** positives. Growing the longest committed *bulleted* faithful-copy string by two
   more bullets of the same speech act (`"- the composer with the send button on the right"`)
   takes its residue to **204**, past both. Worse, in the PRIMARY host — no frame reader, the
   bare Claude Code case — provenance cannot run, so #1 falls through to step 8 at residue
   **65** and collides exactly with two committed must-miss strings, also **65**:
   `"this frame documents the CSS transition tokens, copy them exactly"` and
   `"Implement this precisely — the confirmation after tapping Delete."` Same number, opposite
   required destination. This is the banned prose gate re-derived at a later point in the
   cascade, failing identically.
2. **Fidelity vocabulary** (`detectHiFiIntent` as an ask/don't-ask gate). FALSE for **13 of
   the 30** committed must-stay-deterministic strings that reach step 8 — including
   `"import this from figma"`, `"bring this in"`, a bare URL, and `"No need to animate the
   loader, just draw it as it is in the frame."` All 13 would be asked.

And the cost of asking without a gate is measured, not feared. Hard constraint 1 says an
unanswered question falls back to the GENERATOR — correct in isolation, but with no adapter
supplied (the bare headless host, which is the *target*) that rule converts all four bare
imports and all 30 must-miss strings from a 16–26s no-model import into a p50 98s build turn.
**The seam's own fallback rule destroys the deterministic fidelity guarantee in exactly the
host the seam exists to serve** — the guarantee the dominant Figma-import lane is built on
(auto-memory `figma-import-is-the-dominant-usecase`). A resolver is only safe *behind* a gate,
and the gate is the part that does not exist.

So step 8 stays terminal. What task 2 shipped instead is the seam's two *guarantees*, held by
the cascade and pinned by test, since those are what a future resolver would have to preserve
anyway:

- **fallback DIRECTION** — all seven ways the one injected capability can fail (absent,
  `undefined`, throws, rejects, returns `null`, returns a non-array, returns junk entries)
  degrade towards today's behaviour and never onto a *wrong* frame; and none of them can
  cancel pure L3, so corpus #30 stays fixed through every one.
- **the LATENCY guarantee** — a bare URL costs at most one capability call, asserted on the
  call count rather than the outcome, so a plan that is right but woke the host up still fails.

**Two real defects were found by writing those tests**, which is the argument for writing them
even though the seam was cut:

1. `locateNodeProvenance` guarded its host-supplied reader with `?? []`, which catches `null`
   and `undefined` but lets **any other non-array** reach `.filter` → `TypeError`. Callers have
   no try block *by design* (the module promises NEVER THROWS), so a foreign host returning a
   single unwrapped object, a `Map`, or an unparsed JSON string **failed the designer's whole
   turn**. Now `Array.isArray`-normalised; 7 tests fail without the fix (verified by reverting).
2. `FigmaTurnPlan.decidedBy` still declared `"resolver"` and `"resolver-fallback"` after the
   seam was deleted — union members no producer can emit, advertising a host capability that
   does not exist and inviting a caller to branch on an impossible state. Deleted, with a test
   asserting every emitted `decidedBy` is one of the six real layers *and* that the corpus
   exercises all six, so the union cannot rot in either direction.

Odd-input tolerance is now pinned too (376KB prompt routes in 10ms despite the unbounded
`[^.]*` spans in the build-intent patterns; a prompt that is itself JSON cannot inject a
`targetFrame` or a constraint; `"import"` stays ordinary prose).

**Still rejected, do not re-propose:**

- **"classify every Figma turn"** — adds latency to bare imports (4 of 13 real prompts, and
  the product's speed advantage), and makes a classifier outage break importing entirely.
- **"no gate, all prose to the generator"** — loses the deterministic fidelity guarantee
  whenever ANY prose is present, e.g. "implement this precisely, but make the header 16px".

---

## OVERRIDING CONSTRAINT — build for the headless brain, not the .dmg

Product owner, explicit: *"everything we do must be optimised for the headless/brain
version. If it only serves the .dmg app — we're not doing that."* The designers do not use
the desktop app; they work in their own Cursor / Claude Code. Only 2 of the team have ever
opened the `.dmg`. Studio is ONE host of several.

Consequences that bind every module below:

1. **No subprocess anywhere on the routing path.** `systemSynth.ts`'s `claude --print` shape
   presumes a host that owns a CLI binary and Bedrock credentials. In Claude Code / Computer
   the brain is *already executing inside a model turn*. With L4 cut, no module in this
   design spawns anything at all — the constraint is satisfied by construction, and §7's
   static guard keeps it that way.
2. **No module on the routing path may reference a Studio filesystem path**, Electron, IPC,
   or a Studio-only env var. L2's provenance signal is portable, but it reads through an
   **injected frame-source accessor**, never `~/Library/Application Support/…`. Compare the
   `import-hook-dead-in-dmg` failure one level up: a dev-only path silently disabled a whole
   feature on tester machines, and every test passed.
3. **`templates/CLAUDE.md.tpl` IS in scope** — generator instructions travel to every host.
   That is brain, not interface, and on a Claude-Code host it is the *only* thing we ship.
4. The `LibraryAdapter` seam (`feat/library-adapter-seam`,
   `studio/server/figma/libraryAdapter.ts`) is the precedent for seam shape in this repo: a
   small, deliberately-minimal, host-neutral interface, with a doc comment naming what is
   SHARED versus PER-HOST and refusing to grow without a surfaced reason. L2's
   `FrameSourceReader` follows that pattern — one function, no Studio vocabulary.

---

## 1. VERIFICATION LOG (run 2026-08-06; corrections to the brief are marked)

Everything below was measured, not assumed. Where reality differed from the task brief, the
spec follows reality.

### (a) Prose-length distribution — CONFIRMED for the Figma corpus, but it does NOT support a threshold

URL-strip only, across the 13 corpus prompts carrying a Figma node URL:

```
  0  #37 #45 #53   (bare URL, nothing else)
 25  #0            "Implement this precisely:"
 64  #1  CORR      "You haven't implemented this background blur properly: try again"
113  #23           "Replace the bar at the top of "My tickets" page … with this one …"
121  #22           "When I click on "My tickets" item in the side nav … AS A NEW TAB …"
155  #25           "Now, the line underneath … 1. There must be three buttons …"
161  #30           "… change from table to list view … (DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!)"
168  #32           "Let's implement a default "new tab" experience …"
191  #2            "When I click on "Save" … don't separate these screens …"
441  #15
919  #3
```

The 0/25 → 64 gap the brief describes is REAL and was not tuned to fit. **But it is not a
usable gate**, because the comparison set that matters is not the Figma corpus alone — it is
the Figma corpus *versus* the committed must-stay-deterministic strings, which occupy the
same band (§0). That is why L1 was cut. The distribution is kept here as the record of why.

### (b) Provenance via `data-figma-id` — CONFIRMED, with three sharp caveats

Frame `01-figma-5678-118876/index.tsx` in the live project contains
`data-figma-id="5678:118877"` exactly once, and 25 `data-figma-id` attributes in total.
Corpus #1 pasted `node-id=5678-118877` → attribute hit → provenance works, with no language
understanding at all.

The attribute is stamped by `figmaIdAttr` (`server/figma/kitEmit.ts:1025-1027`) and used at
26 emit sites, i.e. on every emitted child node. Caveats, all verified:

1. **The frame's own ROOT node id is NOT in the file.** `01-figma-5678-118876` was imported
   from node `5678:118876`; `grep -o '5678[:-]118876' index.tsx` returns **nothing**. The
   outer wrapper is emitted as a plain `position:relative` div with **no** `data-figma-id`.
   So `5678:118877` is the frame's first child, and re-pasting the ORIGINAL URL finds nothing
   in the source. The frame *slug* (`figma-5678-118876`, from `frameNameFromNode` at
   `server/figma/kitEmitBranch.ts:139-141`) and `LIFT.json`'s `intentSummary` both carry it.
   → provenance must check **three** sources, not one (§2.3).
2. **`data-figma-id` is recent and only the deterministic importer writes it.** Verified
   across all 11 live projects: exactly **2 frame files in 1 project** contain the attribute.
   `polina-s-nav-2`, `list-view`, `implement-this-page-from-connectors-2`,
   `polina-s-prototype`, `wire-test`, `compound`, `race`, `kit-verify`, `figma-export-poc` —
   **zero**. LLM-written frames never have it. So a MISS is the common case today, and §2.4's
   "refuse to guess" rule is load-bearing rather than theoretical.
3. **Nested-instance ids exist and must not false-positive.** The same file has
   `data-figma-id="I5678:118877;5346:75923"` and 4 more of that shape. A naive substring
   search for `5678:118877` matches those too. The match must be **attribute-exact**.

Also verified: the two frames in `implement-this-precisely-3` share **zero** node ids
(`comm -12` on their sorted attribute sets is empty; 25 vs 58 ids). So ambiguity is rare in
practice — but a designer who imports the same node twice creates it immediately, which is
why §2.4 handles it rather than assuming it away.

### (c) `CLAUDE.md.tpl` line numbers and wording — CONFIRMED

`studio/templates/CLAUDE.md.tpl` was **883 lines BEFORE this branch's §6 edits and is 885
after** (verified against `git show HEAD:studio/templates/CLAUDE.md.tpl`). The line numbers in
this subsection are therefore the PRE-EDIT ones — they are what §6's instructions were written
against and must be read that way. Post-edit, the same rules sit at 545 (unchanged, now with
the escape clause appended), 549, 551 (the new override paragraph), 553 (the signal list
heading) and 556 (the `pressing Save` line, pushed down 2 by the insert). Verified current
pre-edit text:

- **line 545** — `If the user prompts for additional steps ("add a confirmation step"),
  create frames for only the new steps, numbered after the highest existing two-digit
  prefix. Do NOT ask first — the user has committed to multiple frames. Normal response shape.`
- **line 549** — "A multi-frame prototype without navigation is just three disconnected
  screens. If the user's prompt names a specific element that should cause a transition
  between frames, wire it using `<FrameLink>`. Otherwise don't."
- **lines 551–555** — the signal list, headed `**Signal patterns to watch for in the
  prompt:**`, including **line 554**:
  `- "pressing Save goes to the confirmation" — wrap the Save button.`

Corpus #2 is *verbatim* that phrasing shape: `When I click on "Save", I want you to animate
the transition to this screen: … IMPORTANT: don't separate these screens onto multiple
frames, the transition must happen within this single frame.` The template tells the
generator to treat exactly this as a cross-frame `<FrameLink>` signal, and line 545 tells it
to create frames for new steps without asking. **The template contradicts the designer.**
Confirmed, and this is why §6 is not optional garnish.

### (d) `shouldUseHiFi` fires on a novel design with no hi-fi wording — CONFIRMED

`server/figma/fidelityDirective.ts:81-84`: `shouldUseHiFi` returns true when
`ctx.classified && !ctx.hasHighConfidenceComposite`, regardless of prompt wording. Pinned by
a committed test — `shouldUseHiFi("build this nav from the figma", { classified: true,
hasHighConfidenceComposite: false })` → `true`
(`__tests__/server/figma/fidelityDirective.test.ts:61`).

What it then attaches (`buildHiFiDirective`, `fidelityDirective.ts:182`) includes, verbatim:

> `· each section has the SAME number of rows, same order, as the PNG,`

i.e. **build a fresh full frame**. On a single-frame or provenance-located edit turn that is
exactly the wrong instruction. The brief's claim is confirmed, and §5.3 suppresses it.

### (e) The suppression seam — CONFIRMED, but the brief's NAME is wrong

There is no `suppressWholeFrameDirective` anywhere in the repo (`grep` → 0 hits, re-confirmed
revision 7). The real seam is **`suppressHiFiDirective`**, a boolean on
`resolveFigmaReference`'s ctx. Pre-edit line numbers, which is what §5.3 was written against:

- `chat.ts:796` — `const scopedEdit = isScopedEditTurn(prompt);`
- `chat.ts:844` — passes `suppressHiFiDirective: scopedEdit`
- `chat.ts:875` — declares the flag, with the doc comment explaining why
- `chat.ts:914` — digest MISS branch: `if (!explicitHiFi || suppressHiFiDirective) return { block: null, png: null }`
- `chat.ts:938` — digest HIT branch: `if (!suppressHiFiDirective && (explicitHiFi || shouldUseHiFi(...)))`

Both the hit and miss branches are already covered, which is why §5.3 widens this exact flag
rather than adding a second one. **Use the real name in the implementation.**

> **POST-WIRING LINE NUMBERS (revision 7).** The §5.2–§5.3 edits added ~108 lines to `chat.ts`,
> so every number above has moved. Re-measured on the shipped file, so a reader is not hunting:
> `explicitHiFi` 821 · `buildTurnDirectives(figmaPlan)` **833** (deliberately above the guard,
> §3.5) · `scopedEdit` 838 · `suppressWholeFrame` 848 · the ctx hand-off **897** · the
> `if (!blocks.length)` digest-miss guard **910** · `buildScopedEditReferenceDirective()` 914 ·
> the flag declaration 940 · the MISS branch **979** · the HIT branch **1003**. Line numbers in
> a spec rot on the first edit; the grep-able symbol names above are the durable reference.

### (f) Routing today — CONFIRMED exactly

Measured by calling the real `classifyFigmaTurn` (plus `shouldGenerateFromFigma`,
`detectInteractionIntent`, `extractFigmaUrls`, `parseFigmaUrl`) on the corpus:

```
#0  kit-emit  ← correct (bare)               #30 kit-emit ← LOSES "DON'T … SEPARATE FRAME!!!"
#1  kit-emit  ← LOSES the correction         #32 kit-emit ← LOSES instructions
#25 kit-emit  ← LOSES instructions           #37 #45 #53 kit-emit ← correct (bare)
#2 #3 #15 #22 #23 → claude (already correct)
```

4 of 13 lose prose. Confirms the brief.

### (g) `parseFigmaUrl` normalisation — CONFIRMED sufficient

`server/figmaCli.ts:7-16` already rejects non-`figma.com` hosts, extracts the file key from
`/file|design|proto/`, reads `node-id`, and **normalises dash → colon**
(`nodeParam.replace(/-/g, ":")`). The `&t=<share token>` is simply never read. The existing
dedup comment at `chat.ts:799-805` already depends on exactly this behaviour. Emitted
attributes use the colon form (`data-figma-id="5678:118877"`, verified), so `parsed.nodeId`
compares directly. **Do not write a second parser.**

### (h) Latency asymmetry (app telemetry, 235 real turns)

`~/Library/Application Support/arcade-studio/generation-metrics.jsonl`: deterministic import
16–26s · edit p50 32s · build p50 98s · tiny-output turns ~5–12s. **This is why the cascade
is cheapest-first**, and with L4 cut both shipping layers are effectively free (L3 is pure
regex; L2 is N small file reads, §2.5).

---

## 2. LAYER 2 — PROVENANCE

**New module:** `studio/server/figma/provenance.ts` — pure logic plus an **injected**
frame-source accessor. No `node:fs` import, no `server/paths` import, no Studio path.

### 2.1 The question

> Is the pasted node ALREADY present in a frame this project has rendered?

If yes, this turn is an **EDIT of that frame**, and we know the frame by name. That is corpus
#1 exactly: it pasted `node-id=5678-118877`, which frame `01-figma-5678-118876` already
contains. No language understanding, no model call, no keyword.

### 2.2 The injected accessor — this is what makes it host-agnostic

```ts
/** One rendered frame, as the HOST can see it. `slug` is whatever the host calls
 *  the frame; `source` is the rendered file's text. Nothing Studio-specific. */
export interface FrameSource {
  slug: string;
  source: string;
  /** Optional: the Figma node this frame was imported from, when the host knows it
   *  independently of the source text (Studio: the frame slug / LIFT.json). */
  importedFromNodeId?: string;
}

/** The host supplies the frames. Studio reads them off disk; a Claude-Code host
 *  hands over files it already has in context. That is the entire contract. */
export type FrameSourceReader = () => Promise<FrameSource[]>;
```

Two lines to implement. Studio's binding lives in the middleware (§5.2) and is the ONLY place
a Studio path appears in this feature.

### 2.3 Matching — three sources, in priority order, stopping at the first that hits

Verification (b) proved one grep is not enough.

1. **Attribute-exact `data-figma-id`.** Build the matcher from the normalised node id and
   require attribute equality, not substring:
   `new RegExp('data-figma-id="' + escapeRegExp(nodeId) + '"')`.
   This is what rejects the nested-instance form: `data-figma-id="I5678:118877;5346:75923"`
   does not match `data-figma-id="5678:118877"`. A substring search would false-positive on
   all 5 nested ids in the live frame. → kind `"exact"`.
2. **Nested-instance containment**, only if (1) found nothing. A node pasted from inside an
   instance has id `I<host>;<inner>`. Match the prefix `data-figma-id="I<nodeId>;` to find
   the frame containing the *host* instance. → kind `"nested"`, so callers know this is
   containment, not identity.
3. **Host-declared import origin.** `importedFromNodeId`, plus the frame-slug form
   `figma-<nodeId with non-alnum → '-'>` lowercased. This is what catches the frame's own
   ROOT node, which verification (b) proved is absent from `index.tsx`. Re-pasting the
   original URL is a completely ordinary designer move; without this source, provenance
   misses it entirely. → kind `"origin"`.

**The slug transform lives in a zero-import LEAF: `server/figma/frameSlug.ts`.** Both
`kitEmitBranch` (the writer) and `provenance` (the reader) import it, so there is exactly one
copy — the drift discipline `src/lib/scopedEdit.ts` exists to enforce — with no transitive
coupling.

> **CORRECTION (revision 4).** An earlier draft of this section said "export
> `frameNameFromNode` from `server/figma/kitEmitBranch.ts:139-141` and reuse it". Following
> that instruction literally re-couples the brain to Studio *transitively*: built as
> specified, `provenance.ts`'s value-import closure is 20 files and reaches `server/paths.ts`
> (`os.homedir()` + the hardcoded `~/Library/Application Support/arcade-studio`),
> `server/figmaCli.ts` (`node:child_process`), `server/figmaIngest.ts` and
> `server/claudeBin.ts`. Measured: the per-file source guard reported all five needles
> "absent" — green — and the module then failed to load in plain Node with
> `Cannot find module '.../server/paths' imported from .../kitEmitBranch.ts`. That is the
> `import-hook-dead-in-dmg` shape one level up.
>
> **General rule, and it overrides "reuse the existing helper" every time: a brain module may
> only import other brain modules.** When the helper you need lives in a Studio-coupled
> module, move the helper to a leaf; do not import the module.
>
> The same rule forced a second extraction — see the note in §5.2 about `parseFigmaUrl`.

### 2.4 It MUST refuse to guess

Naming the WRONG frame is worse than naming none: the generator would confidently edit a
frame the designer wasn't talking about, and the designer's next turn would be a second
correction about a third frame. So:

- **0 matches** → `{ kind: "none" }`. Cascade continues to L3. **Never invent a target.**
- **exactly 1 match** → `{ kind: "exact" | "nested" | "origin", frameSlug, via }`. The only
  case that names a frame.
- **2+ matches** → `{ kind: "ambiguous", candidates: string[], via }`. **Does NOT set
  `frameSlug`.** The turn still leaves the importer (it is provably an edit of *something* we
  already rendered), but no frame name reaches the generator — it gets the candidate list as
  context in the prompt region instead, and picks. That is the honest handling: we know it is
  an edit, we do not know of what.

**`origin` NAMES a frame but does NOT divert (revision 3, found by the tests).** A match
on source 3 means "the designer re-pasted the URL this frame was built from", which is
exactly what a plain RE-IMPORT looks like — corpus #0 is the verbatim
`"Implement this precisely: <url>"` pointing at the root node of `01-figma-5678-118876`.
Measured across the 13 corpus Figma prompts, `origin` fires on #0 and #2 only, and is the
sole escape route for **neither** (#2 leaves via interaction intent + a constraint). So
diverting on it would break the deterministic fast path — the product's speed advantage,
and hard constraint 4 — to fix nothing. Only `exact` and `nested` divert; `origin`'s
frame name is still worth carrying, so a turn that routes to the generator for some
*other* reason can be told "this node already came in as `<slug>`".

### 2.5 Signature and cost

```ts
export type ProvenanceMatchKind = "none" | "exact" | "nested" | "origin" | "ambiguous";

export interface ProvenanceResult {
  kind: ProvenanceMatchKind;
  /** Set ONLY for exact | nested | origin. NEVER set for none | ambiguous. */
  frameSlug?: string;
  /** Set only for ambiguous. */
  candidates?: string[];
  /** Which source matched. REQUIRED, because the router treats them differently:
   *  only exact|nested divert a turn off the importer. See the `origin` note in
   *  §2.4 and the revision-3 header. */
  via?: "exact" | "nested" | "origin";
}

/** A pasted node. Bare string = back-compatible; the object form scopes to a file. */
export type NodeRef = string | { nodeId: string; fileKey?: string };

export async function locateNodeProvenance(
  nodes: NodeRef[],               // colon form, from parseFigmaUrl — all URLs in the prompt
  readFrames: FrameSourceReader,  // injected — no Studio path in this module
): Promise<ProvenanceResult>;
```

**PRIORITY BEATS PASTE ORDER (revision 4).** Check the strongest source across ALL pasted
nodes before falling to the next: `settle("exact", refs.flatMap(matchExact)) ?? settle("nested", …) ?? settle("origin", …)`.
The first cut had nodes in the OUTER loop and sources inner, so the FIRST pasted URL settled
the result even when a later one matched more strongly — and combined with "`origin` never
diverts" (§2.4), a weak `origin` hit on URL#1 shadowed a divertible `exact` hit on URL#2 and
the whole turn fell back to the importer. Measured: `locateNodeProvenance(["36:7860","36:7861"])`
returned `via:"origin"` while the SAME two ids reversed returned `via:"exact"`. Whether the
motivating bug got fixed depended on the order the designer happened to paste two links.
`settle` de-duplicates slugs per source, so one frame matching two pasted ids stays one hit
rather than becoming spuriously `ambiguous`.

**FILE SCOPING (revision 4).** Figma node ids are only unique WITHIN a file, and multi-file
projects are real, not hypothetical: `polina-s-prototype` on disk references
`EAo4gdFvjvzXnmL8hX6Ctc` and `JztJjqt3i6uFwB6r4dfewz`, and the 13 corpus Figma prompts span
three files. So `FrameSource` gains an optional `fileKey` and `NodeRef` allows one; a match is
rejected only when BOTH sides know their key and the keys differ. **Optional on both sides is
deliberate — the key FILTERS, it is never REQUIRED**, so a host that cannot say which file a
frame came from (an LLM-authored frame, a Claude Code host handing over loose files) keeps
today's behaviour rather than losing provenance entirely. Studio can read it from the frame's
`LIFT.json` `intentSummary` URL (verified present) or from the asset filenames.

**A CHILD-NODE HIT MEANS "EDIT THE PARENT" — decided, not assumed (revision 4).** The importer
stamps an attribute on every emitted node (25 in the live frame 01), so pasting a child of an
already-imported frame is an `exact` hit and diverts to an edit of that frame. The competing
reading, "import this sub-component as its own frame", is also a real designer move; the
choice is made on what each mistake costs. A wrong edit is visible, lands in a NAMED frame,
and one follow-up turn undoes it. The status quo silently stamps a duplicate frame and
discards every word the designer typed — which is precisely how corpus #30/#31 played out
live. The designer also has an unambiguous escape from the branch we chose (import the
sub-component in a new project; provenance is per-project) and none from the other.

**`nested` IS DEFENSIVE-ONLY, and the spec should say so (revision 4).** Measured across every
live importer-produced frame, the set of ids reachable ONLY via containment is EMPTY — the
importer emits a plain attribute for each nested host too, so `matchExact` always settles
first, and pasting the nested id itself is an exact match. Running the cascade with sources
`[exact]` vs `[exact, nested]` gives identical kind-flips (#1, #30 both times). It is kept for
hand-edited or future emitter output; it is NOT evidence that a third source pays for itself.

Cost: reading N frame files + N attribute regex tests. On the live 3-frame project that is
~19KB and sub-10ms. **Bound it** so a 30-frame project doesn't pay unboundedly on every
non-bare Figma turn: skip sources over 1MB.

**A FRAME IS NOT ALWAYS ONE FILE (revision 4).** The wire branch writes the overlay design as
a sibling `Overlay.tsx` in the same frame dir through the same stamping emitter
(`chat.ts:1722` passes `entryFileName`), and 11 non-index `.tsx` files exist inside live frame
dirs today. So the host reader should enumerate every `*.tsx` in a frame dir and emit one
`FrameSource` per file with `slug` set to the FRAME slug; `settle`'s de-duplication then
collapses them to one candidate instead of calling the frame ambiguous with itself.
Enumeration is the host reader's job; the pure layer iterates what it is handed.

**A provenance failure must never fail a turn.** If `readFrames()` rejects, treat it as
`kind: "none"` and continue. The caller has no `try` block; the module swallows.

### 2.6 Measured effect (the reason this layer ships)

Simulating the L2+L3 cascade over the corpus with the *verified* provenance world
(`5678:118877` → `01-figma-5678-118876`):

```
#1  today=kit-emit → new=claude   by=provenance  target=01-figma-5678-118876   <<< FIXED
#30 today=kit-emit → new=claude   by=constraints c=single-frame                <<< FIXED
#0 #25 #32 #37 #45 #53   unchanged (kit-emit)
#2 #3 #15 #22 #23         unchanged (claude); #2 additionally gains c=single-frame
```

and over the 30 committed must-stay-deterministic strings from
`__tests__/lib/figmaUrl.test.ts`, each appended to a Figma URL:

```
CHANGED = 1 :  "keep everything on a single frame"  → claude, by=constraints
```

That single flip is **correct detection** — that string *is* a single-frame constraint — and
is accepted as a boundary case with an explicit test in §7. Everything else is untouched.
**2 fixes, 1 intentional flip, 0 accidental regressions.**

---

## 3. LAYER 3 — CONSTRAINTS

**New module:** `studio/server/figma/turnConstraints.ts` — pure, host-agnostic, no I/O.

### 3.1 Why a keyword list is legitimate HERE and banned for corrections

A correction is a **speech act**: the same complaint can be phrased with no shared vocabulary
at all ("There's no difference", "revert that change", "repair the broken frame"). Keywords
measured 27% recall on it, and the detector was removed.

A single-frame constraint is a different kind of thing: a **named, closed requirement** that
designers state literally, and usually emphatically, because they are pre-empting a specific
failure. Verified across all 67 corpus prompts, every statement of it is literal:

```
#2  "don't separate these screens onto multiple frames, the transition must happen within this single frame"
#30 "DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!"
#39 "…it should open as a tab in the main frame "Tabbed Canvas Prototype""
```

The distinction is not a loophole; it is the actual reason the mechanisms differ. A future
reviewer should hold this list to the same standard: it may only contain patterns that state
the requirement, never patterns that infer a mood.

### 3.2 Vocabulary

```ts
/** A negator BEFORE a positive statement, same sentence, bounded span. */
const NOT_NEGATED = String.raw`(?<!\b(?:don'?t|do\s+not|does\s+not|doesn'?t|never|not|no)\b[^.!?]{0,24})`;

const SINGLE_FRAME_PATTERNS: RegExp[] = [
  // Already negation-shaped — the negation is what makes them the ask — so no anchor.
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+frame/i,
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+(?:these|those|the)?\s*screens?/i,
  // Positive statements — every one carries the anchor.
  new RegExp(`${NOT_NEGATED}\\b(?:within|in|on)\\s+(?:this|the|one|a)\\s+single\\s+frame\\b`, "i"),
  new RegExp(`${NOT_NEGATED}\\bkeep\\s+(?:it|this|everything|them|both|all)\\b[^.!?]{0,30}\\b(?:one|single|same)\\s+frame\\b`, "i"),
  new RegExp(`${NOT_NEGATED}\\bas\\s+a\\s+(?:new\\s+)?tab\\b[^.!?]{0,60}\\bmain\\s+frame\\b`, "i"),
];
```

Every span is `[^.!?]`-bounded so it cannot bridge sentences — the same discipline the
interaction patterns learned the hard way (see the `[^.\n]*` comment in
`src/lib/figmaUrl.ts`).

**Measured over all 67 corpus prompts: fires on exactly #2, #30, #39. Nothing else.** #39 has
no Figma URL, so it reaches the generator today anyway and simply gains the directive.

> **CORRECTION (revision 4) — a bare noun phrase was DELETED, and this is the most important
> correction in the document.** The list originally also contained
> `/\b(?:same|one|single)\s+frame\b/i`, which **states nothing**: it spots two words. Measured
> end-to-end through the shipped detector, it fired on 8 of 8 prompts asking for the
> OPPOSITE — "one frame per step", "one frame per screen", "Make each state its own frame,
> one frame each", "not the same frame as the form", "Don't keep this in one frame". Each then
> received the maximally forceful directive in §3.4 ("This overrides every other instruction
> about frames", "Do NOT create a new frame directory"), i.e. a **hard override of what the
> designer had just typed**.
>
> **Inverting an instruction is strictly worse than missing one**: the generator obeys it,
> confidently, and the designer cannot see why. Note how narrow the old test guard was — the
> near-miss `"split this into separate frames"` passed only because it omits the words "one
> frame". One adverbial phrase wide.
>
> Measured effect of deleting it: the corpus fire set is EXACTLY unchanged, `[2, 30, 39]` (it
> was the sole match for no corpus prompt — #2 also matches two other patterns), every
> must-fire string in `turnConstraints.test.ts` still fires, and the inversion false positives
> drop from 8/8 to 0/8 once the surviving positive patterns carry `NOT_NEGATED`. The 8
> inversion strings and 6 negated forms are now committed must-NOT-fire lists, so a future
> re-widening has to argue with them.
>
> This is the standard the module's own doc comment sets — "it may only contain patterns that
> STATE the requirement, never patterns that INFER a mood" — and the first cut violated it.

`"keep everything on a single frame"` (a committed must-miss string for a DIFFERENT detector)
still fires, via the `keep …` pattern. That is **correct as detection** — the designer did
state a single-frame constraint — and §2.6 records it as the one intentional routing flip. Do
NOT "fix" it by narrowing; it is pinned with a test.

**Apostrophes are the ONLY normalisation, deliberately.** macOS smart quotes produce U+2019
and 5 corpus prompts contain one (#39 among them), so `don'?t` alone is curly-quote-blind and
the identical sentence would route differently depending on a keyboard setting. But a draft
that also stripped "non-word" characters would delete Cyrillic and Slovenian wholesale — a
designer writing `"не разделяй эти экраны — keep everything on a single frame"` would have had
half the sentence erased before matching. **We may fail to UNDERSTAND non-Latin prose; we must
never MANGLE it.** Tested with Russian and Slovenian input.

### 3.3 The scope guard (this is hard constraint 2, and it has shipped as a bug before)

`classifyFigmaTurn` returns `"claude"` for **every** prompt with no Figma URL
(`turnRouting.ts:81`). A gate written as `figmaKind === "claude" && hasSingleFrameConstraint`
therefore also fires on ordinary non-Figma prompts. That exact mistake already shipped a
directive telling a designer *"Do NOT create a new frame directory"* in response to
`"New screen: an error state with a Try again button"`.

**Rule: every new gate is scoped to `hasFigmaNode === true`.** In the cascade (§4) this is
structural — the `!hasFigmaNode` branch returns before constraints are ever consulted. 54 of
the 67 corpus prompts have no Figma URL, so this is the majority path, not an edge case, and
§7 tests it explicitly.

> **THE PRICE OF THAT GUARD, stated plainly (revision 4).** #39 — cited three paragraphs above
> as evidence for the pattern list — has **no Figma URL**, so the cascade never sees its
> constraint: `detectTurnConstraints(#39)` returns `["single-frame"]` but
> `planFigmaTurn(#39)` returns `decidedBy:"no-node", constraints:[]`. **#39 is fixed ONLY by
> the §6 template edit, not by routing.** Of the 54 no-URL corpus prompts it is the only one
> that states a constraint, so the guard costs exactly one prompt — and that is the right
> trade, because the alternative is the directive that already shipped at a designer who typed
> "New screen: an error state with a Try again button". Do not read the fire-set `[2, 30, 39]`
> as three routing fixes; it is two.

### 3.4 The directive text

```
<single_frame_constraint>
The designer explicitly asked for this to stay in ONE frame. This overrides every other
instruction about frames, including the flow-splitting and <FrameLink> rules in CLAUDE.md.

- Do NOT create a new frame directory. Do NOT add a second frame for the second state,
  screen, or step — even when the request describes a transition between two screens.
- Build every referenced state INSIDE the existing frame, switched by React state
  (useState + conditional render / CSS transition). A click that "goes to" another screen
  is an in-frame state change here, NOT a <FrameLink>.
- Do NOT use <FrameLink> on this turn.
- If you genuinely cannot fit it in one frame, say so under ### Deviations and still do not
  create the second frame.
</single_frame_constraint>
```

### 3.5 Where it attaches

In the **prompt region**, not `CLAUDE.md` — prompt text is obeyed harder than the project
file, which is the whole reason `server/editContext.ts` exists.

> **CORRECTED ATTACH POINT (revision 4) — the original was unreachable on a digest MISS.** This
> section used to say "appended to the `blocks` array inside `enrichPromptWithFigmaContext`,
> right after `chat.ts:855`". But **`chat.ts:854` is `if (!blocks.length) return { prompt, images };`** —
> an early return that fires whenever every Figma reference missed its digest, i.e. the real
> cold-file / over-budget case the surrounding code has a whole comment block about
> (`digestRaceBudgetMs`, FAST=15s / HIFI=65s). On a miss, `resolveFigmaReference` only produces
> a block when `explicitHiFi` is true (`chat.ts:914`) — and **measured `detectHiFiIntent`:
> #1 false, #2 false, #30 false, #39 false. Every prompt this design fixes takes the swallowing
> branch.** Verified by calling the real function with the ingest mocked to a total miss: corpus
> #30's verbatim wording came back with `prompt` BYTE-IDENTICAL to the input, 213 chars in, 213
> out. The control confirms the return is conditional, not universal:
> "Implement this precisely: <url>" on the same miss path DOES get a block.
>
> §5.3 made it strictly worse: widening `suppressHiFiDirective` to include the single-frame
> constraint means the miss branch returns `null` even on an explicit-hi-fi turn, so
> `"Implement this precisely, but keep it in the same frame: <url>"` would lose the
> `<high_fidelity_mode>` directive it gets today AND never gain the new one — worse than before
> the fix.
>
> **Correct attach point: build the directives FIRST, OUTSIDE the `!blocks.length` guard, and
> return `prompt + directives` when `blocks` is empty but a directive exists.** The directive is
> derived from the plan alone and needs no digest — exactly like `explicitHiFi` at `chat.ts:791`,
> whose comment already says *"Directive decision is CONTEXT-FREE… This is the fix for the
> 'agent gets a naked prompt with no faithfulness directive on a slow/failed Figma fetch' bug"*.
> Same bug, same fix, one layer along. **§7's middleware tests MUST exercise the digest-MISS
> path** — the original plan tested only the hit path plus a no-URL case, so this defect passed
> every test in the plan.

Ordering within the assembled prompt: **after** the `<figma_context>` blocks and after any
`<edit_reference_designs>`, so the constraint is the last word before the model starts.

It must also **suppress the whole-frame hi-fi directive** via the existing
`suppressHiFiDirective` flag — see §5.3, and verification (d) for why that is mandatory
rather than tidy.

> **AND THE DIRECTIVE ASSEMBLY ITSELF MUST NOT LIVE IN `chat.ts` (revision 4).** Measured,
> `chat.ts`'s value-import closure is 61 modules, reaching `server/paths.ts`, `claudeBin.ts`,
> `awsPreflight.ts` (`child_process`), `devrev/computerAgent.ts` and `figma/systemSynth.ts`. So
> the routing layer is portable but *the thing that turns a plan into words the model reads* is
> not — and a Claude-Code host would get a correct plan for #30, the live failure this branch
> exists for, with no way to act on it. **Add a pure `buildTurnDirectives(plan): string[]` (owning
> the directive set AND its order) and a pure `shouldSuppressWholeFrame(plan, prompt): boolean`
> to a BRAIN module.** `chat.ts` then only appends the returned strings and passes the boolean
> into `suppressHiFiDirective`. Both are pure string work with no reason to live in Vite
> middleware. Note `buildSingleFrameDirective` currently has zero non-test callers — this is
> the wiring that gives it one.

### 3.6 AS SHIPPED (revision 5) — `server/figma/turnDirectives.ts`

The brain module revision 4 asked for, plus the two things it turned out to need.

```ts
// BRAIN. Imports only ./turnConstraints and a TYPE from ./turnRouting.
export function buildTurnDirectives(plan?: FigmaTurnPlan | null): string[];
export function shouldSuppressWholeFrame(
  plan: FigmaTurnPlan | null | undefined,
  ctx: { explicitHiFi: boolean },
): boolean;
```

**`buildTurnDirectives` returns, in this order:** `<target_frame>` (from `plan.targetFrame`,
or the candidates form from `plan.frameCandidates`), then `<single_frame_constraint>`. The
constraint is LAST because it opens with *"This overrides every other instruction about
frames"* and needs to be the final thing the model reads.

**It returns `[]` for three cases, each for a stated reason:**

| case | why |
|---|---|
| `plan` absent | corrective re-runs (visual-noop, render-verify) and the wire branch's inner wiring pass carry no Figma URL of their own. `[]` ⇒ byte-identical to before this feature |
| `kind === "kit-emit"` | the deterministic importer runs **no model** — there is nothing to read a directive. The cascade never hands it a constraint anyway (§4 step 8) |
| `kind === "wire"` | the wire branch satisfies single-frame **structurally** (§4 step 4). A directive forbidding a second frame nobody was going to create would contradict the two-file `index.tsx` + `Overlay.tsx` structure the wiring pass depends on |

**`ctx.explicitHiFi` is passed IN, not derived.** `detectHiFiIntent` lives in
`fidelityDirective.ts` next to 250 lines of directive text that names the `figmanage` CLI — a
binary no foreign host has. Keeping it out preserves the brain closure; `chat.ts` already
computes the value at line 791 to pick the digest-race budget.

**The new `<target_frame>` directive** (revision 5, item 3) says the turn edits a named frame,
that the node was matched on the `data-figma-id` attribute rather than inferred from wording,
and to make the smallest change. The ambiguous form lists the candidates and says *"If you
genuinely cannot tell which frame is meant, say so and ask — do not guess and rebuild"*:
naming the wrong frame is worse than naming none, because the generator edits it without
hesitating and the designer's next turn is a second correction about a third frame.

---

## 4. THE CASCADE — `planFigmaTurn`

`classifyFigmaTurn` has no I/O today and **keeps none**. It stays exported and unchanged for
its existing call sites and tests. Add an async sibling in the same module:

```ts
export type TurnConstraint = "single-frame";

export interface FigmaTurnPlan {
  kind: "kit-emit" | "wire" | "claude";
  /** Set only when provenance NAMED a frame. Never guessed, never set on ambiguous. */
  targetFrame?: string;
  /** Set only when provenance was ambiguous — context for the prompt region. */
  frameCandidates?: string[];
  constraints: TurnConstraint[];
  /** Which layer settled it. Narration, telemetry, and debugging. */
  decidedBy: "no-node" | "scoped-edit" | "legacy-intent" | "provenance"
           | "constraints" | "default";
}

export async function planFigmaTurn(
  inp: FigmaTurnInputs & { nodeIds: string[] },
  deps?: { readFrames?: FrameSourceReader },
): Promise<FigmaTurnPlan>;
```

Order inside, short-circuiting cheapest-first:

```
1. !inp.hasFigmaNode          → { kind:"claude", decidedBy:"no-node", constraints:[] }
                                 ← unchanged from turnRouting.ts:81. THE SCOPE GUARD (§3.3):
                                   constraints are never even computed here.
2. isScopedEditTurn(prompt)   → { kind:"claude", decidedBy:"scoped-edit", constraints:[] }
                                 ← unchanged from turnRouting.ts:86. A right-click edit is
                                   already an edit; a frame directive on top would
                                   double-instruct. deps are NOT consulted.
3. constraints := detectTurnConstraints(prompt)        // pure, 0ms, computed once here
4. hasInteractionIntent && figmaUrlCount >= 2
                              → { kind:"wire", decidedBy:"legacy-intent", constraints }
                                 ← preserved verbatim from turnRouting.ts:88.
                                   A wire turn CARRYING single-frame is not a
                                   contradiction (revision 4): the branch imports
                                   URL#2 into the SAME frame dir as a sibling
                                   Overlay.tsx (chat.ts:1722 entryFileName) and its
                                   wiring prompt already says "Do NOT create a new
                                   frame. Do NOT move the overlay into its own
                                   frame." (chat.ts:1782). The constraint is
                                   satisfied BY CONSTRUCTION here, needs no
                                   directive, and rides along for narration only.
                                   No corpus prompt takes this exit with one.
5. inp.wantsGeneration        → { kind:"claude", decidedBy:"legacy-intent", constraints }
                                 ← today's build-intent path (turnRouting.ts:89-90 inverted).
                                   #2 #3 #15 #22 #23 exit here, now carrying constraints.
   ── everything below is reached ONLY where today's router says "kit-emit" ──
6. deps?.readFrames present → L2 locateNodeProvenance(nodeIds, readFrames)
     via exact | nested      → { kind:"claude", targetFrame, decidedBy:"provenance", constraints }
                                 ← #1 exits here (node 5678:118877 is DRAWN INSIDE
                                   01-figma-5678-118876)
     ambiguous via exact|nested
                             → { kind:"claude", frameCandidates, decidedBy:"provenance", constraints }
     via origin              → continue. DOES NOT DIVERT — a re-pasted root URL is a
                                 plain re-import (#0). See §2.4.
     none                    → continue
7. constraints.length         → { kind:"claude", decidedBy:"constraints", constraints }
                                 ← #30 exits here
8. otherwise                  → { kind:"kit-emit", decidedBy:"default", constraints:[] }
                                 ← THE FAST PATH, unchanged. #0 #25 #32 #37 #45 #53 exit here.
                                   This is where a future L4 resolver would plug in — and the
                                   only place it could, which is the point.
```

Steps 1–5 reproduce today's three-way decision exactly, and 6–8 only subdivide the branch
today unconditionally calls `kit-emit`, so **no currently-working turn changes shape.**

Note `kind: "kit-emit"` at step 8 always carries `constraints: []`. A constraint and the
importer are mutually exclusive by construction — the importer cannot honour a constraint,
which is the entire bug — so the type never lets a caller receive one it will drop.

---

## 5. WIRING

The routing decision stays **pure and host-agnostic**. Studio's binding lives in the
middleware and nowhere else.

### 5.1 `turnRouting.ts`

Gains `planFigmaTurn` (§4) and imports the two pure modules plus the `FrameSourceReader`
*type*. It must not import `node:fs`, `server/paths`, `node:child_process`, or read
`process.env`. §7's static guard enforces this mechanically.

### 5.2 `chat.ts` — the only place Studio paths appear

At the existing routing block (`chat.ts:322-330`), replace the `classifyFigmaTurn` call:

```ts
const plan = await planFigmaTurn(
  {
    hasFigmaNode: Boolean(figmaParsed),
    wantsGeneration: figmaParsed ? shouldGenerateFromFigma(prompt) : false,
    hasInteractionIntent: detectInteractionIntent(prompt),
    figmaUrlCount: figmaUrls.length,
    prompt,
    // Pass {fileKey, nodeId} pairs, not bare ids — node ids collide across files (§2.5).
    nodeIds: figmaUrls
      .map((u) => parseFigmaUrl(u))
      .filter(Boolean)
      .map((p) => ({ nodeId: p!.nodeId, fileKey: p!.fileId })),
  },
  { readFrames: makeStudioFrameReader(slug, project.frames ?? []) },  // ← the ONE Studio binding
);
const isKitEmitTurn = plan.kind === "kit-emit";
const isWireTurn    = plan.kind === "wire";
```

`handleStart` is already `async` (`chat.ts:213`), so awaiting is free. **Ordering hazard:**
the Bedrock preflight at `chat.ts:337` keys off `isKitEmitTurn`, so `plan` must be computed
before it. It already is, but a reviewer should check this explicitly — getting it backwards
would run a Bedrock check for a turn that needs no model, or skip one for a turn that does.

`makeStudioFrameReader(slug, frames)` — new, in
`studio/server/figma/adapters/studioFrameReader.ts`. Uses `frameDir()` from
`server/paths.ts`, **enumerates every `*.tsx` in each frame dir** (not just `index.tsx` — the
wire branch writes `Overlay.tsx` into the same dir, §2.5) emitting one `FrameSource` per file
with `slug` set to the FRAME slug, skips unreadable files and files over 1MB, and sets
`importedFromNodeId` + `fileKey` where the slug / `LIFT.json` encode them. **It is the only
Studio filesystem path in the whole feature.**

> **AS SHIPPED (revision 5) — four details the ~15-line estimate did not account for.** It came
> in around 100 lines, all of it failure handling that a stub reader cannot have:
>
> 1. **`fileKey` comes from `LIFT.json#intentSummary`.** Verified on the live frame
>    `01-figma-5678-118876`: `intentSummary` is the verbatim creating prompt,
>    `"Implement this precisely: https://www.figma.com/design/ssUerkBL5uOm7tNyHoZVtc/…"`, so the
>    file key is recoverable with one regex. Read once per FRAME, not per file. A frame with no
>    `LIFT.json` (any LLM-written frame) yields `undefined`, which provenance reads as "unknown"
>    rather than "mismatch" — so such a frame keeps today's behaviour instead of losing
>    provenance. Pinned both ways by test.
> 2. **`importedFromNodeId` is round-tripped through `slugMatchesNode`, not trusted.** The
>    digit-grouping in a slug is ambiguous in principle (`figma-5678-118-876` parses three ways),
>    so the reader only returns an id the SHARED transform confirms regenerates that exact slug.
> 3. **It reads the project RECORD's frame list, not the frames dir.** Deliberate: the record is
>    what the rest of the turn reasons about, and a reader that disagreed with it would name a
>    frame the agent's other context never mentions.
> 4. **It can never reject.** `frameDir()` THROWS on a malformed slug, and a rejecting reader is
>    treated by `locateNodeProvenance` as "no signal" for the WHOLE project — so one bad slug
>    would silently disable provenance for every other frame. Every read is individually caught.
>    Tested with `{ slug: "../../../etc" }` alongside a good frame.

> **`parseFigmaUrl` HAD TO MOVE (revision 4).** The call above is the routing layer's INPUT
> CONTRACT — no host can call `planFigmaTurn` without producing `nodeIds` — and
> `parseFigmaUrl` used to live only in `server/figmaCli.ts`, whose first line is
> `import { spawn } from "node:child_process"` and which has 3 spawn sites driving the
> `figmanage` binary. That is a module §5.5's own guard lists as FORBIDDEN for the brain, so
> the contract required of every foreign host exactly the coupling the brain refused to
> accept. Measured: a Claude-Code host implementing §5.2 verbatim works, but has loaded
> `node:child_process` plus `runFigmanage`/`figmaLoginWithPat`/`exportNodeImageUrls`.
>
> The pure 10 lines now live in the zero-import leaf `server/figma/figmaNodeUrl.ts`, and
> `figmaCli.ts` re-exports them so `chat.ts` and `middleware/figma.ts` are untouched. §7's
> guard is pointed at the HOST GLUE as well as the brain — `figmaNodeUrl.ts`,
> `generationIntent.ts`, `src/lib/figmaUrl.ts` — so the seam's own cost is measured rather
> than assumed. All three are clean; the whole brain-plus-glue closure is **9** files, asserted
> by name (this sentence said 8 until revision 7 — it was written before `turnDirectives.ts`
> existed, and §7's `toEqual` list is the authority).

### 5.3 `enrichPromptWithFigmaContext` — widen the REAL seam

Thread the WHOLE PLAN through — one parameter, not three fields. AS SHIPPED
(revision 5), the plan travels `handleStart` → `runClaudeBranch({… figmaPlan})` →
`enrichPromptWithFigmaContext(prompt, images, narrate, figmaPlan)`. `figmaPlan` is optional
on both, so the corrective re-runs (`handleVisualNoOpRetry`, `handleRenderVerifyRetry`) and
the wire branch's inner wiring pass keep calling `runClaudeBranch` unchanged, and
`buildTurnDirectives(undefined) === []` makes their prompts byte-identical.

Inside, the existing suppression (`chat.ts:796`, `const scopedEdit = isScopedEditTurn(prompt);`)
becomes:

```ts
const planDirectives = buildTurnDirectives(figmaPlan);        // BEFORE any ingest — §3.5
const scopedEdit = isScopedEditTurn(prompt);                  // kept as its OWN variable
const suppressWholeFrame =
  scopedEdit || shouldSuppressWholeFrame(figmaPlan, { explicitHiFi });
// ...then pass suppressHiFiDirective: suppressWholeFrame
```

**This is required, not optional.** Verification (d): `shouldUseHiFi`'s novel-design upgrade
fires even with no hi-fi wording, and `buildHiFiDirective` then says *"each section has the
SAME number of rows, same order, as the PNG"* — build a fresh full frame. On a single-frame
or provenance-located edit, that instruction actively causes the bug we are fixing. The
existing flag already covers both the digest-hit (`chat.ts:938`) and digest-miss
(`chat.ts:914`) branches, so widening it is complete — no second flag.

> **CORRECTION (revision 5) — the widening needs an EXPLICIT-HI-FI CARVE-OUT, which the
> pseudo-code above did not have.** Suppressing unconditionally means
> `"Implement this precisely, but keep it in the same frame: <url>"` loses the
> `<high_fidelity_mode>` block it gets today AND gains the constraint. Revision 4 flagged that
> as "strictly worse" for the miss path; it is equally true on the HIT path, where the naive
> widening turns off `chat.ts:938` as well. So `shouldSuppressWholeFrame` returns `false` when
> `detectHiFiIntent(prompt)` is true — the designer asked for precision AND one frame, and they
> get both, because the frame question is settled by the constraint directive, which is appended
> LAST and opens by overriding everything else about frames.
>
> **The carve-out costs nothing, measured:** `detectHiFiIntent` is FALSE for #1, #2, #30 and
> #39, i.e. every prompt this design fixes, so suppression is total for all of them and the
> carve-out fires on zero real prompts. Both halves are pinned by test —
> `does NOT suppress when the designer EXPLICITLY asked for precision` and
> `an EXPLICIT hi-fi turn with a constraint keeps hi-fi AND gains the constraint`.

Keep `scopedEdit` as its own variable for `blocks.push(buildScopedEditReferenceDirective())`
at `chat.ts:855`: that directive is specifically about right-click edits and must NOT start
appearing on typed single-frame turns.

**AS SHIPPED, the attach point (§3.5's corrected one):**

```ts
if (!blocks.length) {                       // digest MISS
  if (!planDirectives.length) return { prompt, images };
  return { prompt: `${prompt}\n\n${planDirectives.join("\n\n")}`, images };
}
if (scopedEdit) blocks.push(buildScopedEditReferenceDirective());
return { prompt: `${prompt}\n\n${[...blocks, ...planDirectives].join("\n\n")}`, images: outImages };
```

Verified by MUTATION, not by reading: reverting that guard to the single-line
`if (!blocks.length) return { prompt, images };` fails **5 of the 10** tests in
`__tests__/server/middleware/chat-single-frame.test.ts`.

### 5.4 Naming the target frame

When `plan.targetFrame` is set, say so in the prompt region. `server/editContext.ts` is
already pure and already the canonical home for "this is an edit" discipline — extend
`buildEditContextBlock(frameSlugs, opts?)` with an optional line:

```
Target frame: <slug> — this turn EDITS that frame. Do NOT create a new frame.
```

When `plan.frameCandidates` is set instead, the honest line is:

```
This node already appears in these frames: <a>, <b>. Edit the right one — do NOT create a new frame.
```

`prependEditContext` already no-ops on scoped edits and on double-injection, so both lines
inherit that.

> **WATCH THE EMPTY-LIST NO-OP (revision 4).** `prependEditContext`'s first line is
> `if (!frameSlugs.length) return prompt;` (`server/editContext.ts:52`), so on a project whose
> frame list has not yet refreshed, a `targetFrame` we worked to determine would be **silently
> dropped**. Task 2 must either pass the target frame independently of `frameSlugs` or assert
> the list is non-empty when a target exists. Do not rely on the existing no-op chain here.

> **AS SHIPPED (revision 5) — `editContext.ts` was NOT extended; the target frame is its own
> directive.** Of the two options revision 4 offered, "pass it independently" is the one taken.
> `<target_frame>` is emitted by `buildTurnDirectives` (§3.6), so it is unconditional on the
> frame list, unconditional on the digest, and — the reason that matters — it lives in a BRAIN
> module rather than in `server/editContext.ts`, which `chat.ts` calls at a different seam
> (`prependEditContext(enriched.prompt + ejectSuffix, frameSlugs)`) that a foreign host has no
> equivalent of. Threading it through `editContext.ts` would have re-introduced exactly the
> "the plan is portable but the words are not" split that §3.6 exists to close. The empty-list
> no-op is now irrelevant rather than worked around.
>
> A second, smaller reason: the two blocks say different things. `<edit_context>` says "this
> project has frames, probably an edit, here they all are". `<target_frame>` says "this specific
> frame, matched on an attribute, not inferred". Merging them would have blurred a filesystem
> fact into a heuristic.

### 5.5 The rule a reviewer can check mechanically

**A brain module may only import other brain modules.** "Reuse the existing helper" never
overrides this — see the revision-4 correction in §2.3.

The check is a TRANSITIVE-CLOSURE walk, not a source grep, and it has four requirements that
are each there because the naive version failed:

1. **Resolve relative imports and compare RESOLVED PATH SUFFIXES** (`server/paths.ts`,
   `server/claudeBin.ts`, `server/figmaCli.ts`, `server/figmaIngest.ts`, `server/projects.ts`,
   `server/figma/kitEmitBranch.ts`) — never the literal string `server/paths`. **That string
   can never match:** every module under `server/` imports it relatively (28 × `from "../paths"`,
   13 × `from "./paths"`, zero occurrences of `server/paths` in non-test source). A guard that
   cannot fail is worse than no guard. Measured on a deliberately-dirty module
   (`import { frameDir } from "../paths"` + a real `readFile`), the substring version reported
   `MISSED: server/paths`, `MISSED: node:child_process`, `MISSED: electron`,
   `MISSED: process.env` — it caught only `node:fs`, and only because that import happened to
   carry the `node:` prefix.
2. **Walk the whole TRANSITIVE closure**, since the real failure mode is a chain (§2.3), and
   report the offending chain so the message is actionable.
3. **Strip comments first.** The first version failed on all four brain modules — every one
   of them DOCUMENTS the prohibition, and a naive grep cannot tell a prohibition from a
   violation. A guard that fires on its own documentation trains people to delete the
   documentation.
4. **Self-test the guard** against a module known to be dirty (`kitEmitBranch.ts` imports
   `node:fs` directly AND reaches `server/paths.ts`), and cover the HOST GLUE (§5.2) as well
   as the brain. Also bound the closure by NAME, not just by size, so growth is a decision.

`__tests__/server/figma/headlessRouting.test.ts` does all four; the spec describes it here
because the spec is what the next implementer copies.

---

## 6. TEMPLATE CHANGE — `studio/templates/CLAUDE.md.tpl`

In scope: generator instructions travel to every host, so this is the highest-leverage brain
surface we have — and for #39 it is the ONLY thing that fixes the complaint (§3.3). Three edits.

> **BUT THE TEMPLATE DOES NOT SHIP TO FOREIGN HOSTS TODAY (revision 4), and an earlier draft of
> this section claimed it did.** Measured: `studio/templates/CLAUDE.md.tpl` is read at exactly
> two sites — `server/projects.ts:110` (`createProject`) and `server/projects.ts:422`
> (`refreshStaleClaudeMd`) — and both write the rendered output into
> `projectDir(slug)/CLAUDE.md` under `~/Library/Application Support/arcade-studio/projects/`.
> **There is no export, publish, or copy-out path.** The root `SKILL.md`, which is what a
> foreign Claude Code session actually loads, has **zero** hits for `FrameLink`,
> `separate frame`, `single frame`, or `flow-shaped`. The rendered file is not portable text
> either: the live rendered `CLAUDE.md` contains 13 absolute `/Users/andrey.sundiev/…` paths,
> from the 10 `{{ARCADE}}` / `{{PROTOTYPER}}` placeholders.
>
> So a designer in their own Claude Code who types corpus #2 gets none of the three edits
> below, because no Studio project was ever created for them.
>
> **Consequence for task 2: the single-frame rule must ALSO be added to the root `SKILL.md`**,
> which is the real foreign-host surface — or a render target that emits a host-relative
> `CLAUDE.md` must exist. Until one of those lands, do not claim the template ships to foreign
> hosts. The template edits below are still worth making (they fix the Studio host, and Studio
> is where the failure was observed), but they are Studio-only distribution.

> **CORRECTION (revision 5) — THE `SKILL.md` REMEDY IS WRONG AND WAS NOT DONE.** The
> *measurement* above stands: the template renders only into a Studio project dir. But
> `SKILL.md` is **not** a second distribution of these rules — it is the **other product** in
> this repo, the Arcade Prototyper skill. Its line 98 reads: *"This skill builds prototypes in
> plain HTML, CSS, and vanilla JavaScript — always. It never produces a React app, a component
> library, TypeScript, or anything with a build step or dependencies… Do not reach for React,
> JSX, npm packages, or a framework."* Line 96: *"Every prototype is a single HTML file."*
>
> That is why it has zero hits for `FrameLink` / `frames/` / `separate frame` — **it has no
> frame model at all**, not because the rule was forgotten. Adding "build the second state
> inside the existing frame with `useState` + conditional render, do not create a new frame
> directory" would be instructions for a product with no frame directories and no React. The
> finding measured a real absence and drew the wrong conclusion from it.
>
> **The real foreign-host surface for this rule is `buildTurnDirectives` (§3.6), which now
> exists.** It is a better answer than the template on its own terms: prompt-region text is
> obeyed harder than a project file (the reason `server/editContext.ts` exists), it needs no
> render step or placeholder resolution, and it travels to every host that calls the cascade
> because it is part of the cascade's own module closure. The template edits below remain
> Studio-only distribution and remain worth making — belt and braces for the host where the
> failure was actually observed.

### Edit 1 — insert after line 549, before the signal list at 551

```markdown
**An explicit in-frame instruction OVERRIDES every signal below.** If the prompt says to
keep things in one frame — "don't separate these screens", "within this single frame",
"DON'T IMPLEMENT THIS AS A SEPARATE FRAME", "as a tab in the main frame" — then do NOT
create a second frame and do NOT use `<FrameLink>`, no matter how strongly the phrasing
matches a signal pattern. Build the second state inside the existing frame, switched by
React state. The designer's explicit instruction is law; these patterns are only a default
for when the prompt is silent. (2026-08-06 designer session: the prompt *"When I click Save,
animate the transition to this screen … IMPORTANT: don't separate these screens onto
multiple frames"* matches the third signal pattern below almost word for word, and the
generator split it into two frames — the one thing the prompt forbade.)
```

### Edit 2 — line 554, disambiguate the offending example

Replace:

```markdown
- "pressing Save goes to the confirmation" — wrap the Save button.
```

with:

```markdown
- "pressing Save goes to the confirmation" — wrap the Save button. But ONLY when the prompt
  has not also asked for one frame: "pressing Save transitions to this screen, all within
  this single frame" is an in-frame state change, not a `<FrameLink>`.
```

### Edit 3 — line 545, close the create-frames-without-asking loophole

Line 545 currently ends `Do NOT ask first — the user has committed to multiple frames.`
Append:

```markdown
 — unless the prompt explicitly asks to stay in one frame, in which case add the new step
inside the existing frame.
```

Without this, "create frames for new steps without asking" still contradicts the constraint
one screenful earlier, and the generator is entitled to follow whichever it reads last.

**Belt and braces, deliberately.** The `<single_frame_constraint>` directive (§3.4) is the
primary mechanism inside Studio because prompt-region text is obeyed harder than `CLAUDE.md`.
But the template is what a designer's *own* Claude Code session loads, where our directive is
never assembled at all.

---

## 7. TEST PLAN

Single file: `cd /Users/andrey.sundiev/arcade-prototyper && pnpm run studio:test <path>`.
Full suite (~90s, from repo root) before commit. **Baseline was 2461 passed / 0 failed — any
failure is ours.**

Files as actually landed — the cascade tests live in their own file rather than extending
`turnRouting.test.ts`, because that file's `inputs()` helper hand-sets `wantsGeneration` and
the cascade tests must DERIVE it from the prompt (hand-setting it would let a test pass while
the real middleware caller disagreed):

**AS SHIPPED, RE-COUNTED 2026-08-06 (revision 7): 2606 passed / 0 failed / 2 skipped.**
Every count below was re-measured by running each file alone, because the earlier figures in
this section were **wrong in a way that mattered** — see the correction under the table.

| file | tests |
|---|---|
| `__tests__/server/figma/planFigmaTurn.test.ts` | 42 |
| `__tests__/server/figma/provenance.test.ts` | 27 |
| `__tests__/server/figma/headlessRouting.test.ts` | 18 |
| `__tests__/server/figma/turnDirectives.test.ts` | 18 |
| `__tests__/server/figma/turnConstraints.test.ts` | 13 |
| `__tests__/server/figma/studioFrameReader.test.ts` | 11 |
| `__tests__/server/middleware/chat-single-frame.test.ts` | 10 |
| `__tests__/templates/claude-md-single-frame.test.ts` | 6 |
| **total** | **145** |

**The arithmetic closes exactly: 2461 baseline + 145 = 2606.** That is the check worth having,
because it proves the new files account for the ENTIRE delta — no pre-existing test was
silently deleted, renamed, or skipped to make room.

> **CORRECTION (revision 7) — the earlier counts in this section were wrong twice over, and
> one of the errors was a contaminated measurement.** This section previously claimed 2581 and
> attributed 22 tests to `provenance.test.ts` and 22 to `planFigmaTurn.test.ts` (actual: 27 and
> 42). Two separate causes, both worth recording:
>
> 1. **Scratch measurement files were left in `__tests__/` and counted by the suite.** Three
>    throwaway probes (`zz-probe1.test.ts`, `zz-probe2.test.ts`, `zz-corpus-measure.test.ts`)
>    were written to measure the corpus during implementation and never removed. They inflated
>    a "verified" full-suite number to **2617**. They are deleted; the clean number is 2606.
>    A suite total is only evidence if the tree is clean when it is taken — an untracked file
>    under `__tests__/` is indistinguishable from a real test to `vitest run`.
> 2. **`it.each(...)` rows were undercounted.** The per-file numbers were counted from `it(`
>    occurrences in the source, but several of these files use table-driven `it.each`, where one
>    source line is N reported tests. Counting source lines instead of running the file is the
>    same class of mistake as reading code instead of executing it, which is what §9 item 7 is
>    about. Every number in the table above came from running that file alone.

**Every task-2 test was MUTATION-VERIFIED, not just observed green** — a test that passes for
the wrong reason proves nothing, and this project has shipped exactly that (jsdom-blind tests
passing while multi-page measurement was broken live). Three mutations, each reverting one part
of the fix:

| mutation | tests that failed |
|---|---|
| revert the digest-miss guard to `if (!blocks.length) return { prompt, images }` | 5 of 10 middleware |
| delete the explicit-hi-fi carve-out in `shouldSuppressWholeFrame` | 2 (1 unit + 1 middleware) |
| disable the `<target_frame>` push in `buildTurnDirectives` | 4 (3 unit + 1 middleware) |

### L2 — `__tests__/server/figma/provenance.test.ts`

- **The real #1 case:** a `FrameSource` fixture whose `source` contains the verbatim line
  `<div data-figma-id="5678:118877" style={{...}}>` → `{ kind:"exact",
  frameSlug:"01-figma-5678-118876" }`.
- **Nested-instance non-match:** a frame containing ONLY
  `data-figma-id="I5678:118877;5346:75923"` must NOT return `exact` for `5678:118877`. Must
  be `nested`. Assert `kind !== "exact"` explicitly — a substring implementation passes a
  naive "found it" assertion and fails only this one.
- **Root-node case:** a frame whose source has no `data-figma-id` for `5678:118876` but whose
  slug is `01-figma-5678-118876` → `{ kind:"origin" }`. This is verification (b) caveat 1 and
  silently misses without source 3.
- **No match:** LLM-written frame source with zero `data-figma-id` → `kind:"none"` and
  `frameSlug` **absent** (assert the property is `undefined`, not `""`).
- **Ambiguity:** the same id in two frames → `kind:"ambiguous"`, `candidates.length === 2`,
  `frameSlug` **undefined**. Assert it refuses to name one.
- **Node-id forms:** a URL with `node-id=5678-118877`, the same with `&t=<token>`, and the
  colon form all resolve to the same match — proves `parseFigmaUrl` normalisation is doing
  the work and no second parser crept in.
- **Reader failure:** `readFrames` rejects → `kind:"none"`, no throw.
- **Bound:** a `FrameSource` with a 2MB `source` is skipped, not scanned.

### L3 — `__tests__/server/figma/turnConstraints.test.ts`

- Fires on corpus `#2`, `#30`, `#39` (verbatim fixture text).
- **Corpus completeness:** iterate all 67 prompts and assert the fire set is exactly
  `[2, 30, 39]`. Characterisation, in the style of the existing
  `detectInteractionIntent — real designer corpus` block: it pins reality so a future
  widening has to look at the diff.
- Fires on `"keep everything on a single frame"` — **asserted as correct detection**, with a
  comment noting that string also lives in a must-miss list for a *different* detector, and
  that its routing flip (§2.6) is the one accepted regression.
- Does NOT fire on: `"implement this precisely"`, a bare URL, `"add a confirmation step"`,
  `"build a 4-step onboarding flow"`, `"split this into separate frames"`.
- **INVERSION (revision 4, mandatory):** does NOT fire on the 8 multi-frame asks that killed the
  bare noun phrase — `"one frame per step"`, `"Split this into separate frames — one frame per
  screen"`, `"Make each state its own frame, one frame each"`, `"Import these as one frame per
  tab"`, `"Two frames please, not one frame"`, `"…not the same frame as the form"`,
  `"This should NOT be in the same frame…"`, `"Don't keep this in one frame — split it out"`.
  These are a committed must-NOT-fire list so a future re-widening has to argue with them.
- **NEGATED forms (revision 4):** does NOT fire on `"do not keep it in the same frame"`,
  `"never keep this on one frame"`, `"don't put it within this single frame"`,
  `"don’t keep everything on a single frame"` (curly), `"not in the same frame"`,
  `"don't do it as a tab in the main frame"`.
- **Curly apostrophes:** `"don’t separate these screens onto multiple frames"` fires, and so
  does the ASCII twin. Without this the same sentence routes differently depending on a
  keyboard setting.
- **NON-LATIN SURVIVES (revision 4):** a Russian and a Slovenian sentence with an English
  constraint clause both fire, and a non-Latin sentence stating no constraint stays inert. A
  normalisation that strips non-word characters would erase these rather than fail to
  understand them.
- Directive text contains `Do NOT use <FrameLink>` and `Do NOT create a new frame`.

### Cascade — `__tests__/server/figma/planFigmaTurn.test.ts` (new file, not an extension)

- **The 2 prompts this design fixes reach the model:** `#1` → `kind:"claude"`,
  `decidedBy:"provenance"`, `targetFrame:"01-figma-5678-118876"` (with a stub reader holding
  the verified fixture); `#30` → `kind:"claude"`, `decidedBy:"constraints"`,
  `constraints:["single-frame"]`.
- **The 2 this design does NOT fix stay on the importer, asserted honestly:** `#25` and `#32`
  → `kind:"kit-emit"`, `decidedBy:"default"`. Comment that this is the L1/L4 gap from §0 and
  §9 item 1, recorded rather than hidden, so the next person meets the remaining bug in a
  test instead of in a session.
- **The bare ones stay deterministic:** `#0 #37 #45 #53` → `kit-emit`, `decidedBy:"default"`.
- **A prompt with NO Figma URL is unaffected:** `"New screen: an error state with a Try again
  button"` → `kind:"claude"`, `decidedBy:"no-node"`, `constraints` empty. Also the
  adversarial version — `"Add the confirmation step, keep everything on a single frame"` with
  no URL → `decidedBy:"no-node"`, `constraints` **empty**, and assert the injected
  `readFrames` spy was **never called**. This is hard constraint 2, the exact bug that
  already shipped once.
- **Scoped edit still wins:** `SCOPED_EDIT_MARKER` + 2 Figma URLs → `claude`,
  `decidedBy:"scoped-edit"`, `readFrames` spy never called.
- **Wire behaviour unchanged:** interaction intent + 2 URLs → `wire`, same as today.
- **Fast path preserved:** `"Implement this precisely: <url>"`, `"import this <url>"`,
  `"bring this in <url>"`, a bare URL → `kit-emit`.
- **No accidental regressions — THE SINGLE MOST IMPORTANT GUARD IN THIS DESIGN:** loop the 32
  must-stay-deterministic strings from `__tests__/lib/figmaUrl.test.ts`, appended to a Figma
  URL, and assert all stay `kit-emit` **except** `"keep everything on a single frame"`. Pin the
  exception by name so it cannot be quietly widened to two. This is the regression the CUT
  prose gate would have caused — measured, it flipped 20 of these 32 onto the LLM.
  **Revision 4: READ the strings out of the sibling test file, do not copy them.** A copy stops
  protecting anything the moment someone adds a 33rd string over there — this file would keep
  passing while the new string went unguarded. Assert the extracted COUNT too (32, of which one
  is `""`), so a parser that silently matches nothing fails loudly instead of passing
  vacuously. Also spot-check three of them with **no reader injected**, since that is the plain
  Claude-Code host.
- **AS SHIPPED, three additions the review's ordering blockers demand.** Each pins an
  ordering invariant that a plausible future edit would break silently:
  - every string in `generationIntent.test.ts`'s must-generate sets, appended to a URL, →
    `kind !== "kit-emit"` and `decidedBy === "legacy-intent"`. An earlier draft ordered the
    new layers above `wantsGeneration` and sent **11 of 17** of these backwards to the
    LLM-less importer.
  - the four 2-URL interaction strings → `kind === "wire"`. A layer above the wire check
    silently drops URL#2 and wires nothing.
  - a compose-base turn (`"use the ComputerScene template"`) → `claude`, so `ejectComposite`
    stays reachable (`runClaudeBranch` is the only caller, so a kit-emit turn can never
    eject — an invariant `generationIntent.ts` states only in a doc comment).
- **AS SHIPPED, the `origin` boundary:** `#0` → `kit-emit` even though provenance resolves
  its node, and a `nested` containment hit → `claude`. See §2.4. (Note the nested case uses a
  hand-built frame with the plain host attribute stripped — a file the importer does not
  produce. It demonstrates the branch, not reachability; see §2.5's defensive-only note.)
- **AS SHIPPED, all 54 no-URL corpus prompts** → `no-node`, `constraints: []`.
- **REVISION 4, three decisions pinned so nobody has to trace three files to find them:**
  - a **wire turn carrying `single-frame`** → `kind:"wire"`, `constraints:["single-frame"]`,
    with the comment explaining that the branch satisfies it structurally.
  - **pasting a CHILD of an already-imported frame** → `claude`/`provenance` naming the parent
    frame, i.e. "edit the parent" is the chosen reading (§2.5).
  - a **rejecting reader** → `kit-emit`/`default`, never a failed turn.

### THE HEADLESS TEST — `__tests__/server/figma/headlessRouting.test.ts`

**This test is the whole point of the design.** Call `planFigmaTurn` with **no `deps` at
all** — no reader, no Studio anything — and assert:

- every one of the 13 corpus Figma prompts produces a valid plan and nothing throws
- `#0 #37 #45 #53` → `kit-emit` (the fast path needs no host)
- `#30` → `claude` with `single-frame` (L3 alone settles it, with zero host capability)
- `#1` → `kit-emit`, **documented as the honest cost of no host**: without a frame reader
  there is no provenance signal, so the correction is not caught. A Claude-Code host that
  supplies files it already has in context gets the fix; one that supplies nothing gets
  today's behaviour, not a crash.
- no branch of the cascade requires a `deps` object to exist

Plus the **static import guard**. AS SHIPPED this is stronger than the original sketch in
three ways, each because the naive version was tried and found to be a no-op or a
nuisance:

1. **Transitive, not per-file.** It resolves relative imports and walks the closure from
   each brain entrypoint (`turnRouting`, `provenance`, `turnConstraints`, `frameSlug`),
   failing on any module that *reaches* `server/paths.ts`, `server/projects.ts`,
   `server/claudeBin.ts`, `server/figmaCli.ts`, `server/figmaIngest.ts`, or
   `kitEmitBranch.ts`, and **reports the offending chain**. A per-file grep cannot see the
   `provenance → kitEmitBranch → paths.ts` coupling the first draft actually had, which is
   why `frameSlug.ts` exists as a zero-import leaf.
2. **Resolved paths, not the literal string `server/paths`.** No module in `server/` ever
   writes that string — the codebase uses relative imports (`"./paths"`, `"../paths"`) — so
   the original needle could never match a real violation.
3. **Comment-stripped, and self-tested.** All four brain modules *document* the rule ("must
   not read `process.env`"), and the first version failed on its own documentation. It now
   strips comments before matching, asserts that stripping still catches
   `const x = process.env.FOO`, and asserts it still detects both failure shapes against
   `kitEmitBranch.ts` — a known-dirty module. A guard that cannot fail is worse than no
   guard; that is the `import-hook-dead-in-dmg` lesson.

4. **REVISION 4 — it covers the HOST'S INPUT CONTRACT, not only the brain.** Auditing the
   routing layer alone measured the wrong thing: a host cannot call `planFigmaTurn` without
   `parseFigmaUrl` (`nodeIds`), `shouldGenerateFromFigma` (`wantsGeneration`) and
   `extractFigmaUrls`/`detectInteractionIntent`. So `server/figma/figmaNodeUrl.ts`,
   `server/figma/generationIntent.ts` and `src/lib/figmaUrl.ts` are audited as
   `HOST_GLUE_ENTRYPOINTS` under the same rules. Before this, the guard forbade the brain
   exactly what the call contract required of the host (§5.2).

Also asserts the total brain + glue closure is exactly these **9** modules **by name**, not
merely under a size cap — so growth is a decision someone makes on purpose:
`figmaNodeUrl`, `frameSlug`, `generationIntent`, `provenance`, `turnConstraints`,
**`turnDirectives`**, `turnRouting`, `src/lib/figmaUrl`, `src/lib/scopedEdit`.

> **THE NINTH MODULE ARRIVED, AND THE TEST DID ITS JOB (revision 5).** The paragraph below
> said: *"If it ever needs a ninth module, this test says so in one place instead of leaving a
> future host to discover it."* Adding `turnDirectives.ts` failed this assertion, which is
> exactly the intended behaviour — the growth was reviewed and accepted rather than absorbed
> silently. The cost is one module with two imports (`./turnConstraints`, and a TYPE from
> `./turnRouting`); the return is that a foreign host can act on a plan at all. `chat.ts` was
> never a candidate for the list: its closure is 61 modules.

**REVISION 4 also adds the seam END TO END**, in one test, using only those modules: parse a
real URL, hand over one file the way a Claude-Code host would, and assert corpus #1 comes back
as `claude`/`provenance`/`01-figma-5678-118876`. That is the foreign host's entire
implementation. If it ever needs a tenth module, this test says so in one place instead of
leaving a future host to discover it.

**REVISION 5 extends that end-to-end test past the PLAN to the WORDS**, because a plan a host
cannot act on was the whole gap: the same test now asserts
`buildTurnDirectives(plan)` names the frame, and a sibling asserts #30's constraint becomes a
real `<single_frame_constraint>` string — both with **no deps injected at all**.

Verified by hand, not just by construction: injecting `import { frameDir } from "../paths"`
into `provenance.ts` fails the guard with
`reaches server/paths.ts via server/figma/provenance.ts -> server/paths.ts`.

### Middleware — extend `__tests__/server/middleware/enrich-figma-multi-url.test.ts`

- `constraints:["single-frame"]` → the `<single_frame_constraint>` block appears **after** the
  `<figma_context>` block(s) in the returned prompt.
- **THE DIGEST-MISS CASE IS MANDATORY (revision 4), not an extra.** With `getCached`
  undefined, no pending ingest, and `ingestPhase1 → {ok:false}`, corpus #30's verbatim wording
  must still come back carrying `<single_frame_constraint>`. Verified: against the current code
  it comes back **byte-identical to the input** (213 chars in, 213 out) because `chat.ts:854`
  returns before the attach point. The existing mocks in that file exercise only the digest-HIT
  path, so a hit-only test would pass while the miss path stayed broken — which is exactly how
  this defect got through the first review. See the corrected attach point in §3.5.
- Also on the miss path: `"Implement this precisely, but keep it in the same frame: <url>"`
  (`explicitHiFi` TRUE) must keep the `<high_fidelity_mode>` block it gets today **and** gain
  the constraint. The naive §5.3 widening loses both.
- `constraints:["single-frame"]` → **no** `<high_fidelity_mode>` block, on both the
  digest-hit and digest-miss paths (verification (d)+(e); the existing mocks make both
  reachable).
- `targetFrame` set → same hi-fi suppression, and the target frame is named in the prompt.
  Assert it survives an EMPTY `frameSlugs` list (`prependEditContext` no-ops on empty — §5.4).
- No constraints, no target → byte-identical output to today. This is the regression guard
  for the tests that already depend on this function.

> **AS SHIPPED (revision 5) — a NEW FILE, and it posts to the real HTTP handler rather than
> calling `enrichPromptWithFigmaContext` directly.** `__tests__/server/middleware/chat-single-frame.test.ts`
> (10 tests) `POST /api/chat` with a fake `claude` bin and reads the prompt the subprocess
> actually received (`ARCADE_TEST_PROMPT_OUT`). The reason for the whole handler rather than the
> one function: the plan now has to travel `handleStart` → `runClaudeBranch` →
> `enrichPromptWithFigmaContext`, and a direct call would let any break in that chain pass. It
> also proves the ROUTING half — `#30` reaching the generator at all, which a direct enrichment
> call cannot show.
>
> **The digest is mocked to a forced MISS for the ENTIRE FILE**, so every assertion is a
> miss-path assertion by construction rather than by remembering to add one. Two tests then pin
> the property explicitly (one asserts `not.toContain("<figma_context")` first, so it cannot
> silently become a hit-path test).
>
> **Two additions beyond the plan.** (a) An ORDERING test: the constraint must be the last
> directive, checked against `<figma_context`, `<edit_reference_designs>`,
> `<high_fidelity_mode>` and `<target_frame>` — the plan asserted "after the figma_context
> block" only. (b) The provenance test writes a REAL frame file to disk and a real
> `project.json` frame record, so it exercises `makeStudioFrameReader` end-to-end; a stub reader
> would have proved nothing about the one Studio-only module in the feature.
>
> `enrich-figma-multi-url.test.ts` was left UNTOUCHED, deliberately — it is the byte-identical
> regression guard for the no-plan path, and its 9 tests all still pass, which is the evidence
> that an absent plan changes nothing.

### Template — `__tests__/templates/claude-md-single-frame.test.ts`

Same shape as the existing `claude-md-token-guidance.test.ts` (read the tpl, assert marker
phrases): assert `An explicit in-frame instruction OVERRIDES` is present, that the
`"pressing Save goes to the confirmation"` line now carries the one-frame caveat, and that
line 545's rule carries the `unless the prompt explicitly asks to stay in one frame` escape.
Cheap guard against a future template rewrite silently dropping it.

### Full suite

`pnpm run studio:test` from the repo root. **AS SHIPPED, RE-RUN ON A CLEAN TREE (revision 7):
2606 passed / 0 failed / 2 skipped**, 344 files, ~47s. The 2 skips are pre-existing. The two
esbuild `✘ [ERROR]` lines in the output (`Expected "}" but found "<"`, `Could not resolve
"./does-not-exist-anywhere"`) are **expected fixtures**, not failures — they are the deliberate
broken-frame inputs of the sidecar tests, and they appear identically at HEAD. Worth knowing,
because they read like a build break in a log skim.

`tsc --noEmit -p studio/tsconfig.json` reports **194 project-wide errors, and re-measured in
revision 7 the count is unchanged and NONE of them is in any file this work added or touched**
(grepped the raw output for all seven new modules: zero hits). The 194 are pre-existing:
57 × `TS2307` unresolved `arcade/*` module specifiers, plus implicit-`any` and narrowing noise
across 58 files. **Do not read the 194 as a regression from this work** — that misreading is
easy and has cost time before.

---

## 8. HEADLESS AUDIT

| Module | Verdict | Why |
|---|---|---|
| `server/figma/provenance.ts` | **brain** | Pure matching logic. All file access is behind the injected `FrameSourceReader`; the module never names a path and never imports `node:fs`. |
| `server/figma/turnConstraints.ts` | **brain** | Pure regex + a template string. Runs identically in any host. |
| `server/figma/turnRouting.ts` (extended) | **brain** | `planFigmaTurn` is pure apart from the one injected dep, and correct with `deps` absent entirely. `classifyFigmaTurn` stays pure and unchanged. |
| `server/editContext.ts` | **brain, UNCHANGED as shipped** | Revision 5 did NOT extend it. The target frame is its own `<target_frame>` directive from `turnDirectives.ts` instead — independent of `frameSlugs` (whose empty-list no-op would have dropped it), and reachable by a foreign host, which has no equivalent of the `prependEditContext` seam. See §5.4. |
| `server/figma/turnDirectives.ts` | **brain** | Plan → directive strings + the hi-fi suppression decision. Imports only `./turnConstraints` and a TYPE from `./turnRouting`. This module is the reason a foreign host can ACT on a plan rather than just compute one; it closes revision 4's honest exception 1. §3.6. |
| `server/figma/frameSlug.ts` | **brain** | Zero-import leaf. Extracted out of `kitEmitBranch.ts` so the reader can share the writer's transform without inheriting `paths.ts` / `figmaCli.ts` / `claudeBin.ts` (§2.3). |
| `server/figma/figmaNodeUrl.ts` | **brain** | Zero-import leaf. `parseFigmaUrl`, extracted out of `figmaCli.ts` because it is part of the routing layer's INPUT CONTRACT and `figmaCli.ts` imports `node:child_process` (§5.2). |
| `templates/CLAUDE.md.tpl` (edited) | **brain by nature, Studio-only by DISTRIBUTION** | Generator instructions travel to every host in principle — but measured, this template is rendered only into a Studio project dir and never exported, and the root `SKILL.md` carries none of these rules. See the revision-4 note in §6. |
| `server/figma/adapters/studioFrameReader.ts` | **Studio-only adapter** | Must touch `server/paths.ts` to enumerate `frames/<slug>/*.tsx`. Justified: reading files IS host-specific, the seam keeps it to one `frameDir` import, and a Claude-Code host implements the same two-line interface over files it already has in context. Landed at ~100 lines rather than the estimated 15, all of it the three failure modes a stub cannot have: multi-file frame dirs, `fileKey` recovery, and never rejecting. |
| `server/middleware/chat.ts` (wiring) | **Studio-only** | It already IS the Studio host. Constructs the reader, passes it in, and APPENDS the strings `buildTurnDirectives` returns. It decides nothing — that is the line revision 5 drew. |

**No subprocess appears anywhere in this design.** With L4 cut, the "no nested model call on
the routing path" constraint is satisfied structurally rather than by discipline — there is no
code that could violate it. `systemSynth.ts` remains the precedent for a future host adapter,
if and when L4 is revived with real evidence; it is not a precedent for anything shipping
here.

**Nothing in the ROUTING LAYER can only work inside the desktop app.** The single Studio-only
module is an adapter behind a two-line seam, and the headless test in §7 proves the cascade
produces correct plans without it — including the #30 fix, which lands with zero host
capability at all. The brain-plus-glue closure is **9** files, asserted by name.

**Two honest exceptions, added in revision 4 rather than glossed. Revision 5 CLOSED the first
and confirmed the second:**

1. ~~**Turning a plan into words is not yet portable.**~~ **CLOSED (revision 5).**
   `server/figma/turnDirectives.ts` now owns the directive set, its order, and the hi-fi
   suppression decision, as a brain module. A Claude-Code host runs
   `buildTurnDirectives(await planFigmaTurn(inputs))` and gets the actual words — asserted
   end-to-end in `headlessRouting.test.ts` with **no deps injected at all**, for #30 (the
   constraint) and for #1 (the target frame, with one file handed over the way a Claude-Code
   host would). The brain-plus-glue closure grew from 8 files to **9**, asserted by name, which
   is the honest cost.
2. **The template still does not travel** (§6). It renders only into a Studio project dir, and
   revision 5 records why the proposed `SKILL.md` remedy was the wrong file. This now matters
   less than it did: the template is belt-and-braces, and the primary mechanism (the
   prompt-region directive) is portable.

---

## 9. WHAT THIS DOES NOT FIX

Honest limits. Each is a real gap, not a hedge.

1. **Corpus #25 and #32 still lose their instructions.** Both carry real prose ("There must
   be three buttons on the right hand side, inline with the heading", "When a new tab is
   created, a user must see this page"), both reference a node no rendered frame contains,
   and neither states a single-frame constraint — so both still route to the deterministic
   importer and their prose is still discarded. **This design fixes 2 of the 4 losing
   prompts, not 4.** The other 2 were L1/L4 territory, and the measurement said L1 costs more
   than it buys (§0) and L4 currently buys nothing (§0). A test pins their current outcome so
   the gap is visible, not forgotten. Fixing them properly needs a real resolver with a real
   motivating prompt.
2. **Provenance is blind on almost every frame that exists today.** Verified across 11 live
   projects: 2 frame files in 1 project carry `data-figma-id`. Only the deterministic
   importer stamps it, so LLM-written frames never have it — forever. L2 therefore helps on
   importer-produced frames only. That happens to be the dominant Figma-import lane, which is
   why it is worth shipping, but "the designer is correcting an LLM-built frame" gets no
   provenance signal at all.
3. **Provenance cannot see the frame's own root node in the source**; it recovers that from
   the frame slug / `importedFromNodeId` (§2.3 source 3), which only works for frames whose
   slug encodes the node — i.e. importer-produced ones. An LLM-built frame that happened to
   implement a node has no recoverable link.
4. **We do not detect corrections.** Deliberately. Corpus #1 is caught by *provenance*, not by
   any understanding that it is a complaint. A correction about a frame with no provenance
   signal and no constraint still reaches the importer. #1 was fixed by a coincidence of
   mechanism — common enough to be worth shipping, narrow enough that nobody should mistake
   it for correction handling.
5. **`single-frame` is the only constraint.** The `TurnConstraint` union is deliberately
   one-valued. Other real asks in the corpus — "use our components", "as a new tab next to
   Canvas", "use smaller heading style" — are not modelled and flow to the generator as prose
   (or, on a bare-import turn, are dropped). Growing the union needs corpus evidence per
   value, not a guess.
6. **Nothing verifies the outcome against the plan.** If provenance says `edit 01-foo` and
   the generator edits `02-bar`, nothing notices. Closing that needs the render-verification
   work, which is disabled behind flags (see the `render-measurement-multipage-blocker` note).
7. **No live gate has run.** Every claim here comes from source reading, the committed corpus,
   real frame files on disk, the app's own telemetry, and (task 2) mutation-testing the new
   code. **The `.dmg` has not been rebuilt and no designer has typed a prompt through this
   cascade.** Given this project's history — jsdom-blind tests passing while multi-page
   measurement was broken live; the import hook silently dead in the DMG — a manual gate on real
   prompts is required before this is called done, and it should be run in a **Claude Code
   host**, not just Studio, since that is the target.

   **Still true after task 2, and it is the main open risk.** The one thing the tests cannot
   show is whether the generator OBEYS the directive — they prove the words arrive, byte for
   byte, in the prompt the subprocess receives. Whether a model handed
   `<single_frame_constraint>` actually builds an in-frame state instead of a second frame is an
   empirical question about the model, and §9 item 6 records that nothing verifies the outcome
   against the plan either. The corpus prompt to gate on is #2 verbatim, in a project that
   already has one frame; the pass condition is one frame, not two.
8. **L2's latency is bounded but unmeasured at scale.** Sub-10ms on the live 3-frame project.
   A designer with 30 frames pays 30 small file reads on every Figma turn that reaches step 6
   — which includes bare imports whose node has no provenance hit, i.e. the fast path pays it
   too. Measure before assuming it is free, and if it bites, the fix is a per-project id
   index, not removing the layer.
9. **The suite total is only trustworthy on a clean tree (revision 7).** Not a limit of the
   feature, but of how it was verified, and it bit this spec twice. `vitest run` cannot tell an
   untracked scratch probe under `__tests__/` from a real test, so three throwaway measurement
   files silently inflated the "verified" total to 2617 and made a stale 2581 look like a
   plausible baseline drift rather than a wrong number. **Before quoting a suite total, run
   `git status --short studio/__tests__/` and confirm there is nothing untracked.** The stronger
   habit, and the one that actually caught this, is to check that the delta reconciles: baseline
   + tests-you-added should equal the new total exactly, and if it does not, the difference is
   something you have not explained yet.
