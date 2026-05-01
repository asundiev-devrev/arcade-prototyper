# Arcade import validation hook

**Date:** 2026-05-01
**Status:** Design approved, pending implementation plan
**Applies to:** `studio/` (Arcade Studio), not the skill

## Problem

The generating `claude` subprocess routinely hallucinates imports from `arcade/components` and `arcade-prototypes` — typical shape is naming-convention drift (`ArrowsUpDownSmall` for the real `ArrowsUpAndDown` / `ChevronUpAndDownSmall`). The broken import fails at module load, so the frame renders blank with a red "Frame failed to load" banner reading `The requested module … does not provide an export named 'ArrowsUpDownSmall'`. This has hit multiple beta testers.

Preventive guardrails in `studio/templates/CLAUDE.md.tpl` (a curated mapping table, rule "read the barrel when unsure") only reduce frequency. The model still trusts its naming intuition for compound icons because patterns like `PlusSmall` and `ChevronLeftSmall` suggest `${Concept}${Size}` is a universal shape.

The right fix is a corrective guardrail: verify imports **at write-time**, before Vite picks up the file, and feed any bad name back to the model so it self-corrects in the same turn.

## Goal

Catch hallucinated named imports from `"arcade/components"` and `"arcade-prototypes"` via a Claude Code PostToolUse hook. When a `Write` or `Edit` introduces an import that doesn't exist in the real barrel, block the tool call, exit 2 with a stderr message that includes "Did you mean" suggestions, and let claude-code's existing stderr-as-tool-result channel surface the error back to the model. The model then reads the suggestions, picks a real name, and re-writes — no new chat turn, no user-visible blank frame.

## Non-goals (v1)

- No validation of imports from other sources (`react`, relatives, `node:…`, third-party npm). Vite already reports those; they are not the recurring bug.
- No default-import or type-only-import validation. Generator does not hit those failure modes.
- No runtime / JSX-usage check. ("Did the component get used with bad props" is a different bug class.)
- No migration of the existing icon-mapping table in `CLAUDE.md.tpl`. Keep it — preventive and corrective guardrails are complementary.
- No new UI surface. Error feedback flows through the existing hook-stderr channel the model already understands from `blockImageReshape.mjs`.
- No namespace-import validation (`import * as X`). Rare in generator output.

## Architecture

```
  Claude subprocess writes/edits frames/<slug>/index.tsx
     │
     ▼
  claude-code PostToolUse hook pipeline
     │
     ▼
  studio/server/hooks/validateArcadeImports.mjs   ← new
     │
     ├─ reads stdin: { tool_name, tool_input: { file_path, content | new_string } }
     ├─ scope gate: exit 0 if file isn't .ts/.tsx or has no tracked imports
     ├─ parses tracked named imports from arcade/components + arcade-prototypes
     ├─ loads barrel exports (cached per invocation)
     ├─ computes: bad = imports \ barrelExports
     └─ if bad.length > 0:
          · top-3 fuzzy matches per bad name (Levenshtein ≤ 4)
          · exit 2 with stderr message
        else:
          · exit 0
  │
  ▼
  claude-code feeds stderr back to the model as tool_result
  next assistant step picks a real name, re-Writes, hook passes
```

### New modules

- **`studio/server/hooks/validateArcadeImports.mjs`** — the hook. Single file, mirrors the structure of the existing `blockImageReshape.mjs`: pure-function exports (testable as a library) plus a top-level `main()` that reads stdin and exits 0 or 2.

  Pure exports:
  ```
  parseImports(fileContents)              → [{source, names: string[]}]
  loadBarrel(absPath)                     → Set<string>
  validateImports(imports, barrels)       → [{source, badName, suggestions: string[]}]
  formatErrorMessage(violations, barrels) → string
  ```

### Modified modules

- **`studio/server/claudeCode.ts`** — register the new PostToolUse hook alongside the existing `blockImageReshape.mjs` entry. Matchers: `Write` and `Edit`.
- **`studio/templates/CLAUDE.md.tpl`** — one-line addition under the "Icons" section telling the model a write-time hook exists and that its stderr is the source of truth when an import looks ambiguous.
- **`studio/CHANGELOG.md`** — `0.4.3` entry.
- **`studio/packaging/VERSION`** — bump to `0.4.3`.

### Invariants

- **Fail open on any error.** Parse failure, missing barrel, I/O error — exit 0 and allow the write. A broken hook must never wedge a real generation.
- **Scope strictly limited to `"arcade/components"` and `"arcade-prototypes"`.** All other imports pass through unchanged.
- **Stateless across invocations.** Barrels are re-read each call (~5 ms). We would rather pay that cost than mis-invalidate after an arcade-gen upgrade.

## Hook contract

### Trigger

PostToolUse, matchers `Write` and `Edit`. Not `Bash`.

### Input (stdin, JSON)

```json
{
  "tool_name": "Write" | "Edit",
  "tool_input": {
    "file_path": "/Users/.../projects/<slug>/frames/<frame>/index.tsx",
    "content": "...full file contents...",
    "new_string": "...",
    "old_string": "..."
  }
}
```

