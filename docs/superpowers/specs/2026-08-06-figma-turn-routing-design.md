# Figma turn routing — cheapest-first cascade (Option A)

**Date:** 2026-08-06
**Status:** design spec, ready to implement. The DECISION is made; this specifies HOW.
**Branch:** `fix/studio-brain-figma-edit-routing` (on top of `e891443` interaction widening + `d9e7c4a` blur)
**Motivating session:** the 2026-08-06 designer session (project `implement-this-precisely-3`,
Onboarding 3.0) plus the 67-prompt corpus at `studio/__tests__/fixtures/designer-prompts.json`.

---

## The bug in one paragraph

A designer pastes a Figma URL with instructions attached. Studio's router asks "does
this prompt contain build-intent keywords?" — and when the answer is no, sends the turn
to the deterministic importer, which has **no LLM and therefore cannot read one word of
the prose**. Measured on the real corpus, 4 of the 13 Figma prompts lose their
instructions this way. One of them (#30) literally reads
`DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!` and was ignored — the importer stamped a
separate frame, and the designer's next turn (#31) is them explaining the failure back
to us. That is the whole bug: **we throw away instructions we can see.**

A keyword corrective-detector was built and removed on this branch (27% recall on 15
labelled corrections, and it fired on descriptive faithful-copy prose). It is **banned**
here. The prose gate below asks a different, checkable question — not "is this a
complaint?" but **"did the designer write instructions we are about to discard?"**

---

## The decision (Option A — do not relitigate)

A cheapest-first cascade. Deterministic layers do the work the corpus proves they can do;
the model is paid only for genuine ambiguity.

```
Figma-URL prompt
  L1  PROSE GATE      deterministic, 0ms   nothing/trivial after stripping → IMPORT, unchanged
  L2  PROVENANCE      deterministic, ~1ms  pasted node already in a rendered frame? → EDIT that frame
  L3  CONSTRAINTS     deterministic, 0ms   explicit "single frame" → attach a HARD directive
  L4  RESOLVER        host-answered        only when prose exists and L2+L3 didn't settle it
```

Rejected, with reasons — do not re-propose:

- **"classify every Figma turn"** — adds latency to bare imports (4 of 13 real prompts,
  and the product's speed advantage), and makes a resolver outage break importing entirely.
- **"no resolver, all prose to the generator"** — loses the deterministic fidelity
  guarantee whenever ANY prose is present, e.g. "implement this precisely, but make the
  header 16px".

---

## OVERRIDING CONSTRAINT — build for the headless brain, not the .dmg

Product owner, explicit: *"everything we do must be optimised for the headless/brain
version. If it only serves the .dmg app — we're not doing that."* The designers do not
use the desktop app; they work in their own Cursor / Claude Code. Studio is ONE host of
several.

Consequences that bind every module below:

1. **Layer 4 is NOT a subprocess spawn on the routing path.** `systemSynth.ts`'s
   `claude --print` shape presumes a host that owns a CLI binary and Bedrock credentials.
   In Claude Code / Computer the brain is *already executing inside a model turn* —
   spawning a nested model call there is wrong. So the routing layer **returns a
   question**; the **host answers it** through one small injected interface.
2. **No module on the routing path may reference a Studio filesystem path**, Electron,
   IPC, or a Studio-only env var. Layer 2's provenance signal is portable, but it reads
   through an **injected frame-source accessor**, never `~/Library/Application Support/...`.
   (Compare `import-hook-dead-in-dmg`, one level up: a dev-only path silently disabled a
   whole feature on tester machines.)
3. **`templates/CLAUDE.md.tpl` IS in scope** — generator instructions travel to every
   host. That is brain, not interface.
4. The `LibraryAdapter` seam (`feat/library-adapter-seam`,
   `studio/server/figma/libraryAdapter.ts`) is the precedent for seam shape in this repo:
   a small, deliberately-minimal, library-neutral interface, with a doc comment that
   names what is SHARED vs PER-HOST and refuses to grow without a surfaced reason.
   Layer 4's interface follows that pattern.

---

## VERIFICATION LOG (run 2026-08-06 — corrections to the brief are marked)

Everything below was measured, not assumed. Where reality differed from the task brief,
the spec follows reality.

### (a) Prose-length distribution — CONFIRMED, with a correction

URL-strip only, across the 13 corpus prompts that carry a Figma node URL:

```
  0  #37 #45 #53   (bare URL, nothing else)
 25  #0            "Implement this precisely:"
 64  #1  CORR      "You haven't implemented this background blur properly: try again"
113  #23           "Replace the bar at the top of "My tickets" page … with this one …"
121  #22           "When I click on "My tickets" item in the side nav, it should open …"
155  #25           "Now, the line underneath … 1. There must be three buttons …"
161  #30           "… change from table to list view … (DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!)"
168  #32           "Let's implement a default "new tab" experience …"
191  #2            "When I click on "Save" … don't separate these screens …"
441  #15
919  #3
```

The gap the brief describes (0/25 → then a jump to 64+) is REAL and was not tuned to fit.

**CORRECTION — the gap is NOT as clean as the brief implies once you include the
must-stay-deterministic prose.** After stripping URLs + HI_FI vocabulary + bare-import
boilerplate (the L1 algorithm in §1), the *committed* must-miss faithful-copy strings in
`__tests__/lib/figmaUrl.test.ts` have residues up to **84 chars**:

```
84  "a typing indicator at the bottom the avatar stack on the right show the unread badge"
64  "No need to animate the loader just draw it as it is in the frame"
64  "the spinner animates in the prototype but keep it static for now"
63  "This is what the user sees after they click Continue one screen"
```

while corpus #1 (a genuine correction that MUST reach the model) has residue **63**, and
20 of the 32 committed must-miss strings land above 32.

**The distributions OVERLAP at 33–84.** A single length threshold cannot separate them.
This is the single most important finding in this document and §1 is designed around it:
**length alone is not the gate.** A short residue is proof of *absence* of instructions
(safe → import); a long residue is only *evidence* of presence, and the actual decision
is delegated. See §1 for the exact rule.

### (b) Provenance via `data-figma-id` — CONFIRMED with three sharp caveats

Frame `01-figma-5678-118876/index.tsx` in the live project contains
`data-figma-id="5678:118877"` exactly once, and 25 `data-figma-id` attributes in total.
Corpus #1 pasted `node-id=5678-118877` → grep hit → provenance works.

Caveats, all verified:

1. **The frame's own ROOT node id is NOT in the file.** `01-figma-5678-118876` was
   imported from node `5678:118876`; `grep -o '5678[:-]118876' index.tsx` returns
   **nothing**. `kitEmit.ts:1516` emits the outer wrapper as a plain
   `position:relative` div with **no** `data-figma-id` — the attribute is stamped by
   `figmaIdAttr` on emitted CHILDREN only (`kitEmit.ts:1026`). So `5678:118877` is the
   frame's first child, and re-pasting the ORIGINAL url (`…118876`) finds nothing. The
   frame slug (`figma-5678-118876`, `kitEmitBranch.ts:140`) and `LIFT.json` both carry it.
   → Provenance must check **three** sources, not one (§2).
2. **`data-figma-id` is new (commit `95f2ae8`, 2026-07-13) and only the deterministic
   importer writes it.** Verified: `polina-s-nav-2`, `list-view`,
   `implement-this-page-from-connectors-2` (Apr–May) and even `wire-test` (Jun 16) have
   **zero** `data-figma-id` attributes. LLM-written frames never have them. So a MISS is
   the common case, and §2's "refuse to guess" rule is load-bearing.
3. **Nested-instance ids exist and must not false-positive.** The same file has
   `data-figma-id="I5678:118877;5346:75923"` (5 such). A naive substring search for
   `5678:118877` matches those too. The match must be **attribute-exact**.

### (c) `CLAUDE.md.tpl` line numbers — CONFIRMED, exact wording captured

`studio/templates/CLAUDE.md.tpl` is 883 lines. Verified current text:

- **line 545** — `If the user prompts for additional steps ("add a confirmation step"),
  create frames for only the new steps, numbered after the highest existing two-digit
  prefix. Do NOT ask first — the user has committed to multiple frames. Normal response shape.`
- **line 549** — `A multi-frame prototype without navigation is just three disconnected
  screens. If the user's prompt names a specific element that should cause a transition
  between frames, wire it using \`<FrameLink>\`. Otherwise don't.`
- **lines 551–555** — the signal list, including **line 554**:
  `- "pressing Save goes to the confirmation" — wrap the Save button.`

Corpus #2 is *verbatim* that phrasing shape: `When I click on "Save", I want you to
animate the transition to this screen: … IMPORTANT: don't separate these screens onto
multiple frames`. The template tells the generator to treat exactly this as a cross-frame
`<FrameLink>` signal. **The template contradicts the designer.** Confirmed.

### (d) `shouldUseHiFi` fires on a novel design with no hi-fi wording — CONFIRMED

`fidelityDirective.ts:81-84`: `shouldUseHiFi` returns true when
`ctx.classified && !ctx.hasHighConfidenceComposite`, regardless of prompt wording. Pinned
by a committed test: `shouldUseHiFi("build this nav from the figma", { classified: true,
hasHighConfidenceComposite: false })` → `true`
(`__tests__/server/figma/fidelityDirective.test.ts:58-62`).

What it then attaches (`buildHiFiDirective`, `fidelityDirective.ts:182`) includes, verbatim:

> `· each section has the SAME number of rows, same order, as the PNG,`

i.e. **build a fresh full frame**. On a single-frame / correction turn that is exactly
the wrong instruction — the brief's claim is confirmed and §3/§5 suppress it.

### (e) The suppression seam — CONFIRMED, but the brief's NAME is wrong

There is no `suppressWholeFrameDirective` anywhere in the repo (`grep` → 0 hits). The
real seam is **`suppressHiFiDirective`**, a boolean on `resolveFigmaReference`'s ctx:

- `chat.ts:875` declares it; `chat.ts:844` passes `suppressHiFiDirective: scopedEdit`
- `chat.ts:914` — on a digest MISS: `if (!explicitHiFi || suppressHiFiDirective) return { block: null, png: null }`
- `chat.ts:938` — on a digest HIT: `if (!suppressHiFiDirective && (explicitHiFi || shouldUseHiFi(...)))`

Both branches are already covered, which is why §5 reuses this exact flag rather than
adding a second one. Use the real name in the implementation.

### Routing today (measured, `classifyFigmaTurn` on the corpus)

```
#0  kit-emit  len=25  ← correct (bare)          #30 kit-emit len=161 ← LOSES "DON'T … SEPARATE FRAME!!!"
#1  kit-emit  len=64  ← LOSES the correction    #32 kit-emit len=168 ← LOSES instructions
#25 kit-emit  len=155 ← LOSES instructions      #37/#45/#53 kit-emit len=0 ← correct (bare)
#2 #3 #15 #22 #23 → claude (already correct)
```

4 of 13 lose prose. Confirms the brief exactly.

### Latency asymmetry (app telemetry, 235 real turns)

deterministic import 16–26s · edit p50 32s · build p50 98s · tiny-output turns ~5–12s.
A resolver call is cheap vs a generation turn but ~40% overhead on a bare import. **That
asymmetry is the entire reason for the cascade** — never pay it on layer 1's fast path.

---

## 1. LAYER 1 — the PROSE GATE

**New module:** `studio/server/figma/proseGate.ts` — pure, host-agnostic, no I/O.

### The question it asks

Not "is this a correction?" (banned — a speech act is not a vocabulary) but:

> **After removing the URLs and the phrases that mean "just import this", is there any
> designer language left that we would be discarding?**

That is checkable, symmetric, and cannot be gamed by vocabulary drift, because the
stripped set is exactly the set of phrases whose meaning the importer already implements.

### Algorithm

```
proseResidue(prompt):
  1. s := prompt
  2. remove the SCOPED_EDIT_MARKER sentinel and any client target-preamble block
     (a scoped edit is already routed to Claude upstream; if one reaches us, its
      machine preamble must not count as designer prose)
  3. remove every http(s) URL          /https?:\/\/[^\s]+/g
  4. remove HI_FI vocabulary            — REUSE the exported HI_FI patterns, do NOT
                                          duplicate the list (see below)
  5. remove BARE_IMPORT_PHRASES         — the new, small list below
  6. collapse to alphanumerics+spaces   /[^A-Za-z0-9]+/g → " ", trim
  7. return { residue, length: residue.length }
```

**Step 4 must reuse, not re-list.** `HI_FI_PATTERNS` in `fidelityDirective.ts` is
currently module-private. Export it as `HI_FI_PATTERNS` (or add
`stripHiFiVocabulary(s: string): string` beside `detectHiFiIntent`) and consume it. A
second copy of the faithful-copy vocabulary is the exact drift failure that
`src/lib/scopedEdit.ts` was created to end — see its doc comment. **Do not create a
second list.**

**Step 5 — `BARE_IMPORT_PHRASES`, new and deliberately small.** These are the phrases
whose *entire* meaning the deterministic importer already implements, so removing them
loses nothing:

```
/\bimplement(?:\s+(?:this|it|both))?(?:\s+(?:screen|frame|page|design)s?)?\b/i
/\bimport(?:\s+(?:this|it|these|them))?(?:\s+from\s+figma)?\b/i
/\bbring\s+(?:this|it|these|them)\s+in\b/i
/\b(?:re-?create|recreate|reproduce|transcribe)\s+(?:this|it|these|them)\b/i
/\bcop(?:y|ies|ied|ying)\s+(?:this|it|them|these)\b/i
/\bbuild\s+(?:this|it)\b/i
/\bgrab\s+(?:this|it)\b/i
/\bthis\s+(?:screen|frame|page|design)\b/i
/\bfrom\s+figma\b/i
/\bfor\s+me\b/i  /\bplease\b/i  /\bthanks?(?:\s+you)?\b/i  /\bok(?:ay)?\b/i  /\bnow\b/i
```

Every one is anchored to a determiner or an object. Bare stopword stripping ("the", "a",
"is", "of") is **explicitly rejected**: measured, it shrinks the genuine correction #1
from 63 → 46 chars and shrinks descriptive prose by a similar factor, i.e. it destroys
signal on both sides without improving separation.

### The threshold, and why length alone is NOT the decision

Measured (see verification (a)):

- **bare-import variants** (21 realistic phrasings incl. `"Implement this precisely: <url>"`,
  `"import this <url>"`, `"bring this in <url>"`, a bare URL, `"1:1 please"`,
  `"copy this exactly"`, `"implement both screens precisely"`) → residue **0–26 chars**,
  and 18 of 21 are exactly `3` (the token left where the URL was).
- **corpus prompts carrying real instructions** → **63+** (`#1`=63, `#22`=101, `#23`=108,
  `#30`=124, `#25`=141, `#32`=141, `#2`=172, `#15`=402, `#3`=851).
- **committed must-stay-deterministic descriptive prose** → up to **84**, with **20 of 32
  above 32**. Measured, not estimated — see §9 item 1 for the cost this imposes.

So there are two clean facts and one dirty band:

| residue | meaning | action |
|---|---|---|
| `<= 32` | **provably** no instructions — nothing but import boilerplate survived | **L1 SETTLES IT: deterministic import, unchanged, zero added latency** |
| `> 32` | *some* designer language survived. May be an instruction (#1=63, #25=141, #30=124, #32=141) or may be faithful-copy description (`"the spinner animates in the prototype but keep it static now"`=60) | **fall through to L2 → L3 → L4.** Length does NOT decide. |

`PROSE_GATE_THRESHOLD = 32`. Justification: it sits above the maximum observed
bare-import residue (26, from `"high-fidelity implementation of this <url>"`) and far
below the minimum observed instruction-bearing residue (63), with 6 chars of headroom on
the low side and 31 on the high side. **Boundary behaviour is explicitly asymmetric:
`residue.length <= 32` → import; `> 32` → keep going.** At exactly 32 we import (the
larger risk at the boundary is a false *cascade* on a bare import — it costs latency on
the product's fast path — not a false import, because the cascade's own layers still
default correctly).

**This is the honest core of the design.** The dirty 63–84 band is precisely why layer 4
exists. The prose gate is a **cheap NO-instructions proof**, not an instruction detector.
It never claims a turn IS a correction; it only certifies when a turn provably is not.
Any future attempt to "tighten the threshold" so it separates 63 from 84 is re-inventing
keyword detection with a ruler and must be rejected.

### Signature

```ts
// studio/server/figma/proseGate.ts — pure, host-agnostic
export interface ProseGateResult {
  /** The surviving designer language, normalised. "" when nothing survived. */
  residue: string;
  /** residue.length — the measured quantity the threshold compares. */
  length: number;
  /** true when length <= PROSE_GATE_THRESHOLD: provably no instructions to lose. */
  bareImport: boolean;
}
export const PROSE_GATE_THRESHOLD = 32;
export function proseGate(prompt: string): ProseGateResult;
```

---

## 2. LAYER 2 — PROVENANCE

**New module:** `studio/server/figma/provenance.ts` — pure logic + an **injected**
frame-source accessor. No filesystem import, no Studio path.

### The question

> Is the pasted node ALREADY present in a frame this project has rendered?

If yes, this turn is an **EDIT of that frame**, and we know the frame by name — no
language understanding required. That is corpus #1 exactly: it pasted
`node-id=5678-118877`, which frame `01-figma-5678-118876` already contains.

### The injected accessor (this is what makes it host-agnostic)

```ts
/** One rendered frame, as the host can see it. `slug` is whatever the host calls
 *  the frame; `source` is the rendered file's text. Nothing Studio-specific. */
export interface FrameSource {
  slug: string;
  source: string;
  /** Optional: the Figma node this frame was imported from, if the host knows it
   *  independently of the source text (Studio: the frame slug / LIFT.json). */
  importedFromNodeId?: string;
}
/** The host supplies the frames. Studio reads them off disk; a Claude-Code host
 *  can hand over files it already has in context. */
export type FrameSourceReader = () => Promise<FrameSource[]>;
```

Studio's binding lives in the middleware (§5), reads `frameDir(slug, f.slug)/index.tsx`
via existing `server/paths.ts` helpers, and is the ONLY place a Studio path appears.

### Matching — three sources, in priority order

Verification (b) proved one grep is not enough. Check, in order, and stop at the first
source that yields a match:

1. **Attribute-exact `data-figma-id`.** Build the matcher from the normalised node id and
   require attribute equality, not substring:
   `new RegExp('data-figma-id="' + escapeRegExp(nodeId) + '"')`.
   This is what rejects the nested-instance form: `data-figma-id="I5678:118877;5346:75923"`
   does NOT match `data-figma-id="5678:118877"`. **A substring search would false-positive
   on all 5 nested ids in the live frame.**
2. **Nested-instance containment**, only if (1) found nothing: a node pasted from inside
   an instance has id `I<host>;<inner>`. Match `data-figma-id="I<nodeId>;` (prefix, colon
   form) to find the frame that contains the *host* instance. Report this as a
   `nested` match kind so callers know it is a containment, not an identity, hit.
3. **Host-declared import origin** — `importedFromNodeId`, and the frame-slug form
   `figma-<nodeId with non-alnum → '-'>` (`kitEmitBranch.ts:140`). This is what catches
   the **frame's own root node**, which verification (b) proved is absent from
   `index.tsx`. Re-pasting the original URL is a completely ordinary designer move; without
   this source, provenance misses it.

### Node-id normalisation — reuse `parseFigmaUrl`, verified sufficient

`server/figmaCli.ts:7-16` `parseFigmaUrl` already: rejects non-`figma.com` hosts, extracts
the file key from `/file|design|proto/`, reads `node-id`, and **normalises dash → colon**
(`nodeParam.replace(/-/g, ":")`). The `&t=<share token>` is simply not read. Confirmed by
the existing dedup comment at `chat.ts:799-805`, which relies on exactly this. **Do not
write a second parser.** Emitted attributes use the colon form
(`data-figma-id="5678:118877"`, verified), so `parsed.nodeId` compares directly.

The frame-slug form needs the reverse transform (colon → dash, lowercased) — the single
place that transform lives is `frameNameFromNode` in `kitEmitBranch.ts:140`; export it
rather than re-deriving.

### It MUST refuse to guess

Naming the WRONG frame is worse than naming none — the generator would confidently edit
a frame the designer wasn't talking about. So:

- **0 matches** → `{ kind: "none" }`. Cascade continues to L3/L4. **Never invent a target.**
- **exactly 1 match** → `{ kind: "exact" | "nested" | "origin", frameSlug }`. This is the
  only case that names a frame.
- **2+ matches** → `{ kind: "ambiguous", candidates: string[] }`. **Does NOT name a
  frame.** Passes the candidate list to L4 as part of the question, because "which of
  these two frames did you mean?" is precisely a question a model can answer and a grep
  cannot. (Live check: frames `01` and `02` in `implement-this-precisely-3` share **zero**
  node ids — `comm -12` on their id sets is empty — so ambiguity is rare in practice, but
  a designer who imports the same node twice creates it immediately.)

### Signature

```ts
export type ProvenanceMatchKind = "none" | "exact" | "nested" | "origin" | "ambiguous";
export interface ProvenanceResult {
  kind: ProvenanceMatchKind;
  /** Set ONLY for exact | nested | origin. Never set for none | ambiguous. */
  frameSlug?: string;
  /** Set only for ambiguous. */
  candidates?: string[];
}
export async function locateNodeProvenance(
  nodeId: string,                 // colon form, from parseFigmaUrl
  readFrames: FrameSourceReader,  // injected — no Studio path here
): Promise<ProvenanceResult>;
```

Cost: reading N frame files + N regex tests. On the live project that is 3 files / ~19KB.
The "~1ms" in the cascade sketch is the matching; the file read dominates and is still
sub-10ms. Guard it: if `readFrames()` throws, treat as `kind: "none"` and continue — a
provenance failure must never fail a turn.

---

## 3. LAYER 3 — CONSTRAINTS

**New module:** `studio/server/figma/turnConstraints.ts` — pure, host-agnostic.

### Vocabulary

This is the ONE place a keyword list is legitimate, and the reason is categorical: a
single-frame constraint is not a speech act, it is a **named, closed requirement** that
designers state literally and emphatically. Verified against the corpus — 4 prompts state
it, all literally:

```
#2  "don't separate these screens onto multiple frames, the transition must happen within this single frame"
#30 "DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!"
#31 "You just imported the reference design as a separate frame `Frame 36 7860` — use that as a reference"
#39 "You've made ticket page a separate frame — don't do that. Instead, it should open as a tab in the main frame"
```

Patterns (case-insensitive):

```ts
const SINGLE_FRAME_PATTERNS = [
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+frame/i,
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+(?:these|those|the)?\s*screens?/i,
  /\b(?:multiple|separate|different|two|new)\s+frames?\b[^.!?]{0,30}\b(?:don'?t|do\s+not|no|never)\b/i,
  /\b(?:within|in|on)\s+(?:this|the|one|a)\s+single\s+frame\b/i,
  /\b(?:same|one|single)\s+frame\b/i,
  /\bkeep\s+(?:it|this|everything|them|both)\b[^.!?]{0,30}\b(?:one|single|same)\s+frame\b/i,
  /\bas\s+a\s+tab\b[^.!?]{0,40}\bmain\s+frame\b/i,
];
```

Note `/\b(?:same|one|single)\s+frame\b/i` deliberately matches the committed must-miss
string `"keep everything on a single frame"` — that is **correct** as *detection*, because
that prompt IS a single-frame constraint.

**But be honest about what it does to routing.** That string's residue is **33** — one
char over the gate — so it reaches L3, and L3's divert (cascade step 7) sends it to
`claude` rather than the importer. That is a fidelity regression on a prompt that is
essentially a faithful-copy ask, and it is a **known, accepted boundary case**, not an
oversight: the designer did write an instruction, and the whole premise of this design is
that we stop discarding instructions. Do NOT "fix" it by tightening the constraint
patterns — the constraint detection is right; the tightness of the boundary is the cost.
The test plan asserts this outcome explicitly so a future change has to argue with it
rather than silently flip it.

**Scope guard (hard constraint 2).** `classifyFigmaTurn` returns `"claude"` for every
prompt with no Figma URL (`turnRouting.ts:81`). A gate written as
`figmaKind === "claude" && hasSingleFrameConstraint` therefore also fires on ordinary
non-Figma prompts. That exact mistake already shipped a directive telling a designer
"Do NOT create a new frame directory" in response to `"New screen: an error state with a
Try again button"`. **Every new gate is scoped to `hasFigmaNode === true`**, and the test
plan includes a no-URL prompt.

### The directive text

```
<single_frame_constraint>
The designer explicitly asked for this to stay in ONE frame. This overrides every
other instruction about frames, including the flow-splitting and <FrameLink> rules in
CLAUDE.md.

- Do NOT create a new frame directory. Do NOT add a second frame for the second state,
  screen, or step — even when the request describes a transition between two screens.
- Build every referenced state INSIDE the existing frame, switched by React state
  (useState + conditional render / CSS transition). A click that "goes to" another screen
  is an in-frame state change here, NOT a <FrameLink>.
- Do NOT use <FrameLink> on this turn.
- If you genuinely cannot fit it in one frame, say so in ### Deviations and still do not
  create the second frame.
</single_frame_constraint>
```

### Where it attaches

In `runClaudeBranch`, in the **prompt region** (prompt text is obeyed harder than
`CLAUDE.md` — the reason `editContext.ts` exists), appended **after** the
`<figma_context>` blocks and after any `<edit_reference_designs>`, so it is the last word
before the model starts. Concretely: extend `enrichPromptWithFigmaContext` to accept the
constraint set and push the block onto `blocks` after the scoped-edit directive at
`chat.ts:855`, or append it to `ejectSuffix`-style at `chat.ts:1156`. Prefer the former —
it keeps all Figma-turn directives assembled in one function.

**It must also suppress the whole-frame hi-fi directive**, via the existing
`suppressHiFiDirective` flag (verification (e)) — see §5.

---

## 4. LAYER 4 — the RESOLVER SEAM (host-agnostic)

This is the part the headless constraint reshapes most. **The routing layer never calls a
model.** When the cheap signals are exhausted it returns a well-typed question; the host
answers.

### The QUESTION the routing layer returns

```ts
// studio/server/figma/resolveTurn.ts — pure types + the fallback logic. No I/O.
export interface TurnQuestion {
  /** The designer's prompt, verbatim, URLs included. */
  prompt: string;
  /** The Figma node(s) the prompt references, normalised (colon form). */
  nodeIds: string[];
  /** What layer 2 found. "none" and "ambiguous" are both unresolved — the whole
   *  reason we are asking. */
  provenance: ProvenanceResult;
  /** Frames the project already has, by slug — the only legal values for
   *  targetFrame in the answer. */
  knownFrames: string[];
  /** What layer 3 already decided deterministically, so the host doesn't re-derive it. */
  constraints: TurnConstraint[];
  /** The surviving designer language layer 1 measured (context for the host; it can
   *  read the full prompt too). */
  proseResidue: string;
}
```

### The ANSWER a host returns (zod-validated)

```ts
export const TurnAnswerSchema = z.object({
  kind: z.enum(["import", "edit", "wire"]),
  /** Required iff kind === "edit". MUST be one of question.knownFrames. */
  targetFrame: z.string().optional(),
  constraints: z.array(z.enum(["single-frame"])).default([]),
  /** One short sentence, for the narration line + telemetry. */
  reason: z.string().max(200).optional(),
});
export type TurnAnswer = z.infer<typeof TurnAnswerSchema>;
```

Post-validation checks, all in the pure layer (a host cannot be trusted to get these right):

- `kind === "edit"` with no `targetFrame`, or a `targetFrame` not in `knownFrames`
  → **treat the whole answer as invalid** → generator fallback. A hallucinated frame name
  is the "names the wrong frame" failure §2 exists to prevent; it must not sneak in
  through the resolver.
- `kind === "import"` is only honoured when `constraints` is empty **and** L3 found no
  single-frame constraint. A host cannot talk us into discarding a constraint we already
  proved.
- L3's deterministic constraints are **unioned** into the answer's, never replaced.

### The injected interface

```ts
/** Answer a routing question. That is the entire contract. */
export type TurnResolver = (q: TurnQuestion) => Promise<unknown>;
```

One function, one argument, returns something the pure layer validates. A host that knows
nothing about Studio can implement it in two lines. That two-line implementability IS the
acceptance criterion — if a host has to understand Studio internals, the seam is wrong.
(Same discipline as `LibraryAdapter`'s doc comment: minimal by design, do not grow it
without a surfaced reason.)

### Fallback direction — hard constraint 1, non-negotiable

```
no resolver supplied            → GENERATOR   (never the importer)
resolver throws                 → GENERATOR
resolver times out              → GENERATOR
resolver returns invalid JSON   → GENERATOR
resolver fails zod              → GENERATOR
resolver names an unknown frame → GENERATOR (answer discarded entirely)
```

**Always the generator, never the importer.** The generator at least reads the prompt; the
importer provably cannot. Falling back to the importer would recreate the original bug on
every resolver hiccup — a silent, invisible regression, which is the worst kind. Every one
of these six paths gets its own test.

When the fallback fires, L3's deterministic constraints **still apply** — they were derived
without the resolver and do not depend on it.

### Host A — Claude Code / Computer (the primary target): answer INLINE

The brain is already inside a model turn. The host reads the question and answers from the
turn it is already in:

```ts
const resolver: TurnResolver = async (q) => answerFromCurrentTurn(q);
```

Zero subprocess, zero credentials, zero added latency. This is the case the design exists
to serve, and it is the case that a `claude --print` spawn on the routing path would have
made impossible.

### Host B — Studio desktop (CLEARLY MARKED: Studio-only adapter)

> **This subsection is the ONLY Studio-specific code in the design.** Everything above is
> brain. `systemSynth.ts` is the precedent **for this adapter only** — it is NOT the model
> for the routing layer, and no subprocess may appear on the routing path.

**New module:** `studio/server/figma/adapters/studioCliResolver.ts`. Mirrors
`systemSynth.ts` (`server/figma/systemSynth.ts:190-226`) exactly:

- `resolveClaudeBin()` for the binary; args `["--bare", "--model", model, "--print"]`
- **prompt via STDIN, never argv** — argv after a multi-value flag gets swallowed by the
  CLI's argparser (`systemSynth.ts:197-201` documents the failure)
- model from `deps.model ?? process.env.ARCADE_STUDIO_SYNTH_MODEL ?? "sonnet"`
- **injectable `spawn`** so tests never call a real model — the whole reason
  `systemSynth.test.ts` is hermetic
- `SIGTERM` on timeout. Budget **8000ms** (telemetry: tiny-output turns land 5–12s; a
  resolver that takes longer than a short edit has lost its own argument). Timeout →
  generator fallback.
- reply → `extractJson` → `JSON.parse` → `TurnAnswerSchema.safeParse`. Any failure →
  generator fallback.

```ts
export function makeStudioCliResolver(deps?: {
  spawn?: (prompt: string) => Promise<{ text: string; exitCode: number | null }>;
  model?: string;
  timeoutMs?: number;
}): TurnResolver;
```

### The pure orchestrator

```ts
export async function resolveTurnOrFallback(
  q: TurnQuestion,
  resolver: TurnResolver | undefined,
): Promise<TurnAnswer>;   // never throws; returns kind:"edit"|"wire"|"import"
                          // or the generator default { kind: "edit"|... } per §5
```

Pure apart from calling the injected `resolver`. Every failure mode collapses to the
generator default. No `try` block in the caller.

---

## 5. WIRING

The routing decision stays **pure and host-agnostic**. Studio's bindings live in the
middleware and nowhere else.

### `turnRouting.ts` — grows an async sibling, keeps the pure core

`classifyFigmaTurn` has no I/O today and **keeps none**. Add:

```ts
export interface FigmaTurnPlan {
  kind: "kit-emit" | "wire" | "claude";
  /** Set when provenance or the resolver named a frame. Never guessed. */
  targetFrame?: string;
  constraints: TurnConstraint[];
  /** Which layer settled it — narration + telemetry + debugging. */
  decidedBy: "scoped-edit" | "no-node" | "prose-gate" | "provenance" | "constraints"
           | "resolver" | "resolver-fallback" | "legacy-intent";
}

export async function planFigmaTurn(
  inp: FigmaTurnInputs & { nodeIds: string[]; knownFrames: string[] },
  deps: { readFrames?: FrameSourceReader; resolver?: TurnResolver },
): Promise<FigmaTurnPlan>;
```

Cascade order inside `planFigmaTurn` (short-circuits, cheapest first):

```
1. !hasFigmaNode            → { kind:"claude", decidedBy:"no-node", constraints:[] }
                              ← unchanged from turnRouting.ts:81; the no-URL escape hatch
2. isScopedEditTurn         → { kind:"claude", decidedBy:"scoped-edit" }
                              ← unchanged from turnRouting.ts:86
3. L3 constraints           → computed EAGERLY (0ms, pure) so they survive every later
                              path, including resolver fallback
4. L1 proseGate.bareImport  → { kind:"kit-emit", decidedBy:"prose-gate" }
                              ← THE FAST PATH. No file reads, no resolver, no added latency.
                                #0 #37 #45 #53 exit here.
5. hasInteractionIntent && figmaUrlCount >= 2 → { kind:"wire", decidedBy:"legacy-intent" }
                              ← preserved verbatim from turnRouting.ts:88
6. L2 provenance (needs deps.readFrames)
     exact|nested|origin     → { kind:"claude", targetFrame, decidedBy:"provenance" }
                              ← #1 exits here: node 5678:118877 lives in 01-figma-5678-118876
     none|ambiguous          → continue
7. L3 found a constraint     → { kind:"claude", decidedBy:"constraints", constraints }
                              ← #2 and #30 exit here without paying for a resolver
8. L4 resolveTurnOrFallback  → map answer.kind; union L3 constraints; decidedBy
                              "resolver" or "resolver-fallback"
                              ← #25 #32 exit here (prose, no provenance, no constraint)
```

Note step 4 sits **after** the scoped-edit check and **before** everything expensive, and
step 5 preserves today's wire behaviour exactly so no currently-working turn changes shape.
`classifyFigmaTurn` stays exported and unchanged for the existing call sites/tests.

### `chat.ts` — the only place Studio paths appear

At the existing routing block (`chat.ts:322-330`), replace the `classifyFigmaTurn` call
with `await planFigmaTurn(...)`, passing the Studio bindings:

```ts
const plan = await planFigmaTurn(
  { ...existingInputs,
    nodeIds: figmaUrls.map(u => parseFigmaUrl(u)?.nodeId).filter(Boolean),
    knownFrames: (project.frames ?? []).map(f => f.slug) },
  { readFrames: makeStudioFrameReader(slug),        // ← Studio-only binding
    resolver: makeStudioCliResolver() },            // ← Studio-only adapter
);
const isKitEmitTurn = plan.kind === "kit-emit";
const isWireTurn    = plan.kind === "wire";
```

`makeStudioFrameReader(slug)` is a new tiny function in `chat.ts` (or
`server/figma/adapters/studioFrameReader.ts`) that uses `frameDir()` from
`server/paths.ts`. **It is the only Studio path in the whole feature.**

`handleStart` is already `async`, so awaiting is free. But note the ordering hazard: the
Bedrock preflight at `chat.ts:337` keys off `isKitEmitTurn`, so `plan` must be computed
before it. It already would be.

### `enrichPromptWithFigmaContext` — reuse the real seam

Thread the plan through so the hi-fi suppression is correct (verification (d)+(e)):

```ts
enrichPromptWithFigmaContext(prompt, images, narrate, {
  targetFrame: plan.targetFrame,
  constraints: plan.constraints,
})
```

Inside, extend the existing `scopedEdit` suppression to cover the new cases:

```ts
// chat.ts:796 today: const scopedEdit = isScopedEditTurn(prompt);
const suppressWholeFrame =
  isScopedEditTurn(prompt) ||
  Boolean(opts?.targetFrame) ||
  opts?.constraints.includes("single-frame");
// ...then pass suppressHiFiDirective: suppressWholeFrame (chat.ts:844)
```

This is required, not optional. `shouldUseHiFi`'s novel-design upgrade fires **even with
no hi-fi wording** (verified), and `buildHiFiDirective` then says *"each section has the
SAME number of rows, same order, as the PNG"* — i.e. build a fresh full frame. On a
single-frame or provenance-located edit that instruction actively causes the bug we are
fixing. The existing `suppressHiFiDirective` flag already covers both the digest-hit
(`chat.ts:938`) and digest-miss (`chat.ts:914`) branches, so reusing it is complete.

When `targetFrame` is set, also name it in the prompt region: extend
`buildEditContextBlock` (`server/editContext.ts`) with an optional
`Target frame: <slug> — edit this frame; do not create a new one.` line. That module is
already pure and already the canonical home for "this is an edit" discipline.

### Nothing on the routing path may touch Studio

Restated as a rule the reviewer can check: **`proseGate.ts`, `provenance.ts`,
`turnConstraints.ts`, `resolveTurn.ts`, and `turnRouting.ts` must not import
`server/paths.ts`, `node:fs`, `node:child_process`, `electron`, or read `process.env`.**
That is mechanically greppable and §7 makes it a test.

---

## 6. TEMPLATE CHANGE — `studio/templates/CLAUDE.md.tpl`

In scope: generator instructions travel to every host. Two edits, both minimal.

### Edit 1 — after line 549 (before the signal list at 551)

Insert:

```markdown
**An explicit in-frame instruction OVERRIDES every signal below.** If the prompt says to
keep things in one frame — "don't separate these screens", "within this single frame",
"DON'T IMPLEMENT THIS AS A SEPARATE FRAME", "as a tab in the main frame" — then do NOT
create a second frame and do NOT use `<FrameLink>`, no matter how strongly the phrasing
matches a signal pattern. Build the second state inside the existing frame, switched by
React state. The designer's explicit instruction is law; these patterns are only a default
for when the prompt is silent. (2026-08-06 designer session: the prompt *"When I click
Save, animate the transition to this screen … IMPORTANT: don't separate these screens onto
multiple frames"* matches signal pattern 3 below almost word for word, and the generator
split it into two frames — the one thing the prompt forbade.)
```

### Edit 2 — line 554, disambiguate the offending example

Replace:

```markdown
- "pressing Save goes to the confirmation" — wrap the Save button.
```

with:

```markdown
- "pressing Save goes to the confirmation" — wrap the Save button. But ONLY when the
  prompt has not also asked for one frame: "pressing Save transitions to this screen,
  all within this single frame" is an in-frame state change, not a `<FrameLink>`.
```

### Also touch line 545

Line 545 currently says `Do NOT ask first — the user has committed to multiple frames.`
Append: `— unless the prompt explicitly asks to stay in one frame, in which case add the
new step inside the existing frame.` Without this, the "create frames for new steps
without asking" rule still contradicts the constraint one screenful earlier.

**Belt and braces, deliberately.** The `<single_frame_constraint>` directive (§3) is the
primary mechanism because prompt-region text is obeyed harder than `CLAUDE.md`. But the
template is what a designer's *own* Claude Code session loads, where our directive may
never be assembled — so the template must be correct on its own.

---

## 7. TEST PLAN

Single file: `cd /Users/andrey.sundiev/arcade-prototyper && pnpm run studio:test <path>`.
Full suite (~90s, from repo root) before commit. **Baseline is 2461 passed / 0 failed —
any failure is ours.**

### L1 — `__tests__/server/figma/proseGate.test.ts`

- All 21 bare-import variants → `bareImport === true`. Includes
  `"Implement this precisely: <url>"`, `"import this <url>"`, `"bring this in <url>"`, a
  bare URL, `"copy this exactly"`, `"1:1 please"`, `"implement both screens precisely"`.
- Every string in the two committed must-miss lists in `__tests__/lib/figmaUrl.test.ts`
  → asserted on `residue`, **not** on a routing outcome (they overlap the 63–84 band by
  design; the guarantee they need is that L2/L3/L4 default correctly, tested below).
- Corpus: `#0 #37 #45 #53` → `bareImport === true`; `#1 #2 #15 #22 #23 #25 #30 #32 #3`
  → `bareImport === false`.
- Threshold boundary: a synthetic 32-char residue → import; 33 → cascade.
- Non-string / empty / null input → `bareImport === true` (nothing to lose).
- **Anti-drift:** assert `proseGate` produces identical residue for a prompt with the
  hi-fi phrase and without, proving it consumes `fidelityDirective`'s exported patterns
  rather than a private copy.

### L2 — `__tests__/server/figma/provenance.test.ts`

- **The real #1 case:** a `FrameSource` fixture containing the verbatim line
  `<div data-figma-id="5678:118877" style={{...}}>` → `{ kind:"exact",
  frameSlug:"01-figma-5678-118876" }`.
- **Nested-instance non-match:** a frame containing ONLY
  `data-figma-id="I5678:118877;5346:75923"` must NOT return an `exact` match for
  `5678:118877`. Must be `nested`, and must never be `exact`.
- **Root-node case:** a frame whose source has no `data-figma-id` for `5678:118876` but
  whose `slug` is `01-figma-5678-118876` → `{ kind:"origin" }`. This is verification (b)
  caveat 1 and would silently miss without step 3.
- **No match:** LLM-written frame source with zero `data-figma-id` → `kind:"none"`,
  `frameSlug` **undefined**. Assert the field is absent, not empty-string.
- **Ambiguity:** the same id in two frames → `kind:"ambiguous"`, `candidates.length === 2`,
  `frameSlug` **undefined**. Assert it refuses to name one.
- **Node-id forms:** URL with `node-id=5678-118877`, with `&t=<token>`, and colon form all
  resolve to the same match (proves `parseFigmaUrl` normalisation is doing the work).
- **Reader failure:** `readFrames` rejects → `kind:"none"`, no throw.

### L3 — `__tests__/server/figma/turnConstraints.test.ts`

- Fires on corpus `#2 #30 #31 #39` (verbatim text).
- Fires on `"keep everything on a single frame"` — **asserted as correct** detection, with
  a comment saying so, since that string is also in a must-miss list for a *different*
  detector. Also assert its ROUTING outcome (`claude`, `decidedBy:"constraints"`) and
  comment that this is the accepted boundary regression from §3, so a later change has to
  argue with it rather than silently flip it.
- Does NOT fire on: `"implement this precisely"`, a bare URL,
  `"add a confirmation step"`, `"build a 4-step onboarding flow"`.
- Directive text: contains `Do NOT use <FrameLink>` and `Do NOT create a new frame`.

### L4 — `__tests__/server/figma/resolveTurn.test.ts`

Six fallback paths, each its own `it`, each asserting **generator, never importer**:

1. `resolver: undefined` → generator
2. resolver throws → generator
3. resolver never resolves (timeout) → generator
4. resolver returns non-JSON garbage → generator
5. resolver returns JSON that fails zod → generator
6. resolver returns `kind:"edit"` with a `targetFrame` **not** in `knownFrames` → generator,
   and `targetFrame` is **undefined** in the plan (the hallucinated name must not leak)

Plus: a resolver returning `kind:"import"` while L3 found `single-frame` → the constraint
survives, and `import` is **not** honoured. And: L3 constraints present in the plan on
every fallback path.

### Studio adapter — `__tests__/server/figma/studioCliResolver.test.ts`

Injected `spawn` only; **no test may spawn a real model**. Assert: prompt arrives via
stdin not argv; non-zero exit → generator fallback; timeout SIGTERMs and falls back;
valid JSON reply → parsed answer.

### Routing integration — extend `__tests__/server/figma/turnRouting.test.ts`

- **The 4 currently-losing corpus prompts reach the model.** `#1 #25 #30 #32` →
  `plan.kind !== "kit-emit"`. Assert `decidedBy` too: `#1` → `"provenance"`,
  `#30` → `"constraints"`, `#25`/`#32` → `"resolver"`/`"resolver-fallback"`.
- **The bare ones stay deterministic.** `#0 #37 #45 #53` → `kind === "kit-emit"`,
  `decidedBy === "prose-gate"`. **And no I/O happened:** assert the injected `readFrames`
  and `resolver` spies were **never called** — that is the latency guarantee, and a plain
  outcome assertion would not catch a regression that quietly pays for a resolver.
- **A prompt with NO Figma URL is unaffected.** `"New screen: an error state with a Try
  again button"` → `kind === "claude"`, `decidedBy === "no-node"`, `constraints` empty,
  no `<single_frame_constraint>` anywhere. This is hard constraint 2 — the exact bug that
  already shipped once.
- **The fast path is preserved:** `"Implement this precisely: <url>"`,
  `"import this <url>"`, `"bring this in <url>"`, bare URL → `kit-emit`.
- **Wire behaviour unchanged:** interaction intent + 2 URLs → `wire`, same as today.
- **Scoped edit still wins:** `SCOPED_EDIT_MARKER` + 2 Figma URLs → `claude`,
  `decidedBy === "scoped-edit"`, with `readFrames`/`resolver` never called.

### THE HEADLESS TEST — `__tests__/server/figma/headlessRouting.test.ts`

**This test is the whole point of the design.** Call `planFigmaTurn` with `deps = {}` —
no `readFrames`, no `resolver`, no Studio anything — and assert:

- every corpus Figma prompt still produces a valid plan
- `#0 #37 #45 #53` → `kit-emit` (L1 alone settles them; the fast path does not need a host)
- `#30` → `claude` with `single-frame` (L3 alone settles it)
- `#1 #25 #32` → `claude` (generator fallback; **never** `kit-emit`)
- nothing throws

Plus a static import guard (the `runtime-deps.test.ts` pattern): read the source of
`proseGate.ts`, `provenance.ts`, `turnConstraints.ts`, `resolveTurn.ts`, `turnRouting.ts`
and assert none contains `server/paths`, `node:fs`, `node:child_process`, `electron`, or
`process.env`. Mechanical, cheap, and it is what stops the next well-meaning change from
quietly re-coupling the brain to the app.

### Template — extend `__tests__/server/templates` (or the existing tpl test)

Assert `CLAUDE.md.tpl` contains `An explicit in-frame instruction OVERRIDES` and that the
`"pressing Save goes to the confirmation"` line now carries the one-frame caveat. Cheap
guard against a future template rewrite silently dropping it.

### Full suite

`pnpm run studio:test` from the repo root. Expect ≥ 2461 passing, 0 failing.

---

## 8. HEADLESS AUDIT

| Module | Verdict | Why |
|---|---|---|
| `server/figma/proseGate.ts` | **brain** | Pure string math. No I/O, no paths, no env. Runs identically in any host. |
| `server/figma/turnConstraints.ts` | **brain** | Pure regex + a template string. |
| `server/figma/provenance.ts` | **brain** | Pure matching logic. All file access is behind the injected `FrameSourceReader`; the module never names a path. |
| `server/figma/resolveTurn.ts` | **brain** | Types, zod schema, and fallback logic. Calls only the injected `TurnResolver`. Never spawns. |
| `server/figma/turnRouting.ts` (extended) | **brain** | `planFigmaTurn` is pure apart from the two injected deps. `classifyFigmaTurn` stays pure and unchanged. |
| `templates/CLAUDE.md.tpl` (edited) | **brain** | Generator instructions travel to every host — this is the highest-leverage brain surface we have. |
| `server/figma/adapters/studioFrameReader.ts` | **Studio-only adapter** | Must touch `server/paths.ts` to read `frames/<slug>/index.tsx`. Justified: reading files IS host-specific; the seam keeps it to ~10 lines and one import. A Claude-Code host implements the same interface over files it already has. |
| `server/figma/adapters/studioCliResolver.ts` | **Studio-only adapter** | Spawns `claude --print`, which presumes a CLI binary + Bedrock credentials — a Studio fact. Justified only because it is BEHIND the seam and off the routing path. A Claude-Code host answers inline instead and never loads this file. |
| `server/middleware/chat.ts` (wiring) | **Studio-only** | It already is the Studio host. Constructs both adapters and passes them in. The only file where Studio paths and the routing layer meet. |

**Nothing in this design can only work inside the desktop app.** The two Studio-only
modules are both adapters behind a one-function seam, and the headless test in §7 proves
the cascade produces correct plans with neither of them present. If a future change makes
a brain module import a Studio path, the static guard in §7 fails the build.

---

## 9. WHAT THIS DOES NOT FIX

Honest limits. Each is a real gap, not a hedge.

1. **The 33–84 residue band is genuinely ambiguous and stays ambiguous — and this is the
   biggest cost of the design.** Measured with the final strip list: **20 of the 32
   committed must-stay-deterministic strings land above the threshold** (residue 33–84,
   e.g. `"the spinner animates in the prototype but keep it static for now"` = 60,
   `"Implement this precisely — the connection-failed state with a Try again button and
   the illustration on the left"` = 84). Every one of them falls off the fast path into
   the cascade. With no provenance hit and no constraint they reach the resolver — and
   **on a host with no resolver they go to the generator, losing the deterministic
   fidelity guarantee**: slower, and less faithful than today.

   That is a real regression, consciously accepted, because the alternative (raise the
   threshold to 85+) would pull corpus `#1` (residue 63, a genuine correction — the very
   prompt this whole branch exists to fix) back onto the importer, re-creating the exact
   bug. `#22`/`#23` are safe either way: they already reach `claude` today via
   interaction/build intent, independently of the prose gate. **The distributions overlap;
   there is no threshold that gets both right.** The trade is: a
   *rare* fidelity regression on long descriptive prose, for a *common* instruction-loss
   fix. Whether that trade is right is a product judgement, and it should be re-measured
   after the live gate. If it turns out badly, the correct fix is a better resolver, not
   a better ruler.

   Note also `"keep everything on a single frame"` sits at residue **33** — one char over
   the threshold. It reaches L3, which correctly identifies the single-frame constraint,
   so the outcome is right. But it is a reminder of how tight the boundary is.

2. **Provenance is blind on every frame written before 2026-07-13.** `data-figma-id`
   landed in commit `95f2ae8`; verified absent from four older live projects. It is also
   absent from every LLM-written frame, forever — only the deterministic importer stamps
   it. So L2 helps on importer-produced frames only, which happens to be the dominant
   Figma-import lane, but "the designer is correcting an LLM-built frame" gets no
   provenance signal at all and falls through to L4.

3. **Provenance cannot see the frame's own root node in the source.** Handled via the
   frame-slug / `importedFromNodeId` fallback (§2 source 3), but that only works for frames
   whose slug encodes the node — i.e. importer-produced ones. An LLM-built frame that
   happened to implement a node has no recoverable link.

4. **We do not detect corrections.** Deliberately. `#1` is caught by *provenance*, not by
   understanding that it is a complaint. A correction about a frame with no provenance
   signal and no constraint reaches the resolver at best, and the generator at worst. The
   generator at least reads the prompt — which is the whole improvement — but no layer here
   *knows* a turn is a correction. That remains a model-side judgement.

5. **The resolver's answer is not verified against the outcome.** If the resolver says
   `edit 01-foo` and the generator edits `02-bar`, nothing notices. Closing that needs the
   render-verification work, which is disabled behind flags (see
   `render-measurement-multipage-blocker`).

6. **`single-frame` is the only constraint.** The `TurnConstraint` union is deliberately
   one-valued. Other real asks in the corpus — "use our components", "as a new tab next to
   Canvas" — are not modelled and flow to the generator as prose. Growing the union needs
   its own corpus evidence, not a guess.

7. **No live gate has run.** Every claim here is from source reading, the committed corpus,
   real frame files on disk, and the app's own telemetry. **The `.dmg` has not been rebuilt
   and no designer has typed a prompt through this cascade.** Given this project's history
   (jsdom-blind tests passing while multi-page measurement was broken live; the import hook
   silently dead in the DMG), a manual gate on real prompts is required before this is
   called done — and it should be run in a **Claude Code host**, not just Studio, since
   that is the target.

8. **Latency on the L2 path is unmeasured.** Reading N frame files is sub-10ms on the live
   3-frame project. A designer with 30 frames pays 30 file reads on every non-bare Figma
   turn. Cap it (frames only, `index.tsx` only, skip files over ~1MB) and measure before
   assuming it is free.
