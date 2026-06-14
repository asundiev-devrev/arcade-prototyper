# Handoff v2: Studio interactive-prototype-from-Figma

**Date:** 2026-06-12
**Supersedes:** `2026-06-10-figma-fidelity-handoff.md` (read that for the original
neutral framing; this doc adds everything proven since, including dead ends).
**Status:** Large exploration done. A working transpile engine exists and is
wired in, BUT it does not meet the bar. Recommendation at the end is to NOT
continue down the transpile path as the primary engine. Nothing here is
committed — all on branch `feat/figma-export-one-click`, uncommitted.

---

## The goal (restated precisely, after a session of drift)

A designer exploring a NEW direction imports a Figma design into Arcade Studio
and gets a **prototype that is BOTH (a) high-fidelity to the Figma AND (b)
built from the REAL component kit**. Today Studio's results are far from that,
so designers churn to Cursor.

**Both requirements are co-equal and must hold together — neither supersedes
the other.** A pixel-perfect wall of `<div>`s fails the bar; a kit-correct frame
that doesn't match the Figma fails the bar. The original problem statement
(verbatim from the kickoff prompt) was about FIDELITY — "when we generate from
Figma designs, the fidelity is far from pixel-perfection … designers churn to
Cursor … more visually accurate." The KIT-COMPONENT requirement was made
explicit later the same session. The goal is the conjunction of both.

Clarifications the owner gave THIS session:

1. **Fidelity = pixel-perfect to the Figma.** This is the original, primary
   complaint and is non-negotiable. The transpile work (below) essentially
   solves this half.

2. **Kit components, not divs.** The frame must be built from REAL kit
   components (`<Checkbox>`, `<IconButton>`, `<Tabs>`, …) instead of dead
   `<div>`s that merely look like them — a real kit Checkbox toggles, a real
   Tabs switches; behavior is baked into the component. ("Interactive" in the
   owner's words means THIS — real kit components — NOT multi-screen flows /
   navigation, which come separately from multiple frames + the prompt.)

3. **The metric that proves #2: kit-instance-vs-`<div>` ratio in the
   DOM/source.** A screenshot CANNOT prove it — a styled `<div>` and a kit
   `<IconButton>` are pixel-identical on screen. So fidelity is verified
   visually; kit coverage MUST be verified in the source. Both checks are
   required to claim success.

### Owner constraints (still in force)
- Map to the REAL production base library (`raw-design-system`), not arcade-gen
  directly — Code Connect was published pointing Figma components at
  `libs/design-system/shared/raw-design-system/...`. There is an existing
  raw-ds → arcade-gen name+prop correspondence in `studio/src/lift/mappings/`
  (primitives.ts, composites.ts) — this is the authoritative table.
- Large multi-frame boards are the COMMON case (designers import whole mockups).
  "Honest fail, point me at a sub-section" is unacceptable; the engine must
  handle them.
- Don't try to componentise the LAYOUT. Layout can be raw markup. Only the
  COMPONENTS should be kit. Leaf components with no kit equivalent may stay
  static.

---

## What was built this session (transpile engine) — facts

Approach taken: **transpile, don't reconstruct.** Pull Figma's own Dev Mode
codegen (`get_design_context`), download its assets locally, swap components to
the kit, write it as a Studio frame. All on branch
`feat/figma-export-one-click`, **uncommitted**, ~1400 lines across new modules
+ ~6 modified. Full test suite green (202 figma tests; the only failures
anywhere are the pre-existing `figmaBridge/wsServer.test.ts` port flake — ports
9223-9232 held by stray node debuggers, unrelated).

### New modules (studio/server/figma/)
- `devModeMcp.ts` — dependency-free streamable-HTTP MCP client for the Figma
  Dev Mode server at `http://127.0.0.1:3845/mcp`. Exports: `getDesignContext`,
  `getMetadata` (rootSize + `iconByNodeId` icon-recovery map + depth-1
  `children` for board splitting), pure `parseMcpSse` / `extractDesignContext`
  / `extractMetadata` / `extractRootSize`. Typed errors:
  `DevModeMcpUnreachableError`, `DevModeMcpToolError`, `DevModeMcpTooLargeError`.
- `transpileNormalize.ts` — pure transforms: asset-const→local-import, root
  `size-full`→fixed `w-[]/h-[]`, Figma font fallback (`'Chip_Text_Variable:Regular'`)
  → studio family (`'Chip Text Variable'`), and `neutralizeDanglingAssetRefs`
  (drops `src={X}` where X is never declared — Figma codegen emits these).
- `transpileAssets.ts` — DI'd downloader; writes assets under `assets/` or
  `assets/<subdir>/` (per-panel namespacing for composition), stable filenames,
  failure list.