For `Write`, read `content`. For `Edit`, read `new_string`. `old_string` is ignored.

### Scope gate (early exit 0)

Return exit 0 without further work when any of these are true:

- `file_path` does not end in `.ts` or `.tsx`
- `file_path` is a sidecar file (`index.errors.json`, `project.json`, etc.)
- The content being written contains no `import … from "arcade/components"` or `"arcade-prototypes"` substring

The scope gate is intentionally lenient: for `Edit`, we check only `new_string`. If the model edits JSX without touching the import line, the hook won't re-scan the whole file. In practice the model's typical failure mode is introducing a bad import in the same write that uses it, so v1 is sufficient. If live experience shows misses, widen to "read the current file from disk and re-check the whole thing" in v2.

### Barrel resolution

```js
const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? path.join(process.env.HOME, "arcade-gen");

const sources = {
  "arcade/components": [
    path.join(ARCADE_GEN_ROOT, "src/components/index.ts"),
    path.join(ARCADE_GEN_ROOT, "src/components/icons/index.ts"),
  ],
  "arcade-prototypes": [
    path.join(PROTOTYPER_ROOT, "studio/prototype-kit/index.ts"),
  ],
};
```

`arcade/components` re-exports everything under `icons/` at runtime, so both files flatten into the same validation namespace. If any individual barrel file fails to read, the corresponding source fails open — we validate the sources we can, allow the ones we cannot. We do not block a write just because arcade-gen is not on disk.

### Barrel parsing

Regex per line:

```
^export\s+\{\s*([A-Za-z_][\w$, \n]*?)\s*\}\s+from
```

Collect identifiers in the brace group. Split on comma, trim, skip any token preceded by `type`, resolve `Foo as Bar` to `Bar` (the publicly importable name). Machine-generated barrel files are stable enough that regex is sufficient; if a future barrel uses `export *` we fall back to fail-open-for-that-source behavior.

Note on aliasing symmetry: barrel records `Bar` (what consumers can import), import-side records `Foo` (what the file claims to pull from the source). For the common case `export { Foo }` + `import { Foo }`, both sides agree on `Foo`. For aliased exports (`export { Foo as Bar }` + `import { Bar }`), both sides agree on `Bar`. The current arcade-gen barrels have no aliased exports, so this is mostly theoretical.

### Import parsing (in the target file)

```
import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']
```

For matches where the source is tracked:

- Split the brace group on commas.
- Strip whitespace and `type` prefix per token.
- For `Foo as Bar` on the import side, record `Foo` as the symbol to validate — `Foo` is what the source has to publicly export; `Bar` is just the consumer's local alias. (See the barrel-parsing note above: both sides converge on the publicly exported name.)

Deduplicate by source+name.

### Diff and failure

For each tracked source, `bad = imported \ barrelExports`. If all bad arrays are empty, exit 0. Otherwise, for each bad name:

- Compute top-3 fuzzy matches by Levenshtein distance ≤ 4, sorted ascending.
- If no suggestions meet the threshold, note the absolute barrel path instead.

Emit a single consolidated stderr message and exit 2:

```
Blocked: some imports don't exist in their declared source.

In "arcade/components":
  - `ArrowsUpDownSmall` — did you mean `ArrowsUpAndDown`, `ChevronUpAndDownSmall`, `ArrowDownSmall`?
  - `DialogTitle` — did you mean `Dialog`?
      (no near-matches; read /Users/.../arcade-gen/src/components/index.ts
      for the full list of 57 exports)

In "arcade-prototypes":
  - `SidebarFooter` — did you mean `ComputerSidebar`? (no near-matches)

Fix the names (or drop the symbol) and re-Write. This hook runs on
every Write/Edit and will block again if the imports still don't exist.
```

Include per-source export counts so the model's size intuition is correct.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Allow. Scope gate passed, fail-open error, or no bad imports. |
| `2` | Block. One or more imports from tracked sources do not exist. |
| anything else | Treated by claude-code as fail-open (hook is broken, allow). |

## Failure modes

| Situation | Behavior | Rationale |
|---|---|---|
| arcade-gen checkout missing | Allow. Log warn to stderr. | Environmental, not a code error. |
| Barrel file exists but empty / malformed | Allow (for that source). | Cannot decide → do not block. |
| `import * as X from "arcade/components"` | Allow. | Namespace imports do not fail at module load. Out of v1 scope. |
| Multi-line import with comments inside the brace group | Tolerated — brace-group regex is non-greedy, comma-split ignores `//`-prefixed tokens. | Rare; cheap to cover. |
| `Foo as Bar` alias | Validate `Foo` against the barrel. | Correct semantics: `Foo` is what gets imported; `Bar` is the local name. |
| Same name imported twice | Check once (dedup before lookup). | Keeps error output clean. |
| Write outside `frames/` that imports tracked sources | Still validated. | Hallucinated imports in shared code break consumers — no reason to exempt. |
| Edit removes a valid import, adds a bad one | Caught — `new_string` has the bad line. | |
| Edit introduces JSX usage of a non-existent name without touching the import line | NOT caught in v1. | Usage without an import throws a different error at load time. YAGNI. |
| Edit removes an import entirely (no replacement) | Allowed. | Correct — post-Edit file imports nothing broken. |
| JSX text that happens to contain `import { Foo }` substring | Not falsely matched — regex is anchored to `import\s+{...}\s+from\s+"..."`. | False-positive-safe. |
| Non-TS/TSX file (e.g., CSS) | Scope gate exits 0 before parsing. | |
| Very large file | Linear scan + ~125-name barrel × few bad names = trivial. | No size limit needed. |

