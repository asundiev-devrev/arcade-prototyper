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

1. **The writer is the wrong actor.** Learning is delegated to the model's
   judgment inside a turn whose own prompt says "speed matters", "do not
   ritualize", aim for 2–3 minutes. Bookkeeping loses to that instruction every
   time.
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
  product, and every correction they have confirmed — with no setup and nothing
  retyped.
- A confirmed correction stops recurring.
- The designer can see, edit, and delete what Studio believes about them.
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

### Routing rule (inverted from today)

Today the template instructs: ambiguous → write to the project file
([CLAUDE.md.tpl:151-152](../../../studio/templates/CLAUDE.md.tpl)). That is why
global holds one line and every new project starts cold. New default:

> A confirmed correction goes **global** unless it names something only this
> project has — a frame in it, this Figma file, this feature's copy.

Rationale: one library, one or two products, a narrow feature set. Taste
travels; only specifics do not.

Routing is decided by the **server** and shown on the confirm chip, not left to
model judgment. The designer can flip the level with one tap before confirming.
Cost of a misroute is one tap.

### Guards so global never starves

- The chip names the level out loud ("Remember globally: …") so the default is
  visible in use.
- The panel shows Global first, always. An empty Global after real use is a
  visible defect rather than silence.
- A near-duplicate fact **reinforces** the existing row (increments a hit count)
  instead of appending a second row. Global stays short and readable.

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
  hits: number;        // reinforcement count
  createdAt: string;   // ISO
  lastSeenAt: string;  // ISO — last time this fact was re-observed
  source: "confirmed" | "explicit";  // chip-confirmed vs `remember:` prompt
}
```

The recurrence gate needs one more store: a **prompt index** at the studio root
(global, a sibling of `projects/` like `generation-metrics.jsonl`), holding one
row per user prompt — the **typed span only** (see "Index what the designer
typed"), its normalized content words, project slug, timestamp. Global because
recurring preferences repeat *across* projects, which a per-project index cannot
see. Append-only, capped by row count. It stores a subset of text the app already
keeps in `chat-history.json`, so it raises no new data-sensitivity question.

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
renderer drops lowest-`hits`, then oldest `lastSeenAt`. Prompt size is bounded,
so memory can never become a latency problem.

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

*1b. Process directive.* The prompt instructs the *agent* about how to work
rather than what to draw: "don't do that", "read the file first — do not edit
from memory", "don't create a separate frame", "always/never …". These are rules
by construction and are candidates on first sight.

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

**The fix is structural: capture the typed span at composition time.** The shell
already composes prompt = machine preamble + typed text and knows the boundary
exactly — `buildTargetPreamble()`'s own contract is "the user's change lives in
their typed text; this block only tells the agent WHICH elements to touch"
([PromptInput.tsx:100-102](../../../studio/src/components/chat/PromptInput.tsx)).
So the shell records `typedText` alongside the composed prompt, and the prompt
index stores **only** `typedText`. Deterministic, no pattern list, cannot rot.

Consequence for build order: the prompt index must be populated from the shell,
which makes step 3 depend on a small client change, not just server work.
Prompts sent without a picker preamble are wholly typed and index as-is.

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
memory as outranking one-off prompt phrasing. The `phantomEditRetry` carve-out
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
| File exceeds size cap | Renderer drops lowest-`hits` then oldest `lastSeenAt`. Prompt size bounded. |
| Two turns finish concurrently | Per-file write queue (same discipline as the DS-sync per-attempt tmp fix). |
| A memory proves harmful | Delete in panel → effective next turn (no session churn needed). |
| Memory write lands mid-turn | Harmless: the in-flight turn keeps the context it started with; the next turn reads the new file. |

## How we know it worked

**Primary measure: recurrence rate falls after a memory lands.** For each
confirmed fact, compare how often the designer re-stated it in the N turns
*before* it was remembered against the N turns *after*. Memory works when that
rate drops toward zero. The prompt index built for gate 1a supplies both halves,
so the measure is free.

This must be stated carefully to avoid circularity: a row's raw `hits` count is
*not* the metric, because recurrence is also the detector — a high count means
"detected often", not "failing". The metric is the **before/after delta for a
specific fact**, which the detector cannot manufacture.

Two honest limits:

- A fact that is never proposed, or always dismissed, produces no signal at all —
  absence of data is not evidence of success. Track proposal and confirm/dismiss
  counts separately so a silent feature is distinguishable from a working one.
- This measures whether the designer stops repeating themselves. It does **not**
  measure visual fidelity to Figma, which remains unmeasured in this repo. This
  design does not claim to supply that metric.

**Manual gate:** create a fresh project, ask for one frame, confirm the first
pass reflects global Rules + Learned + Profile with nothing retyped.

**Regression gate:** the new memory files must appear in the rendered
`CLAUDE.md`; the renderer must respect its size cap; a near-duplicate fact must
reinforce rather than append. All assertable in the existing vitest suite
(`__tests__/server/...`).

## Build order

Each step ships independently and is useful alone.

1. **Inventory** — deterministic, no model, no network. Immediately fixes
   "ignores my own work". No dependency on anything else here.
2. **Panel + editing** — makes existing memory visible and correctable. Would
   have caught today's dead memory. Depends on step 1 only for the read-only
   "Built here" section; ship without it if step 1 slips.
3. **Correction capture** — typed-span index (needs a small shell change) → gate
   → extract → chip, global-first routing, reinforcement. Requires the JSON row
   store; the panel (step 2) is strongly recommended first so a bad memory is
   correctable before any can be created. Highest-risk step: its detector is the
   part with the least evidence behind it, so it should ship behind a flag and be
   dry-run first (log candidates without showing chips) against real use.
4. **Brief + Profile** — local derivation first, Computer on top. Independent of
   steps 1–3.
