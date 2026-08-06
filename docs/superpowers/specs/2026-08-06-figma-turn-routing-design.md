# Figma turn routing — provenance + constraints (Option A, reduced)

**Date:** 2026-08-06
**Status:** design spec, ready to implement. The DECISION is made; this specifies HOW.
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

`studio/templates/CLAUDE.md.tpl` is 883 lines. Verified current text:

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

There is no `suppressWholeFrameDirective` anywhere in the repo (`grep` → 0 hits). The real
seam is **`suppressHiFiDirective`**, a boolean on `resolveFigmaReference`'s ctx:

- `chat.ts:796` — `const scopedEdit = isScopedEditTurn(prompt);`
- `chat.ts:844` — passes `suppressHiFiDirective: scopedEdit`
- `chat.ts:875` — declares the flag, with the doc comment explaining why
- `chat.ts:914` — digest MISS branch: `if (!explicitHiFi || suppressHiFiDirective) return { block: null, png: null }`
- `chat.ts:938` — digest HIT branch: `if (!suppressHiFiDirective && (explicitHiFi || shouldUseHiFi(...)))`

Both the hit and miss branches are already covered, which is why §5.3 widens this exact flag
rather than adding a second one. **Use the real name in the implementation.**

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

The colon→dash slug transform already exists in exactly one place — `frameNameFromNode` at
`server/figma/kitEmitBranch.ts:139-141`. **Export it and reuse it** rather than re-deriving;
a second copy of that transform is the drift failure `src/lib/scopedEdit.ts` exists to end.

### 2.4 It MUST refuse to guess

Naming the WRONG frame is worse than naming none: the generator would confidently edit a
frame the designer wasn't talking about, and the designer's next turn would be a second
correction about a third frame. So:

- **0 matches** → `{ kind: "none" }`. Cascade continues to L3. **Never invent a target.**
- **exactly 1 match** → `{ kind: "exact" | "nested" | "origin", frameSlug }`. The only case
  that names a frame.
- **2+ matches** → `{ kind: "ambiguous", candidates: string[] }`. **Does NOT set
  `frameSlug`.** The turn still leaves the importer (it is provably an edit of *something* we
  already rendered), but no frame name reaches the generator — it gets the candidate list as
  context in the prompt region instead, and picks. That is the honest handling: we know it is
  an edit, we do not know of what.

### 2.5 Signature and cost

```ts
export type ProvenanceMatchKind = "none" | "exact" | "nested" | "origin" | "ambiguous";

export interface ProvenanceResult {
  kind: ProvenanceMatchKind;
  /** Set ONLY for exact | nested | origin. NEVER set for none | ambiguous. */
  frameSlug?: string;
  /** Set only for ambiguous. */
  candidates?: string[];
}

export async function locateNodeProvenance(
  nodeIds: string[],              // colon form, from parseFigmaUrl — all URLs in the prompt
  readFrames: FrameSourceReader,  // injected — no Studio path in this module
): Promise<ProvenanceResult>;
```

