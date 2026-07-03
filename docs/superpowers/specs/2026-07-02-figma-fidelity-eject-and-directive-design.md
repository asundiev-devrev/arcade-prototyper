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

- Compute the always-append decision from **`detectHiFiIntent(prompt)` directly**, and
  parse `{fileKey, nodeId}` up front — both need no network.
  - **Gate-signature note (review S3.1):** do NOT call `shouldUseHiFi(prompt, ctx)` for
    the always-append decision. `shouldUseHiFi` needs a `HiFiGateContext {classified,
    hasHighConfidenceComposite}` that only exists when the digest succeeded; its
    novel-design branch (`classified && !hasHighConfidenceComposite`) is a digest-derived
    *upgrade*. On a digest miss there is no context, so the base decision must be the
    context-free `detectHiFiIntent`. When the digest DID succeed, still run the
    `shouldUseHiFi` upgrade so a novel design with no explicit "precisely" also gets the
    directive. Net: `appendDirective = detectHiFiIntent(prompt) || (digestOk &&
    shouldUseHiFi(prompt, ctxFromDigest))`.
- Attempt the digest as today (15s race), but treat its result as **enhancement only**.
- Assemble the enriched prompt in layers:
  1. Original prompt.
  2. If digest succeeded: `<figma_context>` block + attach the PNG to `images`.
  3. If `appendDirective`: **always** append `buildHiFiDirective({ fileKey, nodeId,
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
  PNG" steps.
- **Split the roles of PNG vs node-tree (review S3.2).** The PNG at scale 1 is legible
  for *layout and color* but NOT for reading small body copy verbatim. So the directive
  must state: **exact text content comes from the node tree's `characters` fields (read
  via the cap-safe recipe), NOT from OCR'ing the PNG; the PNG is ground truth for
  layout, structure, and color.** This removes the "is scale-1 legible enough?" risk —
  the agent never needs to read text off the image.
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

No new server machinery; `theme-overrides.css` and its injection already exist. BUT two
things must be fixed for the override to actually take effect (review B1 — verified
against `node_modules/@xorkavi/arcade-gen/dist/tokens.css`):

**(a) Selector specificity.** The base tokens are defined under `:root, :root.light {`
(line 99; `--surface-shallow` at 294) — specificity (0,2,0). The frame shell renders
`<html class="light">` and `DevRevThemeProvider` adds `.light`, so that selector is
live. A naive override written as `:root { --surface-shallow: … }` is specificity
(0,1,0) and **loses on specificity regardless of source order** — the purple silently
never applies (this is precisely the failure mode all 3 attempts showed). The template
guidance MUST instruct writing overrides at matching-or-higher specificity covering both
modes, e.g.:

```css
:root, :root.light, :root.dark { --surface-shallow: <purple>; … }
```

or `html.light, html.dark { … }`. A unit test should assert the generated/authored
override selector is not a bare `:root`.

**(b) Which tokens, and the indirection.** `--surface-shallow: var(--core-neutrals-200)`
— surfaces are indirected through the core palette. The agent must override the
**semantic** tokens (`--surface-*`, `--fg-*`), NOT the `--core-neutrals-*` primitives
(overriding a core primitive corrupts everything neutral). Because the Variables API is
Enterprise-gated (§ non-goals) the agent cannot enumerate tokens from Figma, so
CLAUDE.md.tpl must ship an **explicit short target list** for "recolor the whole UI":
`--surface-backdrop` (window), `--surface-shallow` (sidebar), `--surface-overlay`
(body/header), `--fg-neutral-prominent` / `--fg-neutral-subtle` (text), and the
info/accent ramp used for active states. Without this list, "read the colors and write
them" is the same open-ended guess that failed 3× — the agent knows the purple but not
which of ~40 tokens carries it. Sample the colors from the PNG (layout/color is what the
scale-1 PNG is FOR, per §1.2).

**Coverage:** §2.1 is NOT unit-testable end-to-end (real cascade only resolves in a
browser). The selector-shape check is unit-testable; the actual purple result is a
**manual render-and-screenshot gate** (see acceptance).

### 2.2 Eject-to-source for structural change (on demand, named + agent-extendable)

**When:** a build-intent turn (detected by the existing `generationIntent.ts`) that
names a composite as a base to *modify/restructure* — "modify the ComputerScene
composite", "use that composite as a base". Recolor-only asks do NOT trigger eject
(they take 2.1).

**Trigger must be a subset of `detectBuildIntent`, not a new detector (review M5).**
There are already two keyword detectors that fire on this prompt (`shouldGenerateFromFigma`
for routing, `detectHiFiIntent` for the directive). Adding a third, independent eject
detector risks the three disagreeing on the same prompt — e.g. the frame gets the
directive but no ejected file, or an eject with no directive. The eject trigger MUST be
computed as a **narrowed subset of `detectBuildIntent`** — specifically its
composite-naming patterns (the `modify/use…as base/based on…composite` rows) — plus the
extracted composite name. One source of truth; the eject fires only on the composite-
naming subset of build-intent, and it cannot diverge from the routing decision that sent
the turn to the Claude branch in the first place. It also needs a **name extractor**:
map the named composite ("ComputerScene") to a real kit file; if no known composite is
named, do NOT eject (fall back to normal generation).

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
   - **Rewrite must preserve import qualifiers (review M4):** carry through
     `import { Foo as Bar }` aliases (ComputerScene uses `Document as DocumentIcon`,
     line 60) and `import type { … }` / inline `type` specifiers (so a value-rewrite
     doesn't trip `verbatimModuleSyntax`). The regex/transform operates per-specifier,
     not by naive source-substring replace.
   - **`arcade/components` is NOT a verbatim passthrough (review M4):**
     `prototype-kit/arcade-components.tsx` re-exports arcade-gen but **overrides
     `Button`, `IconButton`, `ChatBubble`** with size-narrowed wrappers. ComputerScene
     imports `IconButton` from raw arcade-gen and uses `size="lg"`. After the rewrite it
     resolves to the wrapper — this is the intended behavior for frames (frames always
     use the narrowed versions), but it is a semantic change, not a pure 1:1 move. The
     test must assert the ejected file **renders** (not merely parses).
3. Leave the frame's `index.tsx` to import the **local copy** (`./ComputerScene`)
   instead of the barrel.

The ejected copy carries all populated content (rosters, seed transcript, canvas items)
so the agent keeps the "batteries included" scene while being free to edit every line:
swap the bottom `ChatInput` for a full-canvas field, restructure the body, etc.

**Where the full-canvas input actually goes (review S2 — verified against
`templates/ComputerPage.tsx:99-106`).** The reviewer worried the input's placement is
owned by the un-ejected `ComputerPage` and therefore a one-level eject can't produce a
full-canvas input. I checked: `ComputerPage` renders
`<div class="flex-1 min-h-0 overflow-y-auto">{children}</div>` then `{chatInput}` as its
sibling. The **body region IS the `children` slot** — which `ComputerScene` fills. So the
one-level eject IS sufficient for the motivating case: in the ejected `ComputerScene`,
the agent puts the full-canvas editable text field in the **`children` (body) slot** and
passes an **empty/omitted `chatInput`** — the input then occupies the whole canvas,
matching the PNG's flat text-canvas layout. It does NOT require ejecting `ComputerPage`.
The template guidance (§2.3) MUST state this explicitly, because the naive move — editing
the `chatInput` slot — yields a bottom bar (the reviewer's predicted "modal-hack in a new
disguise"). Ejecting `ComputerPage` is only needed if the sidebar/header/panel *frame
relationship* itself must change, which the motivating design does not require.

**Depth = one level, agent-extendable (NOT blanket deep-copy):**
- Default: eject only the **named** composite. Its children stay as `arcade-prototypes`
  barrel imports. This covers "replace the input / restructure the scene body / swap
  which children are used" — the common case.
- If, while editing, the agent finds a **specific child whose own *shape* must change**
  (not just its color — color is 2.1, and not the body/input relationship — that's the
  `children`-slot technique above), it ejects **that child too, on demand**, via the
  same helper. This is the "eject a bunch of parts" case, reached only when genuinely
  needed, one file at a time — never an automatic 8–10-file copy.

**Import validation:** local `./<Name>` imports are untracked by
`validateArcadeImports.mjs` (it only checks `arcade/components` + `arcade-prototypes`),
so ejected files pass. The ejected file's *rewritten* barrel imports are validated
normally — a good guardrail that the rewrite produced real export names.

### 2.3 Teach the template (CLAUDE.md.tpl)

Add a focused section, "Modifying a composite (eject-to-source)":
- Recolor → `theme-overrides.css` token overrides (2.1). Never inline per-surface hex.
  Include the **exact override selector** (`:root, :root.light, :root.dark { … }`, NOT
  bare `:root` — review B1) and the **target-token list** (`--surface-backdrop`,
  `--surface-shallow`, `--surface-overlay`, `--fg-neutral-prominent`,
  `--fg-neutral-subtle`, active-state accent). Override semantic tokens, never
  `--core-neutrals-*`.
- Restructure → the ejected local copy is the surface to edit; editing/reading ITS
  source is allowed (a scoped exception to the "never read composite source" default,
  which still holds for un-ejected kit composites).
- **Full-canvas input** → put the input in the ejected scene's **body (`children`) slot**
  and omit `chatInput`; do NOT just edit the `chatInput` slot (that yields a bottom bar —
  review S2).
- **Text content** comes from the node tree's `characters`, not the PNG (review S3.2).
- Eject more children only when a child's shape (not color, not the body/input
  relationship) must change.
- The eject is performed by Studio before the turn when the trigger fires; the prompt
  will name the local path. If the agent decides it needs another composite ejected, it
  says so / uses the helper path convention.

### Testing (Part 2)

- Unit (ejectComposite): rewrites all 9 ComputerScene relative imports to
  `arcade-prototypes`; rewrites `@xorkavi/arcade-gen` → `arcade/components`; output
  contains no `./*.js` or `../templates/*.js` specifiers; **preserves the
  `Document as DocumentIcon` alias and any `type` qualifier** (review M4); the copied
  file **renders** under the frame aliases, not merely parses (catches the
  `arcade/components` wrapper-swap — review M4).
- Unit (theme override shape — review B1): the recolor guidance/helper produces an
  override selector that is NOT a bare `:root` (must include `.light`/`.dark` or `html`).
- Unit (trigger consistency — review M5): the eject trigger is the composite-naming
  subset of `detectBuildIntent`; a prompt that ejects also passes
  `shouldGenerateFromFigma` (never eject on a turn routed to the importer); a build-intent
  prompt that names NO known composite does not eject.
- Integration: a build-intent + "modify ComputerScene" prompt causes an
  eject (frame folder contains `ComputerScene.tsx`) and the injected prompt names the
  local path. A recolor-only prompt does NOT eject.
- Regression: full studio suite green; the existing generationIntent + figma-routing
  tests still pass.

### Manual acceptance (the real gate — live app, real Figma)

§2.1 (recolor) and the final visual match are **not unit-testable** — the CSS cascade
only resolves in a browser. This manual gate is REQUIRED before claiming Part 2 closes
the motivating case. Re-run the attempt-3 prompt against the clean file in the running
app:
- Frame folder has an editable `ComputerScene.tsx`; `index.tsx` imports it locally.
- `theme-overrides.css` carries purple token overrides on a `:root, :root.light,
  :root.dark` (or `html.light, html.dark`) selector; sidebar + header + canvas + nav
  all render purple (not just an inline orb, and not neutral because the override lost
  the cascade — review B1).
- The bottom chat input is replaced by a full-canvas editable text field (in the body
  slot, not a bottom bar) pre-filled with the daily-brief text from the node tree,
  matching the PNG's flat text-canvas layout (not a floating modal).
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

## Adversarial review — findings incorporated (2026-07-02)

Reviewed by the adversarial-document-reviewer; each finding verified against real files
before folding in:
- **B1 (blocking, verified):** flat `:root` token override loses the cascade to
  `:root, :root.light` (tokens.css:99/294) → §2.1 now mandates a `.light/.dark` selector
  + explicit target-token list. Was the true cause the 3 attempts couldn't recolor.
- **S2 (serious → resolved, verified):** full-canvas input does NOT need ejecting
  ComputerPage — the body is the `children` slot (ComputerPage.tsx:104). §2.2/§2.3 now
  say: put the input in the body slot, omit `chatInput`. One-level eject suffices.
- **S3 (serious, verified):** §1.1 now uses `detectHiFiIntent` (not `shouldUseHiFi`) for
  the context-free always-append decision; §1.2 splits PNG (layout/color) from node-tree
  (`characters` = text) so scale-1 legibility is a non-issue.
- **M4/M5 (minor, verified):** rewrite preserves alias/`type` qualifiers + notes the
  `arcade/components` wrapper-swap (test must render, not just parse); eject trigger is a
  subset of `detectBuildIntent`, never a divergent detector.
