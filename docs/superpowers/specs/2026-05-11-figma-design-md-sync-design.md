# Figma Design-System Sync (DESIGN.md)

**Status:** Draft
**Author:** asundiev (via Claude Code brainstorm, 2026-05-11)
**Branch target:** `feat/studio/figma-design-md-sync` (off `main`, independent of `feat/multiplayer-relay-foundations`)
**Scope:** `studio/` only

## Summary

When a Studio project first references a new Figma file, scan the whole file
(styles + variables + components + sample frame renders), synthesize a
`DESIGN.md` with a natural-language **Identity** paragraph plus six token
sections, and write it into the project directory. The project's
`CLAUDE.md` imports `DESIGN.md` via an `@DESIGN.md` line added to the
template, so the Claude CLI subprocess picks it up on every turn — giving
generation cross-frame personality anchoring and the full set of available
tokens, not just those used on the current frame.

## Motivation

Studio's existing Figma ingest (`server/figmaIngest.ts`) is per-node: tree +
local tokens + PNG, scoped to the selected frame. This means:

1. **Tokens absent from the current frame are invisible** to the generator
   (error reds, empty-state greys, secondary shadows), so it invents values
   when generating something the Figma didn't explicitly show.
2. **Visual personality is never communicated.** Token tables tell the LLM
   what values exist but not what the system *feels* like — dense vs. airy,
   utilitarian vs. friendly, flat vs. depth-heavy. The LLM's default
   aesthetic (soft corners, pastel gradients, generous whitespace) creeps
   back in whenever it has to make a judgment call.
3. **Component vocabulary is guessed.** The LLM invents names like
   `DashboardCard` instead of reaching for the Figma library's actual
   `KpiCard`, because it has no file-wide component list.

The community plugin *Design to Markdown* by @sso\_ solves (1) and (3) by
dumping an 8-section markdown for the file. Its Identity section is the
high-leverage piece — a vibe anchor that fights LLM regression to the mean
in ways tokens alone can't.

## Non-goals

Out of scope for v1:

- Settings UI for Resync / last-synced / open-DESIGN.md
- LLM-synthesized "Don'ts" section (anti-patterns)
- Side-by-side `DESIGN.md.new` merge workflow on re-scan
- Advanced role detection beyond name-heuristic mapping
- Copy voice section
- Any preview UI before the seeded file lands (user opens the file themselves)

If v1 Identity quality disappoints, the fix is rewriting the synth prompt,
not adding more sections.

## Architecture

Three new modules, two modified files. Nothing existing is refactored.

```
studio/
├── server/
│   ├── figmaIngest.ts                (existing — per-node, unchanged)
│   ├── figmaSystemIngest.ts          (NEW — per-fileKey scan + cache)
│   ├── figma/
│   │   ├── systemSources.ts          (NEW — fetches styles, variables, sample frames)
│   │   ├── systemSynth.ts            (NEW — LLM call: tokens + PNGs → Identity + sections)
│   │   ├── systemRender.ts           (NEW — assembles DESIGN.md markdown)
│   │   └── types.ts                  (extended — new SystemIngestResult type)
│   └── middleware/
│       └── chat.ts                   (modified — seeds DESIGN.md on first turn)
└── templates/
    └── CLAUDE.md.tpl                 (modified — adds `## Design system` + `@DESIGN.md`)
```

### Data flow per turn

```
user prompt with Figma URL
    │
    ├─▶ enrichPromptWithFigmaContext      (existing — per-frame ingest → <figma_context>)
    │
    └─▶ maybeSeedProjectDesignMd          (NEW — runs in parallel)
           │
           ├── DESIGN.md exists? skip.
           ├── Otherwise: getFigmaSystemIngest(fileKey)
           │       ├── cached? use it.
           │       └── scan: styles + variables + sampleFrames → synth → cache
           └── render to <projectDir>/DESIGN.md, emit narration

Claude CLI subprocess launched in projectDir
  → loads CLAUDE.md (via existing --add-dir <projectDir>)
  → CLAUDE.md contains `@DESIGN.md` import → DESIGN.md contents loaded
  → gets <figma_context> per turn from user prompt