Cost: reading N frame files + N attribute regex tests. On the live 3-frame project that is
~19KB and sub-10ms. **Bound it** so a 30-frame project doesn't pay unboundedly on every
non-bare Figma turn: `index.tsx` only, skip sources over 1MB. Enumeration is the host
reader's job; the pure layer iterates what it is handed.

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
const SINGLE_FRAME_PATTERNS: RegExp[] = [
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+frame/i,
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+(?:these|those|the)?\s*screens?/i,
  /\b(?:within|in|on)\s+(?:this|the|one|a)\s+single\s+frame\b/i,
  /\b(?:same|one|single)\s+frame\b/i,
  /\bkeep\s+(?:it|this|everything|them|both)\b[^.!?]{0,30}\b(?:one|single|same)\s+frame\b/i,
  /\bas\s+a\s+(?:new\s+)?tab\b[^.!?]{0,60}\bmain\s+frame\b/i,
];
```

Every span is `[^.!?]`-bounded so it cannot bridge sentences — the same discipline the
interaction patterns learned the hard way (see the `[^.\n]*` comment in
`src/lib/figmaUrl.ts`).

**Measured over all 67 corpus prompts: fires on exactly #2, #30, #39. Nothing else.** #39 has
no Figma URL, so it reaches the generator today anyway and simply gains the directive.

Note `/\b(?:same|one|single)\s+frame\b/i` also matches the committed must-miss string
`"keep everything on a single frame"`. That is **correct as detection** — the designer did
state a single-frame constraint — and §2.6 records it as the one intentional routing flip. Do
NOT "fix" it by narrowing the pattern; pin it with a test instead so a future change has to
argue with it.

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
file, which is the whole reason `server/editContext.ts` exists. Concretely: appended to the
`blocks` array inside `enrichPromptWithFigmaContext`, **after** the `<figma_context>` blocks
and after any `<edit_reference_designs>` (i.e. right after `chat.ts:855`), so it is the last
word before the model starts. Keeping all Figma-turn directives assembled in that one
function is preferable to a second `ejectSuffix`-style seam at `chat.ts:1156`.

It must also **suppress the whole-frame hi-fi directive** via the existing
`suppressHiFiDirective` flag — see §5.3, and verification (d) for why that is mandatory
rather than tidy.

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
                                 ← preserved verbatim from turnRouting.ts:88
5. inp.wantsGeneration        → { kind:"claude", decidedBy:"legacy-intent", constraints }
                                 ← today's build-intent path (turnRouting.ts:89-90 inverted).
                                   #2 #3 #15 #22 #23 exit here, now carrying constraints.
   ── everything below is reached ONLY where today's router says "kit-emit" ──
6. deps?.readFrames present → L2 locateNodeProvenance(nodeIds, readFrames)
     exact | nested | origin → { kind:"claude", targetFrame, decidedBy:"provenance", constraints }
                                 ← #1 exits here
     ambiguous               → { kind:"claude", frameCandidates, decidedBy:"provenance", constraints }
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
    nodeIds: figmaUrls.map((u) => parseFigmaUrl(u)?.nodeId).filter(Boolean) as string[],
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

`makeStudioFrameReader(slug, frames)` — new, ~10 lines, in
`studio/server/figma/adapters/studioFrameReader.ts`. Uses `frameDir()` from
`server/paths.ts`, reads `index.tsx` per frame slug, skips unreadable files and files over
1MB, and sets `importedFromNodeId` where the slug encodes it. **It is the only Studio
filesystem path in the whole feature.**

### 5.3 `enrichPromptWithFigmaContext` — widen the REAL seam

Thread the plan through:

```ts
enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? [], narrate, {
  targetFrame: plan.targetFrame,
  frameCandidates: plan.frameCandidates,
  constraints: plan.constraints,
})
```

Inside, widen the existing suppression (`chat.ts:796`, today `const scopedEdit =
isScopedEditTurn(prompt);`):

```ts
const suppressWholeFrame =
  isScopedEditTurn(prompt) ||
  Boolean(opts?.targetFrame) ||
  Boolean(opts?.frameCandidates?.length) ||
  (opts?.constraints ?? []).includes("single-frame");
