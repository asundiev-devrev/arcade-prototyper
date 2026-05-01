# Figma structured context for the generator

**Date:** 2026-05-01
**Status:** Design approved, pending implementation plan
**Applies to:** `studio/` (Arcade Studio), not the skill

## Problem

When a user pastes a Figma URL into the chat, Studio today appends `"Figma reference: <url>"` to the prompt text. Studio exposes a PNG-export endpoint, but the chat flow does not auto-export — the generating `claude` subprocess receives only the URL and whatever images the user attached by hand, and reverse-engineers layout from pixels when it gets there. Two failure modes recur:

1. The model hand-rolls styling — arbitrary hex colors and pixel values — instead of reaching for Arcade design-system tokens.
2. The model hand-rolls layout — raw flex chrome — instead of reaching for `prototype-kit` composites (`AppShell`, `NavSidebar`, `VistaHeader`, etc.).

A more restrictive system prompt and richer pre-built composites only moved the needle partway. The root cause is that the generator sees a picture, not a structure. Figma Make's accuracy advantage is largely that it reads the Figma document tree as structured data.

## Goal

When a user submits a prompt containing a Figma URL, the generator receives:

1. A compacted, token-resolved node tree of the target frame.
2. A prioritized list of `prototype-kit` composites that likely apply, each mapped to a subtree.
3. A PNG export of the frame, auto-attached as a visual sanity check. (This also fills a gap — today the user has to export and attach the PNG by hand.)

All of this is computed server-side, in parallel with the user typing the prompt, and injected into the `claude` turn before generation starts. The generator never has to "figure out" what composite or token to use from pixels alone.

## Non-goals (v1)

- No pixel-perfect reproduction — sub-node rendering still relies on the model.
- No generator-side tool calls — all ingestion runs before `claude` spawns.
- No cross-process caching — in-memory LRU is enough.
- No changes to the critique / second-pass loop — separate lever, separate spec.
- No changes to how the user triggers Figma ingestion — URL detection stays as it is in `PromptInput.tsx`.
- No UI preview of the extracted context before send. If needed later, v2.
- No user-facing toggle to disable ingestion. Graceful degradation is the disable.

## Architecture

```
PromptInput (paste/type URL)
  └─ detectedFigmaUrl useEffect → POST /api/figma/ingest { fileKey, nodeId }   ← prefetch
                    │
                    ▼
              server/figmaIngest.ts  (orchestrator + LRU)
                    │
       ┌────────────┼────────────┬─────────────┐
       ▼            ▼            ▼             ▼
   figmanage     variable    composite       PNG export
   get-nodes     resolver    classifier      (existing)
       │            │            │
       └────────────┴─────┬──────┘
                          ▼
              IngestResult  (cached by `${fileKey}:${nodeId}`)
                          │
ChatPane → /api/chat ◀────┘
                          │
                          ▼
              chat.ts prompt-build step
                  │
                  ▼   user prompt now gets a <figma_context> block
                      containing tokens, suggested composites, tree.
                  │
                  ▼
              claude subprocess
```

### New modules

