# Studio agent memory — design

**Date:** 2026-07-27
**Status:** design approved, not built
**Area:** `studio/` (server + shell + prompt template)

## Problem

Every Studio generation behaves like a first meeting. In practice a designer
works inside one component library (Arcade), one or two products (DevRev), and a
narrow set of features. That standing context exists but is not used, so the
designer re-supplies it by hand every session.

Three concrete pains (designer-selected, in priority order):

1. **Repeat corrections** — the same fix is re-issued every session.
2. **Ignores the designer's own work** — rebuilds from scratch instead of reusing
   frames and composites already in the project.
3. **Missing product context** — the agent does not know which product/feature
   this is, so the first pass is generic.

Explicitly *not* a reported pain: taste drift (colors/density/tone varying
between runs). Not addressed here.

## Current state (verified 2026-07-26/27)

Memory already exists and is effectively dead.

- Two levels, seeded by `ensureMemoryStubs(dir, scope)`
  ([studio/server/memory.ts](../../../studio/server/memory.ts)):
  - global `~/Library/Application Support/arcade-studio/memory/`
    (`globalMemoryDir()`, [studio/server/paths.ts:110](../../../studio/server/paths.ts))
  - project `projects/<slug>/memory/` (`projectMemoryDir(slug)`,
    [studio/server/paths.ts:119](../../../studio/server/paths.ts))
- Each holds `RULES.md` (human-authored, agent never edits) + `LEARNED.md`
  (agent append-only).
- Both are injected into every turn as `@`-imports rendered into the project's
  `CLAUDE.md` from
  [studio/templates/CLAUDE.md.tpl:121-157](../../../studio/templates/CLAUDE.md.tpl)
  (the `## Memory` section, incl. a "memory protocol" the agent is told to follow).
- The global dir is granted to the subprocess via `--add-dir`
  ([studio/server/claudeCode.ts:249](../../../studio/server/claudeCode.ts)) so the
  agent can read *and* write it.

Observed result after ~7 weeks and 233 logged turns
(`generation-metrics.jsonl`): global `LEARNED.md` holds **one** line, dated
2026-06-04. All four project `LEARNED.md` files contain only their stub header.

### Why it never fills — three root causes

1. **The writer is the wrong actor — and in picker turns, is actively
   forbidden.** Learning is delegated to the model's judgment inside a turn whose
   prompt says "speed matters", "do not ritualize", aim for 2–3 minutes.
   Bookkeeping loses. Worse, in every element-picker turn the injected preamble
   states *"do not modify unrelated parts of the file **or other files**"* and
   *"A reply without a corresponding Edit or Write tool call is a failed turn"*
   ([src/lib/visualEditPreamble.ts:61,65](../../../studio/src/lib/visualEditPreamble.ts)) —
   which literally instructs the agent not to touch `LEARNED.md`. That is a
   prompt contradiction, not a defect of model judgment, and it is cheap to fix
   independently of this design (carve memory out of the "other files"
   prohibition).

   **Confound, stated honestly:** the "233 turns → 1 line" evidence does not by
   itself prove the model is the wrong writer. Those turns span **39 project
   slugs with a median of 2 turns each** (62% ≤3 turns), and only **4 of 12**
   project directories ever received a `memory/` dir at all — so most turns had
   no multi-turn history to learn from and, in many cases, no project file to
   write to. The real reason to move writes to the server is the one that stands
   on its own: **the designer must be able to edit, delete, and pin memories,
   which requires stable row identity.** That is a requirement, not an inference.