// ...then pass suppressHiFiDirective: suppressWholeFrame  (chat.ts:844)
```

**This is required, not optional.** Verification (d): `shouldUseHiFi`'s novel-design upgrade
fires even with no hi-fi wording, and `buildHiFiDirective` then says *"each section has the
SAME number of rows, same order, as the PNG"* — build a fresh full frame. On a single-frame
or provenance-located edit, that instruction actively causes the bug we are fixing. The
existing flag already covers both the digest-hit (`chat.ts:938`) and digest-miss
(`chat.ts:914`) branches, so widening it is complete — no second flag.

Keep `scopedEdit` as its own variable for `blocks.push(buildScopedEditReferenceDirective())`
at `chat.ts:855`: that directive is specifically about right-click edits and must NOT start
appearing on typed single-frame turns.

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

### 5.5 The rule a reviewer can check mechanically

**`provenance.ts`, `turnConstraints.ts`, and `turnRouting.ts` must not contain
`server/paths`, `node:fs`, `node:child_process`, `electron`, or `process.env`.** That is
greppable, and §7 makes it a test.

---

## 6. TEMPLATE CHANGE — `studio/templates/CLAUDE.md.tpl`

In scope: generator instructions travel to every host. On a Claude-Code host this is the
*only* part of this design that ships, so it must be correct standing alone. Three edits.

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
Full suite (~90s, from repo root) before commit. **Baseline is 2461 passed / 0 failed — any
failure is ours.**

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
- Directive text contains `Do NOT use <FrameLink>` and `Do NOT create a new frame`.

### Cascade — extend `__tests__/server/figma/turnRouting.test.ts`

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
- **No accidental regressions:** loop the 30 must-stay-deterministic strings from
  `__tests__/lib/figmaUrl.test.ts`, appended to a Figma URL, and assert all stay `kit-emit`
  **except** `"keep everything on a single frame"`. Pin the exception by name so it cannot be
  quietly widened to two.

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

Plus the **static import guard**, in the `__tests__/packaging/runtime-deps.test.ts` style:
read the source of `provenance.ts`, `turnConstraints.ts`, and `turnRouting.ts` and assert none
contains `server/paths`, `node:fs`, `node:child_process`, `electron`, or `process.env`.
Mechanical, cheap, and it is what stops the next well-meaning change from quietly re-coupling
the brain to the app.

### Middleware — extend `__tests__/server/middleware/enrich-figma-multi-url.test.ts`

- `constraints:["single-frame"]` → the `<single_frame_constraint>` block appears **after** the
  `<figma_context>` block(s) in the returned prompt.
- `constraints:["single-frame"]` → **no** `<high_fidelity_mode>` block, on both the
  digest-hit and digest-miss paths (verification (d)+(e); the existing mocks make both
  reachable).
- `targetFrame` set → same hi-fi suppression, and the target frame is named in the prompt.
- No constraints, no target → byte-identical output to today. This is the regression guard
  for the tests that already depend on this function.

### Template — `__tests__/templates/claude-md-single-frame.test.ts`

Same shape as the existing `claude-md-token-guidance.test.ts` (read the tpl, assert marker
phrases): assert `An explicit in-frame instruction OVERRIDES` is present, that the
`"pressing Save goes to the confirmation"` line now carries the one-frame caveat, and that
line 545's rule carries the `unless the prompt explicitly asks to stay in one frame` escape.
Cheap guard against a future template rewrite silently dropping it.

### Full suite

`pnpm run studio:test` from the repo root. Expect ≥ 2461 passing, 0 failing.

---

## 8. HEADLESS AUDIT

| Module | Verdict | Why |
|---|---|---|
| `server/figma/provenance.ts` | **brain** | Pure matching logic. All file access is behind the injected `FrameSourceReader`; the module never names a path and never imports `node:fs`. |
| `server/figma/turnConstraints.ts` | **brain** | Pure regex + a template string. Runs identically in any host. |
| `server/figma/turnRouting.ts` (extended) | **brain** | `planFigmaTurn` is pure apart from the one injected dep, and correct with `deps` absent entirely. `classifyFigmaTurn` stays pure and unchanged. |
| `server/editContext.ts` (extended) | **brain** | Already pure, already host-neutral. Gains an optional target-frame line. |
| `templates/CLAUDE.md.tpl` (edited) | **brain** | Generator instructions travel to every host — the highest-leverage brain surface we have, and on a Claude-Code host the only thing that ships. |
| `server/figma/adapters/studioFrameReader.ts` | **Studio-only adapter** | Must touch `server/paths.ts` to read `frames/<slug>/index.tsx`. Justified: reading files IS host-specific, the seam keeps it to ~10 lines and one import, and a Claude-Code host implements the same two-line interface over files it already has in context. |
| `server/middleware/chat.ts` (wiring) | **Studio-only** | It already IS the Studio host. Constructs the reader and passes it in. The only file where Studio paths and the routing layer meet. |

**No subprocess appears anywhere in this design.** With L4 cut, the "no nested model call on
the routing path" constraint is satisfied structurally rather than by discipline — there is no
code that could violate it. `systemSynth.ts` remains the precedent for a future host adapter,
if and when L4 is revived with real evidence; it is not a precedent for anything shipping
here.

**Nothing in this design can only work inside the desktop app.** The single Studio-only
module is an adapter behind a two-line seam, and the headless test in §7 proves the cascade
produces correct plans without it — including the #30 fix, which lands with zero host
capability at all.

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
   real frame files on disk, and the app's own telemetry. **The `.dmg` has not been rebuilt
   and no designer has typed a prompt through this cascade.** Given this project's history —
   jsdom-blind tests passing while multi-page measurement was broken live; the import hook
   silently dead in the DMG — a manual gate on real prompts is required before this is called
   done, and it should be run in a **Claude Code host**, not just Studio, since that is the
   target.
8. **L2's latency is bounded but unmeasured at scale.** Sub-10ms on the live 3-frame project.
   A designer with 30 frames pays 30 small file reads on every Figma turn that reaches step 6
   — which includes bare imports whose node has no provenance hit, i.e. the fast path pays it
   too. Measure before assuming it is free, and if it bites, the fix is a per-project id
   index, not removing the layer.