- `transpileCodeConnect.ts` — consumes `<CodeConnectSnippet>` wrappers: strips
  the `libs/design-system/...` import, maps production name → arcade-gen name
  via `PROD_TO_ARCADE` (inverted from `lift/mappings/primitives.ts`), translates
  Figma-variant props → arcade-gen props (`variant="Tertiary"`→`"tertiary"`,
  `size="Default"`→`"md"`, `status={true}`→`"online"`, drops state-only props,
  recovers IconButton's dropped icon child from `iconByNodeId`). Has a
  `TRANSLATORS` set: IconButton, Avatar, Button, Checkbox.
- `transpileKitSwap.ts` — name/`data-name`-based fallback swap for instances
  Code Connect did NOT wrap. `swapKitIcons` (inline icon subtrees + helper
  components → kit icons via `ICON_NAME_TO_KIT`, with a visibility gate so
  fill-none placeholder icons aren't swapped to phantom glyphs) and
  `swapKitComponents` (IconButton/Avatar by `data-name`). `addKitImport`,
  `normalizeIconSetName` exported.
- `transpileCompose.ts` — `composeBoard`: stitches N transpiled panels into one
  frame, each absolutely positioned at its board x/y, with per-panel identifier
  namespacing (`P{i}_` PascalCase prefix on all top-level decls + asset imports
  + their refs) to avoid collisions.
- `transpile.ts` — `runFigmaTranspileBranch` orchestrator + recursive
  `transpileNode` (a too-large node splits into children, each transpiled
  recursively, then `composeBoard`; `MAX_SPLIT_DEPTH=6`).

### Wiring
- `chat.ts` `handleStart` (~line 182, 270): a turn with a Figma URL AND
  `detectHiFiIntent(prompt)` true routes to `runFigmaTranspileBranch` — a third
  branch beside `runComputerBranch` and `runClaudeBranch`. No LLM, no Bedrock.
- `compactTree.ts`/`resolveTokens.ts`/`promptBlock.ts`/`types.ts` changes are
  the EARLIER Phase-1 input-fix work (geometry/identity/token-warning/node-cap/
  PNG-scale) — they feed the OLD kit-reconstruction generator, independent of
  the transpile engine. Still valid, still uncommitted.

---

## Proven facts about the moving parts (live-verified)

1. **Figma Dev Mode MCP is reachable** from a plain Node process at
   `localhost:3845/mcp` (standard streamable-HTTP MCP; init → SSE + session id).
   `get_design_context` returns pixel-perfect React+Tailwind. **Only works when
   the Figma desktop app is running and the target file is reachable** — a node
   not in the active doc 404s with "make … the active tab."
2. **`get_design_context` is STRUCTURALLY a single static frame state.** No
   handlers, no interaction states, no flows. (This is why the assistant's
   mid-session detour toward "wire onClick/navigation" was wrong — not the goal.)
3. **Asset URLs expire (~7 days / localhost form dies when Figma closes).**
   `download_assets` + curl persists them locally — verified. Two URL shapes
   exist: `figma.com/api/mcp/asset/...` AND `http://localhost:3845/assets/...`;
   both must be handled.
4. **Transpiled code renders pixel-faithfully in a Studio frame** — confirmed by
   side-by-side after fixing: root sizing (was `size-full` → footer collapsed to
   top + wrong width), font fallback name, prose-block stripping (codegen
   returns code in content[0] + PROSE in later blocks; joining them broke the
   build). Tailwind v4 JIT + arcade-gen tokens + FrameFontProxy all cover it.
5. **Large boards: `get_design_context` returns sparse metadata + "too large,
   call on sub-layers" instead of code.** The recursive split→compose works:
   the live 1697×900 board (`10:4289`, file `41Jsf6MLsvu1TfSeftIq8M`) rendered
   all 3 panels (sidebar + chat panel + Issues table) composed at absolute x/y.
   Panels can themselves be too-large and split recursively (observed depth 4).
6. **The Code Connect consumption layer is CORRECT in isolation.** Fed node
   `10:3329` (table core) directly: 7/7 Checkbox snippets → 7 real kit
   `<Checkbox>`, 0 leftover. The parser/translator/import-rewrite all work.

---

## THE WALL (why this isn't meeting the bar) — the most important section

Measured on the live full-board render (`board7`):

| | count |
|---|---|
| raw `<div>` | **527** |
| kit components | **22** (and ~18 are non-interactive icon glyphs) |
| → **kit coverage ≈ 4%** | |

Components that SHOULD be kit but rendered as divs (by Figma `data-name`):
**14 Checkbox, 17 Avatar, 18 Avatar Group, 9 Icon Button, 11 _Item, 30 Cell,
plus tabs/toggles/rows.** Almost the entire interactive surface is dead divs.

### Why coverage is so low — two compounding root causes

1. **Code Connect coverage is partial AND non-deterministic per call.** Even for
   components that ARE mapped (Checkbox, Avatar have Code Connect entries),
   `get_design_context` only wraps SOME instances in `<CodeConnectSnippet>`, and
   **the same node returns snippets on one call and plain `data-name` divs on
   another** (proven: `10:3329` gave 7 checkbox snippets on a direct fetch, but
   board7's fetch of the same content — 4 levels deep in a long recursive
   sequence — returned them as divs, so 0 were swapped). You cannot consume what
   Figma didn't tag, and whether it tags is unreliable. Likely worse under load /
   on the too-large→split path.
2. **The `data-name` fallback swap (`swapKitComponents`) only covers
   IconButton + Avatar.** It was never extended to Checkbox, _Item, Cell, etc.
   So when Code Connect misses (cause #1), there is no backstop and the instance
   stays a div.

### The path NOT taken (the obvious next step, deliberately surfaced, not done)
Extend `swapKitComponents` to swap EVERY mapped component by `data-name`
(Checkbox, Avatar, Tabs, _Item→ComputerSidebar.Item, …) using the
`lift/mappings/` table — so kit coverage stops depending on whether Code Connect
wrapped each instance (snippet OR div both get swapped). This directly attacks
the 527-div problem and is the single highest-leverage change if the transpile
path continues. The blocker the original research flagged still applies: the
`data-name` for many instances is the designer's name (`_Item`, `Cell`), and
mapping those to kit components by geometry/name is the hard, lower-confidence
part — exactly where the first research workflow rated this approach risky.

---

## Honest assessment / where the assistant went wrong

- The goal is **fidelity AND kit components, together.** The session delivered
  fidelity (one half) and treated that as most of the win — repeatedly calling
  things "verified" on green tests + a screenshot, while never measuring the
  OTHER required half (kit-vs-div ratio) until the very end. It's ~4%. A
  screenshot can't catch this because divs and kit components look identical;
  both halves must be checked, and only one was.
- The transpile-from-`get_design_context` approach delivers the FIDELITY half
  cleanly but has a structural ceiling on the KIT half: it inherits Figma's
  flaky, partial Code Connect tagging, so only what Figma chooses to wrap
  becomes a kit component. The architecture nails fidelity and fights kit
  coverage. Meeting the bar means keeping the fidelity it achieves WHILE
  forcing kit coverage up by a mechanism that doesn't depend on Figma's tagging.

---

## Decision for the fresh session (open questions)

1. **Does the transpile engine continue at all?** It nails pixel-fidelity +
   board composition + handoff-honest imports where Code Connect fires. But kit
   coverage is ~4% and capped by Figma's unreliable tagging. Continue only if
   the `data-name`-fallback-swap-everything path (above) can lift coverage high
   enough — needs a spike to measure achievable % before more building.
2. **Or pivot back to the LLM generator (Studio's original engine), seeded by
   the transpile as a pixel-accurate canvas?** The original research's
   "scaffold-first" idea: deterministic transpile gives the exact-layout
   starting frame; the LLM's job becomes "replace these div-blocks with the kit
   components they represent" (its strength: semantic recognition + naming
   variance), NOT reconstruct-from-scratch (its weakness). The LLM swap pass is
   the natural backstop for Code Connect's gaps and the designer-named instances
   (`_Item`, `Cell`) that deterministic mapping can't confidently resolve.
   Risk: LLM drift — mitigated because the base is already pixel-correct and the
   diff is reviewable.
3. **Measure first.** Before committing either way, run a coverage spike: for
   the real board, what % of instances CAN become kit via (a) Code Connect only,
   (b) Code Connect + full data-name swap, (c) + an LLM pass? That number
   decides the architecture. Don't build more until it's known.

## Key files / pointers
- Transpile engine: `studio/server/figma/{devModeMcp,transpile,transpileCodeConnect,transpileCompose,transpileKitSwap,transpileNormalize,transpileAssets}.ts`
- Wiring: `studio/server/middleware/chat.ts` (handleStart dispatch ~line 182/270)
- Authoritative raw-ds↔arcade-gen mapping: `studio/src/lift/mappings/{primitives,composites}.ts` + `rawDs.ts` + `types.ts` (MappingEntry: studio.name=arcade-gen, production.name=raw-ds, with propDeltas)
- Existing `data-name` swap to extend: `studio/server/figma/transpileKitSwap.ts` (`swapKitComponents`, `ICON_NAME_TO_KIT`)
- Test live against: file `41Jsf6MLsvu1TfSeftIq8M`, board node `10-4289` (1697×900, 3 panels), sidebar `10-3508` (240×900), table core `10:3329` (Code-Connected checkboxes). REQUIRES Figma desktop open + Dev Mode MCP enabled + the file as active tab.
- `get_design_context` codegen intermittently stalls >170s (Figma-side; metadata stays instant). A board = several codegen calls, so stalls make board import slow/timeout. Client timeout is 60s; raise + cache per-node if continuing.
- Old kit-reconstruction generator (the alternative engine): `studio/server/claudeCode.ts` + `studio/templates/CLAUDE.md.tpl` + the Phase-1 input fixes in `compactTree.ts`/`resolveTokens.ts`/`promptBlock.ts`.
- Prior research artifacts: `docs/superpowers/scratch/*.mjs` (workflow scripts), `docs/superpowers/plans/2026-06-10-figma-fidelity-handoff.md`.