```

Both branches run concurrently via `Promise.all` in `runClaudeBranch`. The
seeder never blocks the chat turn: on any failure the turn proceeds with
existing behavior, degraded gracefully.

### Cache model

Two layers, distinct scopes:

- **Server-side scan cache** — `Map<fileKey, CacheEntry>`, TTL 60 min,
  capacity 8, LRU. Holds `SystemIngestResult` (the synthesized sections,
  not raw API payloads). In-flight promises deduped via
  `pending: Map<fileKey, Promise>`.
- **`<projectDir>/DESIGN.md`** — user-owned after creation. **Never
  overwritten** by the system once it exists.

A fileKey used across two Studio projects is scanned once; each project
gets its own `DESIGN.md` copy on first use, and they diverge freely from
that point onward. User edits in project A do not affect project B.

## Module contracts

### `figma/types.ts` additions

```ts
export type ColorRole = "background" | "surface" | "text" | "accent" | "status" | "other";
export type TypoRole  = "heading" | "body" | "caption" | "code" | "other";

export interface TokenEntry {
  name: string;        // from Figma style/variable name
  value: string;       // hex for colors; CSS shorthand for typography
  role: ColorRole | TypoRole;
}

export interface TokenSection {
  entries: TokenEntry[];
  warnings: string[];
}

export interface SynthesizedSections {
  identity:   string;                                // 50–80 words, enforced
  colors:     TokenSection;
  typography: TokenSection;
  spacing:    { scale: number[]; notes?: string };   // sorted asc, unique
  radii:      { scale: number[]; notes?: string };
  shadows:    { items: { name: string; css: string }[] };
  components: string[];                              // sorted, deduped, ≤ 50 names
  warnings:   string[];
}

export interface SystemIngestResult {
  source: {
    fileKey: string;
    fileName?: string;
    scannedAt: string;                               // ISO
  };
  sections: SynthesizedSections;
  diagnostics: { warnings: string[]; elapsedMs: number };
}

export type SystemIngestOutcome =
  | ({ ok: true } & SystemIngestResult)
  | { ok: false; reason: string };
```

### `figma/systemSources.ts`

```ts
export interface SystemSources {
  styles: {
    paint:  { id: string; name: string; hex: string }[];
    text:   { id: string; name: string; family: string; size: number; weight: number;
              lineHeight?: number; letterSpacing?: number }[];
    effect: { id: string; name: string; css: string }[];
  };
  variables: {
    color:  { name: string; hex: string; collection: string }[];
    number: { name: string; value: number; collection: string }[];
  };
  components: { id: string; name: string; isComponentSet: boolean }[];
  sampleFrames: { nodeId: string; name: string; pngPath: string;
                  widthPx: number; heightPx: number }[];
  warnings: string[];
}

export async function fetchSystemSources(
  fileKey: string,
  deps: SourcesDeps,
): Promise<SystemSources>
```

- Adds new figmanage helpers: `getStyles(fileKey)`, `getComponents(fileKey)`.
  Reuses existing `getVariables`, `exportNodePng`.
- Sample-frame picker: walks all pages' top-level frames, sorts by area
  descending, takes the first 8, skips anything smaller than 400×400.
  Exports PNGs at 1x into the same cache dir as per-node ingest.
- All HTTP calls parallelized via `Promise.all`.
- Missing endpoints or payload shapes → record in `warnings`, don't throw.

### `figma/systemSynth.ts`

```ts
export interface SynthDeps { claude: ClaudeClient }
export async function synthesizeSystem(
  sources: SystemSources,
  deps: SynthDeps,
): Promise<SynthesizedSections>
```

- One Claude call via Bedrock (reuses Studio's existing auth path).
- Input: sample-frame PNGs + compact JSON digest of styles/variables/components.
- Output: strict JSON matching `SynthesizedSections`, Zod-validated.
- **Token values never come from the LLM.** The LLM assigns roles and display
  names; hex values and CSS shorthands are passed through from `sources`
  verbatim. Post-parse, each entry's `value` is verified against the source
  set; unknown values are dropped with a warning.
- Invalid JSON → throw; caller converts to `ok: false` outcome.
- No retries, no self-repair — one shot, pass or skip.

### `figma/systemRender.ts`

```ts
export function renderDesignMd(s: SynthesizedSections, source: SourceMeta): string
```

Pure function, no I/O. Fixed template, fixed section order. Empty sections
render as `_(none detected)_` — absence is signal. Word/item caps enforced
here (Identity clamped to ≤ 80 words at sentence boundary; components
truncated to 50 alphabetized names).

Template (sentinels stable — tests compare byte-identical):

```markdown
# Design system (from Figma)

