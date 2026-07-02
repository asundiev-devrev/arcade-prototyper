# Figma-precise generation: always-on faithfulness directive + eject-to-source composites

Date: 2026-07-02
Branch: `feat/figma-export-v1` (or a new `feat/figma-fidelity-eject`)
Status: design — approved in brainstorming, pending spec review

## Problem

Three consecutive attempts at the same prompt ("Implement this design precisely …
based on the empty state of ComputerScene … full-screen input … purple theme on
all UI") all produced frames that were nowhere near the Figma design. Root-cause
investigation (transcripts + saved ingest records + code) found **two independent,
both-blocking defects**. Neither is the Figma file size — size only made the first
one fail loudly.

### Defect A — the faithfulness directive vanishes on any slow/failed Figma fetch

`enrichPromptWithFigmaContext` (studio/server/middleware/chat.ts) loads the Figma
digest, races it against a **15s** timeout, and on miss does `return { prompt, images }`
— bailing **before** the code that appends the high-fidelity directive. The directive
is built only inside the success path (after `buildFigmaContextBlock`).

Consequence: on a slow digest (big file) OR a failed digest, the agent receives the
**raw prompt with no screenshot and no directive**. The directive is the text that
says "the screenshot is ground truth — reproduce it section by section, do NOT invent,
do NOT restyle." Without it, the agent freelances.

Evidence (attempt 3, clean small file, transcript
`3b572664-…`): first user message = 901 chars, `IMAGES: 0`, `<figma_context>: False`,
`<high_fidelity_mode>: False`. The agent fetched the PNG itself and *saw* the flat
purple text-canvas design — then still built a blurred glassmorphism modal overlay,
because nothing told it to stay faithful.

Secondary: even when the directive *does* fire, its self-fetch commands are landmined
on large files — it tells the agent to run `get-nodes --depth 4` (411KB → exceeds the
256KB / 25K-token Read cap, attempt 2) and export a full `--scale 2` PNG (30s timeout,
attempt 2). Both are the exact commands that failed in attempt 2's transcript.

### Defect B — composites are sealed; "modify the composite" is impossible

`ComputerScene` (studio/prototype-kit/composites/ComputerScene.tsx) is a monolith. Its
props expose only `state | withCanvasPanel | headerTitle | user* | activeSessionId |
sessions | chatInputPlaceholder | onOpenSettings`. The sidebar, header, chat input,
body, and all colors are hardcoded internally. There is no way to replace the input,
restructure the body, or recolor surfaces through props.

The CLAUDE.md template compounds this: it forbids reading composite source (line ~192)
and directs the agent to "copy-and-mutate the reference frame by overriding props"
(line ~296) — guidance that only works for the handful of props that exist.

Consequence: "use ComputerScene as a base and modify it" is unsatisfiable. The agent
can only render `<ComputerScene state="empty" />` untouched and float new UI on top —
which is exactly the modal-overlay hack all three attempts produced.

The user's intent: **ComputerScene is a starting point, not a fixed artifact.** If it
can't be edited, it's useless as a base.

## Goals

1. The faithfulness directive reaches the agent on **every** precise-build turn,
   regardless of whether Studio's Figma digest loaded in time.
2. The directive's self-fetch instructions are **cap-safe** on large files.
3. A prompt that asks to modify/restructure/recolor a composite gets an **editable
   copy** of that composite in the frame folder, with populated content intact.
4. Recoloring the whole UI (sidebar, header, canvas, nav) is done via **design-token
   overrides**, not per-surface inline hacks — so it scales to composites the agent
   never touched.

## Non-goals

- Fixing the Enterprise-gated Figma **Variables** API (`variables unavailable`). That's
  a DevRev-plan limitation, not ours; the token-override approach (Goal 4) sidesteps it
  by having the agent read colors from the PNG and write them into `theme-overrides.css`.
- Raising the node/depth caps in `compactTree` (500 nodes / depth 12). Out of scope;
  the PNG + directive carry fidelity, not the summary tree.
- Auto-recursive "deep eject" of an entire composite tree by default (see Part 2).

---

## Part 1 — Always-on faithfulness directive

### 1.1 Decouple the directive from the data fetch

In `enrichPromptWithFigmaContext` (chat.ts), restructure so the directive is appended
based on **prompt intent + URL alone** (no digest required):

- Compute `wantsHiFi = shouldUseHiFi(prompt, …)` and the parsed `{fileKey, nodeId}`
  up front — these need no network.
- Attempt the digest as today (15s race), but treat its result as **enhancement only**.
- Assemble the enriched prompt in layers:
  1. Original prompt.
  2. If digest succeeded: `<figma_context>` block + attach the PNG to `images`.
  3. If `wantsHiFi`: **always** append `buildHiFiDirective({ fileKey, nodeId,
     hasReferencePng })`, where `hasReferencePng` reflects whether step 2 actually
     attached one.

Result: on a digest miss, the agent still gets the directive with
`hasReferencePng: false`, which already instructs it to export + read its own PNG.

### 1.2 Make the directive's self-fetch cap-safe

Edit `buildHiFiDirective` (studio/server/figma/fidelityDirective.ts):

- Replace the `get-nodes --depth 4` instruction with a **cap-safe read recipe**:
  - Start at `--depth 2`; if the output is persisted-to-file (too large), read it in
    chunks with offset/limit or grep for the subtree of interest — never attempt to
    Read a >256KB dump whole.
  - Drill deeper only into one named subtree at a time.
- Replace the `--scale 2` PNG export with **`--scale 1`** (smaller, avoids the 30s
  export timeout on large frames) and keep the "fetch the URL with curl, then Read the
  PNG" steps. Note scale-1 is sufficient for visual ground truth.
- Add an explicit line: **"If a fetch fails (timeout / too large), do NOT give up and
  invent the UI — retry shallower, and build from whatever portion of the PNG you did
  read. A faithful partial beats a confident fabrication."**

### 1.3 Optional: widen the digest race for precise turns

Low-risk improvement (not strictly required for correctness once 1.1 lands): when
`wantsHiFi`, extend the race from 15s toward ~45–60s with live narration, so the
screenshot is more often present at agent start. Kept optional because 1.1 already
guarantees the directive; this only improves how often the *pre-attached* PNG is there.

### Testing (Part 1)

- Unit (fidelityDirective.test.ts): directive contains `--scale 1` not `--scale 2`;
  contains the cap-safe read recipe (`--depth 2`, chunked/offset read); contains the
  "retry shallower, don't fabricate" line.
- Unit/integration (chat-figma-context or a new enrich test): with the digest stubbed
  to time out, a hi-fi prompt still yields an enriched prompt containing
  `<high_fidelity_mode>` and `hasReferencePng:false` phrasing. With the digest
  succeeding, the prompt contains BOTH `<figma_context>` and `<high_fidelity_mode>` and
  an attached image.

---

## Part 2 — Composites as an editable starting point

Two mechanisms, chosen per the kind of change the prompt asks for.

### 2.1 Recolor via design tokens (no eject)

The whole kit reads color from CSS variables (`--surface-backdrop` window,
`--surface-shallow` sidebar, `--surface-overlay` body, `--fg-neutral-*` text, etc.).
Each frame already loads a per-project `theme-overrides.css` (seeded empty by
`createProject`, injected by `frameMountPlugin`).

**Change:** teach the agent (CLAUDE.md.tpl) that a request to "apply theme X to all the
UI / recolor the sidebar+canvas+nav" is satisfied by **overriding the design-token
variables in `theme-overrides.css`**, reading the target colors from the Figma PNG.
This reskins every composite — including ones never ejected — in one place. Inline
per-surface gradients are called out as the wrong approach (what all 3 attempts did).

No new server machinery; `theme-overrides.css` and its injection already exist.

### 2.2 Eject-to-source for structural change (on demand, named + agent-extendable)

**When:** a build-intent turn (detected by the existing `generationIntent.ts`) that
names a composite as a base to *modify/restructure* — "modify the ComputerScene
composite", "use that composite as a base". Recolor-only asks do NOT trigger eject
(they take 2.1).

**Eject helper (new, server-side — `server/figma/ejectComposite.ts` or similar):**
Given a composite name and a target frame dir:
1. Copy `prototype-kit/composites/<Name>.tsx` (or `templates/<Name>.tsx`) into the
   frame folder as `<Name>.tsx`.
2. Rewrite its imports to frame-legal specifiers:
   - `./Foo.js` and `../templates/Foo.js` → collapse to named imports from
     `"arcade-prototypes"` (verified: all 9 of ComputerScene's relative deps —
     ArtefactCard, ComputerSidebar, ComputerHeader, ChatInput, ChatEmptyState,
     ChatMessages, CanvasPanel, CanvasTabs, ComputerPage — exist in the barrel).
   - `"@xorkavi/arcade-gen"` → `"arcade/components"`.
3. Leave the frame's `index.tsx` to import the **local copy** (`./ComputerScene`)
   instead of the barrel.

The ejected copy carries all populated content (rosters, seed transcript, canvas items)
so the agent keeps the "batteries included" scene while being free to edit every line:
swap the bottom `ChatInput` for a full-canvas field, restructure the body, etc.

**Depth = one level, agent-extendable (NOT blanket deep-copy):**
- Default: eject only the **named** composite. Its children stay as `arcade-prototypes`
  barrel imports. This covers "replace the input / restructure the scene body / swap
  which children are used" — the common case.
- If, while editing, the agent finds a **specific child whose own *shape* must change**
  (not just its color — color is 2.1), it ejects **that child too, on demand**, via the
  same helper. This is the "eject a bunch of parts" case, reached only when genuinely
  needed, one file at a time — never an automatic 8–10-file copy.

**Import validation:** local `./<Name>` imports are untracked by
`validateArcadeImports.mjs` (it only checks `arcade/components` + `arcade-prototypes`),
so ejected files pass. The ejected file's *rewritten* barrel imports are validated
normally — a good guardrail that the rewrite produced real export names.

### 2.3 Teach the template (CLAUDE.md.tpl)

Add a focused section, "Modifying a composite (eject-to-source)":
- Recolor → `theme-overrides.css` token overrides (2.1). Never inline per-surface hex.
- Restructure → the ejected local copy is the surface to edit; editing/reading ITS
  source is allowed (a scoped exception to the "never read composite source" default,
  which still holds for un-ejected kit composites).
- Eject more children only when a child's shape (not color) must change.
- The eject is performed by Studio before the turn when the trigger fires; the prompt
  will name the local path. If the agent decides it needs another composite ejected, it
  says so / uses the helper path convention.

### Testing (Part 2)

- Unit (ejectComposite): rewrites all 9 ComputerScene relative imports to
  `arcade-prototypes`; rewrites `@xorkavi/arcade-gen` → `arcade/components`; output
  contains no `./*.js` or `../templates/*.js` specifiers; the copied file still parses.
- Integration: a build-intent + "modify ComputerScene" prompt causes an
  eject (frame folder contains `ComputerScene.tsx`) and the injected prompt names the
  local path. A recolor-only prompt does NOT eject.
- Regression: full studio suite green; the existing generationIntent + figma-routing
  tests still pass.

### Manual acceptance (the real gate — live app, real Figma)

Re-run the attempt-3 prompt against the clean file in the running app:
- Frame folder has an editable `ComputerScene.tsx`; `index.tsx` imports it locally.
- `theme-overrides.css` carries purple token overrides; sidebar + header + canvas +
  nav all render purple (not just an inline orb).
- The bottom chat input is replaced by a full-canvas editable text field pre-filled
  with the daily-brief text, matching the PNG's flat text-canvas layout (not a floating
  modal).
- Screenshot the result and compare side-by-side with the Figma PNG.

---

## Files touched

- `studio/server/middleware/chat.ts` — restructure `enrichPromptWithFigmaContext`
  (Part 1.1); trigger eject on modify-composite intent (Part 2.2 wiring).
- `studio/server/figma/fidelityDirective.ts` — cap-safe self-fetch (Part 1.2).
- `studio/server/figma/ejectComposite.ts` — NEW eject helper (Part 2.2).
- `studio/templates/CLAUDE.md.tpl` — recolor-via-tokens + eject-to-source guidance
  (Parts 2.1, 2.3).
- Tests: `__tests__/server/figma/fidelityDirective.test.ts`,
  `__tests__/server/figma/ejectComposite.test.ts` (new),
  `__tests__/server/middleware/chat-figma-context.test.ts`.

## Sequencing

Part 1 first (pure win, no new concepts, unblocks fidelity on every precise turn),
then Part 2 (eject helper + token guidance). Each part is independently shippable and
independently testable. Manual acceptance runs after both land.