- **`server/figmaIngest.ts`** — orchestrates the four sub-steps; owns the LRU + pending-promise dedupe map; exposes `ingest(fileKey, nodeId)` and `getCached(fileKey, nodeId)`.
- **`server/figma/compactTree.ts`** — raw figmanage JSON → `CompactNode`. Replaces Figma's opaque node IDs (e.g. `"1234:56"`) with short path-based IDs (`"0.2.1"`), collapses passthrough wrappers, preserves auto-layout, drops zero-size nodes, depth-caps at 8.
- **`server/figma/resolveTokens.ts`** — maps fills/sizes/text styles against Figma variables. Uses a new `figmanage reading get-variables` wrapper in `figmaCli.ts`. Token name if bound, raw value otherwise.
- **`server/figma/classifyComposites.ts`** — one Haiku call. Input: compacted tree + `KIT-MANIFEST.md` summary. Output: `[{composite, path, confidence, reason}]`. Validates that each suggested `path` exists in the tree and each `composite` is a real entry in the kit manifest.
- **`server/figma/promptBlock.ts`** — `IngestResult` → the `<figma_context>` YAML block consumed by `chat.ts`.
- **`server/figma/types.ts`** — shared types (see [Data shape](#data-shape)).

### Modified modules

- **`server/middleware/figma.ts`** — adds `POST /api/figma/ingest` handler. Request body: `{ url: string }` OR `{ fileKey: string, nodeId: string }`. Handler parses the URL if given (via existing `parseFigmaUrl`), calls `figmaIngest.ts`, returns `IngestResult` on success or `{ ok: false, reason }` on ingest failure (still HTTP 200 — the client doesn't care and we don't want to surface this as an error in logs).
- **`server/middleware/chat.ts`** — in the Claude branch's prompt-build step, detects any Figma URL in the prompt, looks up the cache, awaits an in-flight ingest up to a 10s budget, and injects the `<figma_context>` block before spawning `claude`. Cache miss after timeout → proceeds without the block (current behavior).
- **`server/figmaCli.ts`** — adds `getVariables(fileKey)` wrapper over `figmanage reading get-variables --json`.
- **`src/components/chat/PromptInput.tsx`** — on `detectedFigmaUrl` change, fire-and-forget `POST /api/figma/ingest` with `{ url }`. No UI change; prefetch is invisible.
- **`studio/CHANGELOG.md`** — `[0.x.0]` entry describing the new capability.

### Invariants

- The generator never sees the raw figmanage response. Only the compacted, token-resolved, classified view.
- `CompactNode.id` is an opaque path (`"0"`, `"0.2"`, `"0.2.1"`) — stable within a `CompactNode`, independent of Figma node IDs. The composite classifier and the generator share this addressing scheme.
- Ingest failures never block generation — they degrade to today's PNG-plus-URL behavior.

## Data shape

The `IngestResult` is the one contract that matters. Everything else is internal.

```ts
interface IngestResult {
  source: { fileKey: string; nodeId: string; url: string; fetchedAt: string };
  png: { path: string; widthPx: number; heightPx: number };
  tree: CompactNode;
  tokens: ResolvedTokens;
  composites: CompositeSuggestion[];
  diagnostics: { warnings: string[] };
}

interface CompactNode {
  id: string;                                 // "0" / "0.2" / "0.2.1"
  type: "frame" | "text" | "instance" | "group" | "vector" | "image";
  name?: string;                              // only if the Figma layer name looks meaningful
  layout?: {
    direction: "row" | "col" | "none";
    gap?: number;
    padding?: [number, number, number, number];  // top, right, bottom, left
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "space-between";
    width?: number | "fill" | "hug";
    height?: number | "fill" | "hug";
  };
  style?: {
    fill?: string;                            // token name OR raw hex
    stroke?: string;
    radius?: number;
    shadow?: string;
  };
  text?: {
    content: string;
    style?: string;                           // token name or "size/lineHeight/weight" tuple
  };
  children?: CompactNode[];
}

interface ResolvedTokens {
  colors: Record<string, string>;             // token name → hex (reference)
  typography: Record<string, string>;         // token name → "size/lineHeight/weight"
  spacing: Record<string, number>;            // token name → px
}

interface CompositeSuggestion {
  composite: string;                          // "NavSidebar", "VistaHeader", ...
  path: string;                               // CompactNode.id
  confidence: "high" | "medium" | "low";
  reason: string;                             // one-line human explanation
}
```

### Prompt injection format

When `chat.ts` finds a cached `IngestResult` matching a URL in the prompt, it appends a `<figma_context>` block to the user prompt (before the PNG attachment). The block is compact YAML — cheaper tokens than JSON, easier for the model to scan. Shape:

```
<figma_context url="https://figma.com/...">
resolved_tokens:
  colors: { surface-default: "#FFFFFF", ... }
  typography: { heading-md: "20/28/600", ... }
  spacing:    { md: 12, lg: 16, ... }

suggested_composites:
  - AppShell     (high)   at 0        — outer chrome with title bar + split layout
  - NavSidebar   (high)   at 0.1      — 248px fixed-width vertical column, 8-item list
  - VistaHeader  (medium) at 0.2.0    — title+actions row; not confident on filter pills

tree:
  - frame "App" fill=surface-default layout=row
    - frame "Sidebar" width=248 layout=col gap=4 padding=[16,12,16,12]
      - text "Home" style=body-md
    - frame "Main" width=fill layout=col
      ...
</figma_context>
```

### Design decisions worth flagging

- **Token-or-raw hybrid.** `style.fill` is a token name when a variable is bound, else the raw value. No silent "nearest token" fallback — that reintroduces hallucination. Unbound values surface in `diagnostics.warnings`.
- **Opaque path IDs, not Figma node IDs.** Keeps the prompt decoupled from Figma internals and gives the classifier + generator a shared, readable addressing scheme.
- **Name filtering.** `name` is only included if it looks meaningful. Auto-generated names like `Rectangle 47` or `Frame 12` are dropped. Heuristic: contains a space or is longer than 10 chars, and not matching a known noise regex.

## Caching and lifecycle

- **Store.** In-memory LRU inside `figmaIngest.ts`. Key: `${fileKey}:${nodeId}`. Capacity: 32. TTL: 10 minutes.
- **Persistence.** None. Studio restart → cache gone; re-fetch takes 3–6s. Acceptable.
- **Prefetch trigger.** `PromptInput.tsx` already has a `detectedFigmaUrl` state. On change → fire-and-forget `POST /api/figma/ingest` with `{ url }`. Server handler parses it; if the URL is malformed it returns `{ ok: false }` and the client ignores it. No cancellation on URL edit — stale prefetches land in cache and eventually evict.
- **Send-time lookup.** When `chat.ts` builds the prompt, it:
  1. Extracts any Figma URL using the existing `extractFigmaUrl` + `parseFigmaUrl`.
  2. Checks the cache for a completed `IngestResult`.
  3. If not cached but a pending-ingest promise exists for that key, awaits it up to 10s.
  4. If still nothing (no prefetch ever ran — e.g. user typed URL in place with no paste event), kicks off a synchronous ingest with the same 10s cap.
  5. On hit → injects `<figma_context>` and attaches the exported PNG to the claude turn. On timeout/failure → proceeds without. Logs a warning.
- **Dedupe.** Pending-promise map keyed on `${fileKey}:${nodeId}` — concurrent requests for the same node share one ingest.

## Failure modes

| Failure | Behavior | User-visible |
|---|---|---|
| figmanage not installed / auth missing | `ingest` returns `{ ok: false, reason }`; `chat.ts` proceeds without block | Server warn log; no UI error (URL still in prompt, same as today) |
| Node fetch ok, variable fetch fails | `tokens` empty; `style.fill` keeps raw values; diagnostics note | None — degrades to "structured tree but no tokens" |
| Haiku classifier times out / errors | `composites: []`; diagnostics note | None — tree + tokens still delivered |
| Tree is huge (>200 nodes) | Compacting drops zero-size, collapses passthrough groups, caps depth at 8; diagnostics note truncation | None |
| Two prompts in flight for same node | Pending-promise dedupe — second call awaits the first | None |
| URL malformed / non-figma | Client never POSTs; server returns 400 if forced | None (same URL detection as today) |

### Timeouts

- `figmanage get-nodes`: 15s
- Variable resolution: 10s
- Haiku classifier: 15s
- PNG export: unchanged
- Overall ingest wall clock: 20s cap. Over budget → return partial `IngestResult` with diagnostics; generator still gets something useful.
- `chat.ts` await-in-flight: 10s cap. Over budget → proceed without.

## Observability

- Each ingest logs `[figmaIngest] fileKey=X nodeId=Y ms=Z nodes=N composites=M warnings=K` to server console.
- Warnings flow into the SSE stream as a `narration` event: `Figma context: N composites suggested, K diagnostics`. Visible in the chat pane next to "Thinking…".
- No metrics dashboard or persistent log. Console log plus manual inspection of generated frames is enough for v1.

## Configuration

- `ARCADE_STUDIO_CLASSIFIER_MODEL` — defaults to `haiku`. Mirrors the existing `ARCADE_STUDIO_CRITIQUE_MODEL` pattern for A/B testing.
- No new Settings UI surface. Feature is always-on when Figma auth is present.

## Testing

### Unit (Vitest)

| File | Covers |
|---|---|
| `__tests__/server/figma/compactTree.test.ts` | ID stability, passthrough-group collapsing, zero-size-node drop, depth cap, meaningful-name filter |
| `__tests__/server/figma/resolveTokens.test.ts` | bound → token name, unbound → raw value, missing variable API → diagnostics warning, typography tuple format |
| `__tests__/server/figma/classifyComposites.test.ts` | Haiku classifier: happy-path parse, bad JSON → empty + warning, unknown composite names rejected, invalid paths rejected |
| `__tests__/server/figmaIngest.test.ts` | LRU eviction at 32, TTL expiry, pending-promise dedupe, 20s cap → partial result, figmanage-missing → `ok:false` |
| `__tests__/server/middleware/figma-ingest.test.ts` | `POST /api/figma/ingest`: 200 happy, 400 bad URL, 500 figmanage crash, response shape |
| `__tests__/server/middleware/chat-figma-context.test.ts` | `chat.ts` prompt-build: URL in prompt → cache lookup → `<figma_context>` injected; cache miss → proceeds without; in-flight await with 10s timeout |

### Mocks and fixtures

- `figmanage` spawning: mock `spawn` at the module boundary, as existing tests do.
- Haiku classifier: mock the Claude API client at the module boundary. Fixtures for good/bad responses under `__tests__/fixtures/figma/`.
- Three real figmanage JSON fixtures under `__tests__/fixtures/figma/` — one simple, one with variables, one oversized (to exercise truncation).

### Integration (skipped in CI)

- `__tests__/integration/figma-ingest.live.test.ts` — hits a real test Figma file; gated on `FIGMA_LIVE_TESTS=1`. For catching figmanage breakage during releases without blocking CI.

### What we do not test

- Prompt string content — brittle. The chat-middleware test asserts the `<figma_context>` block is present and that `IngestResult` fields round-trip through it, not the exact prose.

### Smoke plan before shipping (manual)

1. Paste a known Figma URL → observe `[figmaIngest]` log line on server.
2. Generate a frame from it → inspect `index.tsx`: uses suggested composites? uses token names, not raw hex?
3. Kill Figma auth, retry → frame still generates (degrades gracefully).
4. Paste URL, immediately hit Send → watch SSE for in-flight await; confirm either the block lands or we proceed without.
5. Regenerate same URL within 10 min → cache hit, no new figmanage spawn.

## Rollout

- Ship in the next studio release. No staged rollout or feature flag — the feature degrades gracefully if any subsystem is missing.
- Beta testers are the rollout.
- `studio/CHANGELOG.md` entry: `[0.x.0]` — Added "Figma references now ingested as structured context: the generator receives the document tree, resolved tokens, and matching prototype-kit composites alongside the PNG. Accuracy win for Figma-to-frame generation."

### Reviewer checklist before merge

1. `pnpm run studio:test` passes.
2. Manual smoke (above) on at least one real Figma file.
3. Inspect one generated frame's `index.tsx` — uses token names, reaches for suggested composites.
4. Figma-auth-missing smoke: generation still succeeds with URL-only.
5. `[figmaIngest]` log line present and informative.
6. `studio/CHANGELOG.md` has the entry.

## Open questions (punted to implementation)

- Exact YAML format of the `<figma_context>` block — iterate empirically once generation quality is observable.
- Which figmanage response fields are "passthrough wrappers" worth collapsing — driven by 5–10 real fixtures.
- Haiku vs. Sonnet-tier for classifier — start with Haiku; bump if classification quality is poor.