<!-- Generated by Arcade Studio on <ISO> from Figma file <fileKey>.
     Edit freely — future Studio runs won't overwrite this file. -->

## Identity
{identity paragraph}

## Colors
- background: …
- surface: …

## Typography
- heading: …
- body: …

## Spacing
Scale: 4, 8, 12, 16, 24, 32

## Radii
Scale: 0, 2, 4, 8

## Shadows
- elevation-1: …

## Components
AppShell, BreadcrumbBar, ChatMessages, …
```

### `figmaSystemIngest.ts`

```ts
export interface FigmaSystemIngest {
  ingest(fileKey: string): Promise<SystemIngestOutcome>;
  getCached(fileKey: string): SystemIngestResult | undefined;
  getPending(fileKey: string): Promise<SystemIngestOutcome> | undefined;
}
export function getFigmaSystemIngest(): Promise<FigmaSystemIngest>;
```

Mirrors `figmaIngest.ts`'s structure: LRU cache of capacity 8, TTL 60 min,
refresh-on-get, single in-flight promise per fileKey.

Negative-result caching: on `ok: false`, cache the outcome for 5 minutes so
a failing turn doesn't hammer figmanage or the Claude API on every
subsequent turn. Successful results cache for the full 60 min.

### `middleware/chat.ts` changes

Additive only. New helper in the same file (or adjacent `figmaSeed.ts` if
readable) called from `runClaudeBranch` in parallel with the existing
context-enrichment:

```ts
const [enriched] = await Promise.all([
  enrichPromptWithFigmaContext(ctx.prompt, ctx.images ?? [], narrate),
  maybeSeedProjectDesignMd(ctx.slug, parsed?.fileKey, narrate),
]);
```

`maybeSeedProjectDesignMd(slug, fileKey, emit)`:

1. Short-circuit if `<projectDir>/DESIGN.md` exists (`fs.stat`).
2. Short-circuit if no fileKey (no Figma URL in prompt).
3. Short-circuit if no Figma PAT configured (same silent-skip as current
   `enrichPromptWithFigmaContext`).
4. Await `getFigmaSystemIngest().ingest(fileKey)`.
5. On `ok: true`: render markdown via `renderDesignMd`, write
   atomically (`<path>.tmp` then `fs.rename`), emit narration
   `Synced design system · N colors · N components`.
6. On `ok: false`: emit narration `Design system sync skipped (<reason>)`,
   don't throw.

## Failure taxonomy

| Failure | Effect | Narration |
|---|---|---|
| No Figma PAT | Skip seed entirely | Silent |
| figmanage network error | `ok: false`, 5 min negative cache | "Design system sync skipped (network)" |
| Synth returned invalid JSON | `ok: false`, 5 min negative cache | "Design system sync skipped (synth error)" |
| `projectDir` write fails (permissions) | Throw → caught, visible in server log | "Design system sync skipped (write error)" |
| Partial success (missing styles, scan OK) | `ok: true`, warnings in diagnostics | Narration shows count + "(with N warnings)" |

None block the chat turn. The Claude CLI subprocess proceeds as today, just
without the DESIGN.md project context.

## Delivery mechanism

`DESIGN.md` is a **file**, not a prompt block. It is discovered by the
Claude CLI subprocess via an `@DESIGN.md` import inside the project's
`CLAUDE.md`, not via native auto-discovery. **This is a critical
constraint:** Studio launches the CLI with `--bare`, which disables
CLAUDE.md auto-discovery (`studio/server/claudeCode.ts:82–96`). Only files
Studio explicitly wires in get read. An unreferenced `DESIGN.md` would be
ignored.

Two mechanisms together make the file reachable:

1. **`studio/templates/CLAUDE.md.tpl` gets a new conditional block** —
   when rendered for a project, the template emits an
   `@DESIGN.md` line if the seeder is expected to produce one. The line
   uses Claude Code's import syntax: files referenced by `@path` inside
   CLAUDE.md are loaded automatically. Because CLAUDE.md itself is loaded
   via `--add-dir <projectDir>` (already wired at `claudeCode.ts:141`),
   the import chain is `--add-dir` → CLAUDE.md → `@DESIGN.md` → contents.
2. **The seeder writes `<projectDir>/DESIGN.md` on first applicable turn.**
   If the file doesn't yet exist when the CLI runs (e.g. the project
   has never been connected to Figma, or the seeder failed), the
   `@DESIGN.md` import resolves to an absent file; the CLI silently
   proceeds without erroring — same rhythm the CLI already uses for
   missing imports. The surrounding prose in the template (quoted below)
   gives the LLM enough context to know that absence is expected.

This avoids per-turn prompt bloat (~400–600 tokens saved on every
subsequent turn) and makes user edits first-class: they open the file,
edit it, save it, next turn's subprocess sees the new content. No server
restart, no cache invalidation, no UI.

### Template change

`studio/templates/CLAUDE.md.tpl` gets a new top-level section
(near the beginning, before generation rules):

```markdown
## Design system