2. **The strongest signal is never read.** The designer's *next prompt* after a
   generation is the correction ("'All Knowledge' should work as a
   filter/select…" appears verbatim in a live `chat-history.json`). Nothing
   inspects it.
3. **Nothing tells the agent what is already in the project.** Frame summaries
   exist (`readFrameSummaries`,
   [studio/server/middleware/chat.ts:86](../../../studio/server/middleware/chat.ts)) but
   are sent **only** to the Computer agent
   ([chat.ts:1693](../../../studio/server/middleware/chat.ts)) and the drift check
   ([chat.ts:1508](../../../studio/server/middleware/chat.ts)) — never to the
   generating agent. So pain 2 has no existing mitigation at all.

### Verified NOT a cause: stale `@`-imports on resumed sessions

An earlier draft of this design claimed memory writes cannot take effect
in-session, because Studio resumes one `claude` session across turns
(`--resume`, [studio/server/claudeCode.ts:340](../../../studio/server/claudeCode.ts))
and `CLAUDE.md` `@`-imports were assumed to resolve once at session start.

**Tested and false.** Against the real CLI (2.1.220): start a session whose
`CLAUDE.md` `@`-imports `memory/LEARNED.md`, ask for the remembered value, change
the file on disk, then `--resume` that same session and ask again. The resumed
session returns the **new** value — unprompted, with tools barred, in a single
turn (`num_turns: 1`, so it was in context, not fetched). Repeated twice with
different values.

Consequence: `CLAUDE.md` and its `@`-imports **re-resolve every turn**, including
on resume. A memory write is therefore live on the very next turn with no
intervention. This design needs **no** session invalidation, pays **no**
cold-cache or cost penalty, and causes **no** loss of conversation continuity.
The existing `clearAllProjectSessions` calls for kit changes are a different
mechanism (the kit rides in the cached `--append-system-prompt`, not in
`CLAUDE.md`) and are unaffected.

## Goals

- A brand-new project's **first** frame already reflects the designer's library,
  product, and the conventions they have confirmed — with no setup and nothing
  retyped. (Via global `RULES.md` / `PROFILE.md` and any promoted memories;
  project-specific facts stay with their project — see routing.)
- Fewer rounds of correction per prototype: **edits-per-build falls from its 3.13
  baseline.**
- The designer can see, edit, delete, and pin what Studio believes about them.
- Nothing added to the per-turn critical path: no extra latency, no new failure
  mode that can block a generation.

## Non-goals

- Team-shared / hosted memory (designer's call: personal now, shareable later;
  file format should not preclude a future export/import).
- Retrieval or embeddings over past turns.
- Auto-writing a memory without designer confirmation.
- Learning from anything but the designer's own words (no screenshot inference,
  no inferring taste from accepted output).
- Fixing taste drift.

## Approach

**Typed, server-owned memory.** Memory stops being free prose the agent
maintains and becomes four named kinds the *server* owns and renders into the
files the agent already imports. The agent's only memory duty is reading, which
the existing `@`-imports already do. The agent may *propose*; it never writes.

Steps 1–2 of the build order double as the cheap experiment that tests this
premise: ship Inventory + the panel, fix the picker-preamble contradiction above,
and observe whether the agent's own proposals become adequate once writing is
permitted and visible. If memory fills on its own, step 3's extractor is
unnecessary complexity and should not be built. Cost of finding out: one release
of observation.

Rejected alternatives:

- *Fix the writer* (keep prose `LEARNED.md`, add extractor + panel): rows have no
  stable identity, so panel edit/delete is unreliable, and it addresses none of
  pain 2.
- *Retrieval over history* (index turns, retrieve similar): strongest long-run
  but needs a store, embeddings, and a relevance metric that does not exist.
  Deferred.

## The two levels (load-bearing)

```
GLOBAL   ~/Library/Application Support/arcade-studio/memory/
         Survives new projects, app updates, DMG reinstalls: it is a sibling of
         projects/ under the writable studio root, never inside the .app bundle.
         ├── RULES.md      standing instructions            (designer, by hand)
         ├── LEARNED.md    corrections that travel          (proposed → confirmed)
         └── PROFILE.md    library, products, area          (derived + Computer)   [new]

PROJECT  projects/<slug>/memory/
         ├── RULES.md      rules for this prototype only    (designer, by hand)
         ├── LEARNED.md    facts true only here             (proposed → confirmed)
         ├── BRIEF.md      this feature, this Figma file    (derived + Computer)   [new]
         └── INVENTORY.md  what is already built here       (server, deterministic)[new]
```