### Explicit v1 non-coverage (v2 candidates)

- Namespace-import access (`import * as Arc` + `<Arc.FakeIcon />`). Needs AST parsing; rare in practice.
- Transitive imports. A frame importing from a local file which imports from `arcade/components` is not re-validated; the transitive bad import would have been caught when its own file was written.

### Timing budget

- Expected wall clock per invocation: ~5–20 ms (reading 3 barrel files + regex + Levenshtein on small inputs).
- No explicit timeout — claude-code's tool-call timeout covers it.

## Testing

### Unit (Vitest)

`studio/__tests__/server/hooks/validateArcadeImports.test.ts` — pattern mirrors the existing `blockImageReshape.test.ts`: import pure functions from the `.mjs` and assert on their outputs.

| Group | Covers |
|---|---|
| `parseImports` | named-import extraction, multi-line, other sources ignored, `Foo as Bar` → `Foo`, dedup, `import type` skipped |
| `loadBarrel` | extracts value exports, handles `Foo as Bar`, skips `export type`, returns empty set on missing file |
| `validateImports` | all-valid → empty, single bad → top-3 suggestions, suggestions > 4 dropped, multiple bad names grouped by source, missing barrel → fail-open |
| `formatErrorMessage` | per-source grouping, suggestions inline, barrel-path shown when no suggestion meets threshold, export counts |
| integration (child_process) | exit 0 on non-frame path, exit 0 on no tracked imports, exit 0 on all-valid, exit 2 with expected stderr on bad, exit 0 when barrels unreadable |

### Mocks and fixtures

`studio/__tests__/fixtures/hooks/` holds hand-rolled mini-barrels (~10 exports each) shaped like the real arcade-gen barrels. Tests point the hook's barrel-path resolution at these fixtures via `ARCADE_GEN_ROOT` / `PROTOTYPER_ROOT` env-var overrides.

### What we do not test

- Exact error-message prose — the test asserts structure (source grouping, "did you mean" phrase present, suggestion count), not prose. Keeps the message editable without rewriting tests.

### Smoke plan before shipping (manual)

1. Launch Studio from the new DMG.
2. Paste a Figma URL known to hit the icon-hallucination bug — or manually Edit `frames/<slug>/index.tsx` to insert an import of `ArrowsUpDownSmall` and save.
3. Trigger a chat turn. Observe:
   - Hook blocks the Write/Edit.
   - Chat narration shows the hook's error with suggestions.
   - Next assistant step picks a real name and re-writes successfully.
4. Point `ARCADE_GEN_ROOT` at a non-existent path, retry. Verify generation still succeeds (fail-open).
5. Inspect one fresh generation turn with a new Figma URL — confirm no false positives, all imports pass.

## Rollout

Ship in 0.4.3 as a bug-fix release. No staged rollout or feature flag. The hook fails open on any environmental issue, so it either helps or does nothing. Beta testers are the rollout.

### Reviewer checklist before merge

1. `pnpm run studio:test` passes (212 existing + new unit + integration tests).
2. Manual smoke steps 1–3 above pass on a fresh DMG.
3. Manual smoke step 4 (fail-open) passes.
4. Manual smoke step 5 (no false positive on a real generation) passes.
5. `studio/CHANGELOG.md` has the 0.4.3 entry.

## What this release ships vs. does not

| Bug class | Caught by 0.4.3? |
|---|---|
| Hallucinated icon names (e.g., `ArrowsUpDownSmall`) | yes |
| Hallucinated primitive names (e.g., `DialogTitle`) | yes |
| Hallucinated composite names (e.g., `SidebarFooter`) | yes |
| Aliased import with bad source name (`Foo as Bar` where `Foo` does not exist) | yes |
| Namespace imports with bad accessor (`arc.FakeIcon`) | no — v2 if it surfaces |
| Valid import, invalid JSX prop | no — different bug class |
| Default import of a no-default barrel | no — YAGNI |
| Transitive imports through a local file | no — caught when that local file is written |

## Open question (punted to implementation)

Exact Levenshtein threshold. The spec starts at ≤ 4. Tune empirically after a few days — if real typos land 1–3 edits away and bogus suggestions appear at 4+, tighten to ≤ 3.