Cross-frame design-system context for this Figma file. Read this before
making any visual decision. If absent, fall back to the per-frame
`<figma_context>` block in the user prompt.

@DESIGN.md
```

The `@DESIGN.md` line is always present. Until the seeder runs (or for
projects never connected to Figma), it resolves to the file not existing,
and the CLI silently proceeds. The text above the import ensures the LLM
knows *why* it's there and what to do when it's missing.

### Staleness of already-created projects

`studio/server/projects.ts:238–254` already rewrites CLAUDE.md when the
template changes. The stale-detection logic runs on startup and rewrites
in place. When we ship this change, existing projects' CLAUDE.md files
will be refreshed automatically on next launch, picking up the new
`@DESIGN.md` import line. No manual migration needed.

### Clean split

- **DESIGN.md** (file, imported via CLAUDE.md, written once per project) —
  "what this system IS"
- **`<figma_context>`** (prompt, per turn) — "what THIS FRAME contains"

The existing `<figma_context>` per-turn block is unchanged.

## Testing

~18 new tests, mirroring the existing `__tests__/server/figma/` patterns.

### Unit

- `__tests__/server/figma/systemRender.test.ts`
  Golden-markdown tests: fixed `SynthesizedSections` → byte-identical DESIGN.md.
  Covers empty sections, overflow truncation (Identity > 80 words, components > 50),
  empty-section sentinel, section order.
- `__tests__/server/figma/systemSources.test.ts`
  Mocked figmanage. Top-N-by-area sample picker. Missing variables payload
  → warnings, no throw. Styles/variables/components parsed into
  `SystemSources` shape.
- `__tests__/server/figma/systemSynth.test.ts`
  Mocked Claude client with canned JSON. Zod rejects extra/missing/wrong
  keys → `ok: false`. Value-provenance check filters out LLM-hallucinated
  hexes. Role enum violations coerced to "other" with warning. Identity
  over 100 words trimmed to sentence boundary ≤ 80.
- `__tests__/server/figmaSystemIngest.test.ts`
  Mirrors `figmaIngest.test.ts`: LRU eviction, TTL expiry, single in-flight
  dedupe, negative-result caching 5 min.

### Integration

- `__tests__/server/middleware/chat-figma-seeder.test.ts`
  - First turn, DESIGN.md absent → seeder writes + narrates.
  - **First turn, DESIGN.md present → seeder no-ops. This is the
    user-owns-file invariant; regression here silently overwrites user edits.**
  - Seeder failure → chat turn still proceeds, narration reflects skip
    reason, no throw propagates.
  - Seeder runs in parallel with `enrichPromptWithFigmaContext` (asserted
    via wall-clock measurement against mock delays).
- `__tests__/server/middleware/chat-figma-seeder-race.test.ts`
  Two concurrent turns, same slug, DESIGN.md absent, seeder in flight:
  - No double-write, no `.tmp` leak.
  - Atomic-rename assertion: if `writeFile(".tmp")` succeeds but `rename`
    fails, no `DESIGN.md` exists.

### Not tested automatically

- **Identity quality.** Manual QA gate: run phase-0 against three real
  Figma files (Observatory, one DevRev shell, one external public file)
  and eyeball the Identity paragraph. If it's generic ("modern and clean
  design system"), rewrite the synth prompt before merging.
- **`@DESIGN.md` import actually resolves in the spawned CLI.** Manual QA:
  seed a project, inject a sentinel into DESIGN.md (e.g. "The Identity of
  this system is SENTINEL-42"), run a turn, confirm the model's reply
  references "SENTINEL-42". If it doesn't, the import chain is broken —
  investigate before shipping. Escape hatch (v2): inline a 1-line
  `<design_system ref="DESIGN.md" />` pointer into the per-turn prompt as
  belt-and-suspenders.

### Template-change tests

- `__tests__/server/projects-claude-md-refresh.test.ts` (extension of any
  existing coverage): assert the rendered CLAUDE.md contains the
  `## Design system` section and `@DESIGN.md` import line. Assert the
  stale-detection refresh on startup (`projects.ts:238–254`) rewrites an
  old CLAUDE.md that lacks the import.