The designer's saved composites (`user-kit/`) are already global and stay where
they are; `INVENTORY.md` references them by name rather than duplicating them.

### Routing rule: project by default, global by earned promotion

> A confirmed correction goes to the **project**. It is offered for promotion to
> **global** only when the same fact recurs in a *second* project.

An earlier draft inverted this — global by default, on the reasoning that the
designer works in one library and a narrow feature set, so "taste travels".
**Measured against the real corpus, that is false.** Every recurring corrective
theme lives in exactly one project:

| Theme | prompts | distinct projects |
|---|---|---|
| use our kit components | 3 | **1** |
| don't make it a separate frame | 3 | **1** |
| replace hand-rolled with kit | 3 | **1** |
| resizable panels | 3 | **1** |
| no top divider | 3 | **1** |

Repetition is **within-project**, not cross-project. Global holds one line today
because the agent never writes, not because routing starved it.

#### The failure global-default would cause

`polina-s-prototype` — 42 turns, the densest correction stream in the corpus, so
the project most likely to generate memories — opens with a prompt that
deliberately departs from house style: *"re-implement this design using our
components … there are a few meaningful differences … Left nav has clear
differentiation … It's different to our current template for the left nav in
Computer. You can copy the existing `ComputerSidebar` and modify it."*

Under global-default: corrections from that project ("chat panel must be
resizeable", "no top divider for the input", "photos instead of initials") name
no frame and no Figma file, so they pass the project-specificity test and route
global. The designer confirms — each is true *in that project, at that moment*.
Weeks later a conventional DevRev vista project injects them into its first
frame, applying one experiment's conventions as house style.

The cost is **not** "one tap". It surfaces weeks later, in a different project,
as unexplained wrong output, with nothing on screen connecting it to memory —
i.e. it re-creates pain 1 by means of the fix for pain 1. The asymmetry is the
point: a project-default misroute costs a re-teach in the next project (visible,
local); a global-default misroute silently contaminates every future project.

Promotion on second-project recurrence replaces the assumption that taste travels
with a measurement of whether it did. Routing is decided by the **server** and
shown on the chip; the designer can still promote manually with one tap.

### Guards so global still fills

Global must not starve — it is what makes a *new* project non-cold. With
project-default routing, three mechanisms feed it:

- **Promotion on second-project recurrence** (above) — the main path, and the
  only one backed by evidence.
- **`RULES.md` and `PROFILE.md` are global and hand-authored.** The facts that
  genuinely span projects in this corpus are conventions ("use our kit
  components", "read the file first") and profile facts (library, products) — both
  better stated once by the designer than inferred from corrections. The panel
  makes writing them a first-class action.
- **The chip always names its level**, so the designer can promote at confirm
  time when they already know a fact is general.

The panel shows Global first, always: an empty Global after real use is a visible
defect rather than silence.

A near-duplicate fact **reinforces** the existing row instead of appending a
second one, so memory converges rather than sprawls.

## The four kinds

| Kind | Answers | Written by | Cost when wrong |
|---|---|---|---|
| Rules (exists) | "always do X" | designer, by hand | designer edits it |
| Learned | "you corrected me on Y" | agent proposes → **designer confirms** | a bad standing instruction |
| Brief / Profile | "this is DevRev Knowledge, for support agents" | derived + Computer | generic first pass |
| Inventory | "this project already has 6 frames + your SkillCard" | server, deterministic | rebuilds existing work |

## Data model and storage

Each learned level is stored as a small JSON file the server owns, and
**rendered** to the `.md` file the agent imports. The JSON gives rows stable
identity (for edit/delete/reinforce); the markdown keeps the prompt side
unchanged and human-readable.

```
memory/
├── learned.json     server-owned rows      (source of truth)
└── LEARNED.md       rendered from learned.json  (what the agent imports)
```

Row shape:

```ts
interface LearnedRow {
  id: string;          // stable, server-assigned
  fact: string;        // one sentence, designer-confirmed wording
  level: "global" | "project";
  hits: number;        // dedup/reinforcement count — NOT a value score
  pinned?: boolean;    // designer-pinned: never evicted
  createdAt: string;   // ISO
  lastSeenAt: string;  // ISO — last time this fact was re-observed
  source: "confirmed" | "explicit";  // chip-confirmed vs `remember:` prompt
  seenInProjects: string[];  // slugs — drives promotion to global on the 2nd
}
```

The recurrence gate needs one more store: a **prompt index** at the studio root
(global, a sibling of `projects/` like `generation-metrics.jsonl`), holding one
row per user prompt — the **typed span only** (see "Index what the designer
typed"), its normalized content words, project slug, timestamp.

Stored globally even though recurrence is measured within-project, because the
index has a second job: detecting when a fact recurs in a *second* project, which
is what earns promotion to global. A per-project index cannot see that. Scoring
still compares within-project first; the cross-project comparison exists only to
offer promotion.

Append-only, capped by row count. It stores a subset of text the app already keeps
in `chat-history.json`, so it raises no new data-sensitivity question.

Hand-editing `LEARNED.md` directly is tolerated but not authoritative: the next
render regenerates it from JSON. The panel is the supported edit path, and the
panel writes JSON. (Accepted trade-off: `RULES.md` stays plain markdown with no
JSON twin, because it is hand-authored by design and no code needs row identity
in it.)

Migration: on first run of the new code, an existing `LEARNED.md` with content
is parsed line-wise into rows (`source: "confirmed"`, `hits: 1`) and the file
re-rendered. One line exists in the wild, so this is cheap and low-risk; a parse
failure leaves the file untouched and logs.

Size ceiling: each rendered file has a hard character cap. Past the cap the
renderer drops by **oldest `lastSeenAt`**, and never drops a `pinned` row.

**Eviction must not key on `hits`.** An earlier draft did, which inverts the
priority exactly: a memory that *works* — stated once, corrected, never recurred
— has the lowest `hits` and would be evicted first, while a row at ×5 (which by
this design's own reading means memory is *failing* for that fact) is the most
protected. `hits` is a dedup counter and nothing else; it is not a value score,
and per "How we know it worked" it is not the success metric either.

## Correction capture

Runs **after** the turn's subprocess exits, in the existing post-turn slot
(`maybeSeedAfterTurn`, [studio/server/middleware/chat.ts:409](../../../studio/server/middleware/chat.ts)).
That slot exists precisely because background model calls contending with the
turn's own call caused the "model has gone quiet" symptom; memory extraction
inherits the same discipline and the same idle guard.

**Stage 1 — gate (no model, free).** Two independent triggers. A prompt that
fires neither costs nothing.

Both triggers run on the **typed span only** — see "Index what the designer
typed" below. This is load-bearing, not a detail: gating on the final prompt
learns Studio's own boilerplate.

*1a. Recurrence.* The typed span resembles something this designer has typed
before, in this or any other project. Similarity is lexical (normalized
overlap of content words against the prompt index) — no model, no embeddings.
Recurrence, not vocabulary, is what earns a chip: a thing said once is a tweak;
a thing said three times is a preference.

*1b. Process directive.* The typed span instructs the *agent* about how to work
rather than what to draw: "don't do that", "don't create a separate frame",
"use our components", "always/never …". These are rules by construction and are
candidates on first sight. (Note "read the file first — do not edit from memory"
is *Studio's* text, not the designer's — see below.)

Any keyword list used here must be derived from the real corpus and its measured
recall stated, not written from intuition. Evidence for that discipline: an
earlier hand-written list omitted **`must`**, which appears in 19 real prompts —
by far the designer's most common directive word — while including `actually`,
`no, make it`, `too big/small` and `why did you`, which fire **zero** times in
seven weeks of use.

Plus explicit `remember:`, which bypasses both.

### Why not a keyword gate (measured, 2026-07-27)

An earlier draft gated on corrective vocabulary (`actually`, `instead`, `should
be`, `too big/small`, `why did you`, …). Tested against the real prompt corpus
on this machine — 76 user prompts, 66 of them following a generation — it fails
in both directions:

- **False positives: 10 fired, almost none durable.** "The active icon button
  must have '@' icon instead of '+'" trips `instead` but is a one-off tweak to
  one button. Nothing to remember. These become chips the designer dismisses,
  which is how the feature dies of fatigue in week one.
- **False negatives: the durable ones are exactly what it misses.**
  - "You've made ticket page a separate frame — don't do that. Instead it should
    open as a tab" → a standing instruction about how flows get built (passes
    only incidentally, on `instead`).
  - "For some reason, changes aren't applied. The item is still misaligned" →
    repetition, the strongest available signal, invisible to keywords.
  - "Read the file(s) first — do not edit from memory" → typed repeatedly across
    projects. A textbook global rule. Never gated.

The lesson: durable preferences surface as **repetition and process
instruction**, not as corrective vocabulary. Corrective words track irritation,
which is orthogonal to durability. Hence 1a + 1b above.

### Index what the designer typed, not the prompt (measured, 2026-07-27)

Running the recurrence + directive gates over the raw 76-prompt corpus fires on
**37%** of prompts, and the hits are overwhelmingly *Studio's own boilerplate*:

- "Read the file(s) first — do not edit from memory. …" is injected by the
  element picker
  ([src/components/chat/PromptInput.tsx:126](../../../studio/src/components/chat/PromptInput.tsx))
  and the visual-edit preamble
  ([src/lib/visualEditPreamble.ts:58](../../../studio/src/lib/visualEditPreamble.ts)).
  It accounted for 10 of 14 directive hits.
- "Apply each change ONLY to the element identified by its line:column", "A reply
  without a corresponding Edit or Write tool call is a failed turn", `Target
  element:` blocks, `frames/…/index.tsx:41:7` locators — all machine-authored.
- Recurrence hits were then dominated by template similarity ("In
  frames/01-…/index.tsx, on the `<Button>` at line 241, …") or by consecutive
  prompts about the same feature, not by durable preference.

Learning any of these would be the worst available failure: Studio remembering
its own template as the designer's preference and re-injecting it into its own
prompts.

Regex-stripping the boilerplate was tried and rejected — it cut the rate but left
plenty behind, and the pattern list silently rots whenever picker copy changes.

**The fix is structural, in two parts.**

*1. Exclude element-picker turns outright.* A sentinel already exists and is
already recognized server-side: `SCOPED_EDIT_MARKER`
([src/lib/scopedEdit.ts:22](../../../studio/src/lib/scopedEdit.ts), re-exported as
`CLIENT_PREAMBLE_MARKER` in [server/editContext.ts:24](../../../studio/server/editContext.ts)).
Scoped- and visual-edit turns are pixel nudges at a specific line:column *by
construction* — the most one-off content in the corpus and the least likely to
carry a standing preference. Skip them for capture entirely. One-line check, no
pattern list.

*2. Index the typed span for everything else.* The shell composes prompt =
machine preamble + typed text and knows the boundary exactly —
`buildTargetPreamble()`'s own contract is "the user's change lives in their typed
text; this block only tells the agent WHICH elements to touch"
([PromptInput.tsx:100-102](../../../studio/src/components/chat/PromptInput.tsx)).
The shell records `typedText` alongside the composed prompt; the index stores
only `typedText`. Deterministic, cannot rot.

Consequence for build order: the prompt index is populated from the shell, so
step 3 includes a small client change, not just server work. Prompts sent without
any preamble are wholly typed and index as-is.

**Stage 2 — extract (one small model call).** Given the previous prompt + the
new prompt, return either nothing or exactly one candidate: `{ fact, level,
evidence }`. Two-sentence output; cheap and fast. Nothing in the turn depends on
it — on failure or timeout, silence.

**Reinforcement before proposal.** If the candidate near-matches an existing row
(either level), increment that row's `hits`, set `lastSeenAt`, and stop. No
chip. This keeps memory converging instead of sprawling.

Note this is *dedup only*, not the success metric — the recurrence gate (1a)
already uses repetition as its detector, so counting repetitions cannot also
prove the feature works. See "How we know it worked".

**Then the chip.** In the chat pane, under the finished turn:

```
Remember globally: prefer neutral gray for active nav rows
[ Remember ]  [ Project only ]  [ Dismiss ]
```

- Nothing is learned without a tap.
- `Dismiss` is persisted per project, so the same candidate is not re-offered
  there.
- At most one chip per turn; if two candidates surface, keep the stronger and
  drop the other.

**Explicit `remember:` bypasses stages 1–2.** The fact is written immediately
(`source: "explicit"`); the chip only reports where it landed.

## Brief, Profile, Inventory

### Inventory — deterministic, no model, no network

`projects/<slug>/INVENTORY.md`, regenerated after any turn that wrote a frame.
Built from a directory read plus the existing frame summarizer
(`summarizeFrameSource`, [studio/server/frameSummary.ts](../../../studio/server/frameSummary.ts))
and the user-kit manifest (`listComponents`,
[studio/server/componentStore.ts:54](../../../studio/server/componentStore.ts)):

```
Frames already in this project:
- 01-knowledge-list — list view, filter toolbar, uses VistaPage + Checkbox
- 02-filter-popover — popover menu, multi-select rows
Your saved composites: SkillCardAndrey
```

Cannot be wrong (it mirrors disk), costs nothing, and directly addresses pain 2.

### Brief — derived, refreshed on purpose, never mid-turn

`projects/<slug>/BRIEF.md`:

```
Feature: Knowledge — article list, filtering, bulk actions
Figma: AS - Knowledge (kJcKzhKL…)
From Computer: Knowledge articles in DevRev are org-scoped, can be linked to
  tickets, and have draft/published states.            [Computer · 2026-07-27]
```

Two sources:

1. **Local, free** — project name, the imported Figma file, recurring nouns
   across the project's prompts. Refreshed with Inventory.
2. **Computer (DevRev's own agent), on demand only** — one question: "what does a
   designer need to know about `<feature>` in DevRev?" Runs **only** on project
   creation and on an explicit Refresh in the panel. Never inside a generation
   turn: agent/620 is slow and 406s on heavy/slow runs, so a per-turn call would
   tax every frame.

Computer output is stored tagged `[Computer · <date>]` and is editable/deletable,
because Computer has fabricated answers before (notably about
account-scoped/ownership data). Product-level questions are its strength; nothing
personal or account-specific is asked. If unreachable, Brief keeps its local half
and shows "product context unavailable — retry"; generation is never blocked.

### Profile — the global twin

`memory/PROFILE.md`: library in use (Arcade), products, area. Seeded from the
first project's Brief, editable in the panel. Small, hand-correctable, injected
into every project.

## What reaches the model

Only via files the project's `CLAUDE.md` already `@`-imports — no new transport,
no change to `--append-system-prompt`, no per-turn prompt surgery:

```
global   RULES.md  LEARNED.md  PROFILE.md         ← every project, every turn
project  RULES.md  LEARNED.md  BRIEF.md  INVENTORY.md
```

The template's `## Memory` section grows two lines for the new global/project
files and its "memory protocol" subsection is **rewritten**: the agent no longer
appends to `LEARNED.md`. It reads memory, honors it, and (unchanged) treats
memory as outranking one-off prompt phrasing.

Also required, and independent of everything else here: the element-picker
preamble's *"do not modify unrelated parts of the file or other files"*
([src/lib/visualEditPreamble.ts:61](../../../studio/src/lib/visualEditPreamble.ts))
must carve out the memory directory, so that instruction stops silently
prohibiting memory writes during picker turns. Worth shipping in step 2 on its
own merits — it is a one-line prompt fix that may be a large part of why memory
never filled.

The `phantomEditRetry` carve-out
for "bare `remember:` turns touch only memory"
([studio/server/phantomEditRetry.ts:14](../../../studio/server/phantomEditRetry.ts))
must stay valid: with server-side writes, a bare `remember:` turn now changes
*nothing* on the agent side, so that turn must still be allowed to produce no
frame change.

### No session invalidation needed (verified)

A memory write requires **no** further action to take effect: `@`-imports
re-resolve every turn, including on `--resume` (see "Verified NOT a cause"
above). Write the file, and the next turn reads it. Do **not** clear
`sessionId` on memory writes — that would discard conversation continuity for
no benefit, since generation turns get their history only from `--resume`
(chat history is re-injected for Computer turns,
[chat.ts:1694](../../../studio/server/middleware/chat.ts), but never for the
claude generation branch).

`refreshStaleClaudeMd()` ([studio/server/projects.ts:429](../../../studio/server/projects.ts))
already backfills memory stubs for old projects and must be extended to seed the
three new files, so existing projects gain them without a reinstall. Note this
function *does* clear sessions when the rendered `CLAUDE.md` changes — that is
correct and unrelated (the template itself changed), and it happens at boot, not
per memory write.

## Panel

A third tab beside Chat and Assets, following the shipped Assets pattern
([studio/src/components/shell/LeftPaneTabs.tsx](../../../studio/src/components/shell/LeftPaneTabs.tsx),
[LeftPaneTabToggle.tsx](../../../studio/src/components/shell/LeftPaneTabToggle.tsx)).
No new shell layout.

```
┌─ Chat ─ Assets ─ Memory ──────────────────┐
│  ABOUT YOU                        Global   │
│  Library: Arcade · Products: DevRev   ✎    │
│                                            │
│  ALWAYS (your rules)              Global   │
│  • Never use emoji in UI copy              │
│  + add a rule                              │
│                                            │
│  LEARNED                          Global   │
│  • Neutral gray for active nav rows   ×3   │
│  • Concise microcopy in empty states  ×1   │
│  ─────────────────────────────────────     │
│  THIS PROJECT — Knowledge                  │
│  Feature: article list, filtering     ↻    │
│  Knowledge is org-scoped, links to         │
│  tickets            [Computer · Jul 27]    │
│                                            │
│  LEARNED (here only)                       │
│  • Filter chips go in the toolbar     ×2   │
│                                            │
│  BUILT HERE                                │
│  2 frames · 1 saved composite              │
└────────────────────────────────────────────┘
```

- Global on top, always — the level that must not starve is the one seen first.
- Row hover → delete; click → edit. `×N` is the hit count, showing which
  memories earn their place.
- Inventory is read-only (a mirror of disk). `↻` re-asks Computer.
- Any edit writes JSON, re-renders markdown, and clears sessions per the rule
  above.

## Failure modes

| Failure | Behavior |
|---|---|
| Extractor call fails / times out | No chip. Turn already ended; unaffected. |
| Gate fires on Studio's own boilerplate | Prevented by construction: the index holds only the typed span. If a machine preamble ever reaches the index, treat as a bug with a regression test, not a tuning problem. |
| Computer 406s or is slow | Brief keeps its local half + "unavailable, retry". Generation never blocked. |
| `LEARNED.md` hand-edited | Tolerated; next render regenerates from JSON. Panel is the supported path. |
| `learned.json` corrupt / unparseable | Treated as empty, file preserved as `.bak`, logged. Memory degrades to Rules-only; generation unaffected. |
| File exceeds size cap | Renderer drops oldest `lastSeenAt`, never a `pinned` row. Never keys on `hits` (that would evict what works). Prompt size bounded. |
| Two turns finish concurrently | Per-file write queue (same discipline as the DS-sync per-attempt tmp fix). |
| A memory proves harmful | Delete in panel → effective next turn (no session churn needed). |
| Memory write lands mid-turn | Harmless: the in-flight turn keeps the context it started with; the next turn reads the new file. |

## How we know it worked

**Primary measure — edits-per-build.** Ratio of `edit` turns to `build` turns,
already derivable from `generation-metrics.jsonl` with no new instrumentation.
Current baseline: **3.13** (147 edit / 47 build turns across 233 logged turns);
per-project it reaches 6.8 on the densest project. If memory works, the first
frame lands closer to intent and this ratio falls.

This is the metric because it has the three properties the alternatives lack: a
real denominator, no dependence on the detector, and the ability to move in the
*wrong* direction. It is a genuine product outcome — fewer rounds of correction
per prototype — not a self-report.

**Why `hits` is NOT the metric.** An earlier draft used "a confirmed correction
stops recurring", read off reinforcement counts. That is circular and biased
toward false success: recurrence is also the *detector*, so a row sits at ×1 for
six different reasons —

| Row sits at ×1 because | Memory is |
|---|---|
| memory worked; the correction stopped | working |
| the situation never came up again | untested |
| the gate missed the recurrence | **failing, invisibly** |
| the project ended | untested |
| the candidate was dismissed | n/a |
| the candidate was never proposed | **failing, invisibly** |

— and the untested cases are the *modal* case in this data: median **2 turns per
project**, 62% of projects ≤3 turns. Most rows would sit at ×1 because the
project ended, and the old metric would score that as success. Worse, the weaker
the detector, the fewer recurrences observed, the healthier the dashboard: a gate
that fires on nothing scores perfectly.

**Supporting instrumentation (required, currently absent).** Log every gate
evaluation (fired/not, which trigger) and every extractor outcome
(candidate/nothing), plus per-row **exposure** — how many turns ran in a project
where that row was injected (a join on `slug` in the existing metrics log). Then
"0 hits over 40 exposed turns" reads as working and "0 hits over 1 exposed turn"
reads as untested. Without this, a silent feature is indistinguishable from a
working one — the exact blind spot that let today's memory sit dead for seven
weeks unnoticed.

**Limit, stated plainly:** none of this measures visual fidelity to Figma, which
remains unmeasured in this repo. This design does not claim to supply that.

**Manual gate:** create a fresh project, ask for one frame, confirm the first
pass reflects global Rules + Profile (+ any promoted memories) with nothing
retyped.

**Dry-run gate before step 3 ships to anyone:** run the gate and extractor with
chips *suppressed*, logging candidates only, across a week of real use. Ship the
chip only if the logged candidates read as things worth remembering. This design's
detector has been wrong twice already under measurement (keyword gate, then
boilerplate contamination), so it does not get to reach the designer unobserved.

**Regression gates** (all assertable in the existing vitest suite,
`__tests__/server/...`):

- the new memory files appear in the rendered `CLAUDE.md`;
- the renderer respects its size cap and never evicts a `pinned` row;
- a near-duplicate fact reinforces rather than appends;
- **eviction never keys on `hits`** (a ×1 row must outlive a ×5 row when it is
  more recent);
- **a scoped/visual-edit prompt never enters the prompt index** — the
  boilerplate-contamination guard, which is a correctness bug if it regresses,
  not a tuning knob.

## Build order

Each step ships independently and is useful alone.

1. **Inventory** — deterministic, no model, no network. Immediately fixes
   "ignores my own work". No dependency on anything else here. Highest
   value-per-risk in the document; ship it first regardless of what happens to
   the rest.
2. **Panel + editing + the picker-preamble carve-out** — makes existing memory
   visible and correctable, and stops the prompt from forbidding memory writes.
   Depends on step 1 only for the read-only "Built here" section; ship without it
   if step 1 slips.

   **Then stop and observe.** Steps 1–2 are also the experiment that tests
   whether step 3 is needed at all: with writes permitted and visible, does
   memory fill on its own? Record `edits-per-build` (baseline 3.13) before and
   after. If memory fills, step 3 is unnecessary complexity — do not build it.
3. **Correction capture** — *only if step 2's observation says it's needed.*
   Typed-span index (needs a small shell change) + `SCOPED_EDIT_MARKER` exclusion
   → gate → extract → chip, project-default routing with earned promotion,
   reinforcement, gate/extractor telemetry. Requires the JSON row store and the
   panel first, so a bad memory is correctable before any can exist. Highest-risk
   step: ships behind a flag, dry-run with chips suppressed before the designer
   ever sees one.
4. **Brief + Profile** — local derivation first, Computer on top. Independent of
   steps 1–3.

Note this ordering deliberately front-loads everything that cannot be wrong
(Inventory, visibility, a prompt fix) and gates the one speculative mechanism
behind evidence that it is still needed.