### Fixtures

Under `__tests__/fixtures/figma/`:

- `system-sources-observatory.json` — realistic big payload
- `system-sources-minimal.json` — sparse file, no variables, 3 styles
- `synth-output-golden.json` — canonical `SynthesizedSections` for render tests
- `design-md-golden.md` — expected DESIGN.md for golden sections

## Rollout

**Branch:** `feat/studio/figma-design-md-sync`, cut from `main`,
independent of `feat/multiplayer-relay-foundations`.

Commit slice on the branch:

1. Types + golden fixtures (no logic; tests don't fail yet).
2. `systemRender` + render tests (pure function, lands first).
3. `systemSources` + source tests (figmanage helpers).
4. `systemSynth` + synth tests (LLM contract).
5. `figmaSystemIngest` + ingest tests (cache + dedupe).
6. **CLAUDE.md.tpl edit + stale-refresh test** (`@DESIGN.md` import line
   added; verify stale-detection rewrites old projects on startup).
7. Middleware wiring + integration tests (seeder, race, user-owns-file).
8. Manual QA against three real Figma files; sentinel test for
   `@DESIGN.md` import pickup; tune synth prompt if needed.
9. `CHANGELOG.md` entry; final commit.

Each step is independently reviewable. Steps 2–5 can merge as separate
commits within the branch; step 7 is the integration point.

## CHANGELOG entry

```markdown
### Added
- Figma design-system sync: the first time you reference a new Figma file,
  Studio now scans the whole file for styles, variables, and components,
  synthesizes a visual identity paragraph, and writes a `DESIGN.md` into
  your project directory. Claude loads it on every turn via a project-level
  `@DESIGN.md` import — giving cross-frame context for personality and
  available tokens, not just what's on the current frame. Your DESIGN.md
  is never overwritten; edit it freely.
```

## Risk register

| Risk | Mitigation |
|---|---|
| Identity paragraph is generic slop | Manual QA gate on 3 real files before merge; fix = rewrite synth prompt |
| figmanage rate-limits on big files | Sources dedupes, sample cap at 8, 60 min TTL avoids re-scans |
| `@DESIGN.md` import doesn't resolve in bare-mode CLI | Sentinel QA test before ship; fallback = inline pointer into per-turn prompt |
| CLAUDE.md stale-refresh misses old projects | `projects.ts:238–254` already does startup refresh; new test pins the contract |
| Synth JSON invalid → seed skipped forever | 5 min negative-result TTL, next turn retries; visible in server log |
| User pastes URL in a slug that already has DESIGN.md from elsewhere | Never overwritten by design — no change, no data loss |
| fileKey shared across projects + user edits in project A | Scans shared; `DESIGN.md` copies are per-project — edits never cross |
| User has no Figma file but CLAUDE.md now imports DESIGN.md | `@path` imports resolve silently to empty when file absent — no error, no regression |

## Open questions

None at spec time. All major forks resolved in the brainstorm:

- Sections: Core 5 + Component inventory + Don'ts → **v1 drops Don'ts, keeps rest**
- Delivery: file-based, loaded via `@DESIGN.md` import in project CLAUDE.md
  (bare-mode CLI requires explicit wiring — native auto-discovery is off),
  no per-turn prompt injection
- Storage: per-project file, copied from per-fileKey scan cache
- Identity source: LLM synthesis on first ingest
- Scan trigger: first Figma URL in any turn (silent, narrated on completion)
- Merge policy: user edits always win — system never overwrites
- Scan sources: hybrid (styles + variables + top-N sample frame PNGs)
