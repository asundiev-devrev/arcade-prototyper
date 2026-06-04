# Arcade Studio — MEMORY (project + global)

**Date:** 2026-06-04
**Status:** Design approved, pending spec review
**Scope:** Single implementation plan

## Goal

Give Studio a persistent MEMORY concept like Cursor rules / Claude Code memory.
Two levels, both **always** applied to every generation turn:

- **Global memory** — applies to every project (the designer's cross-project taste).
- **Project memory** — applies to one project only (project-specific facts).

Each level holds two kinds of content:

- **Standing rules** (human-authored) — "always use teal accents", "frames mobile-first".
- **Learned facts** (agent-authored) — captured automatically mid-generation when
  the agent notices a durable preference or correction; also writable on demand
  via an explicit `remember:` instruction.

The two levels are **strictly separate** — both always inject, no override or
merge logic. The user is responsible for not contradicting themselves across
levels.

## Why this shape

Studio already injects per-project context the exact way memory needs to work:
the rendered `CLAUDE.md` lives in the project dir, is discovered by the
subprocess via `--add-dir <cwd>`, and pulls in `@DESIGN.md` through Claude's
`@import` mechanism (see [templates/CLAUDE.md.tpl:107](../../templates/CLAUDE.md.tpl)).
Memory rides the same rails — no new injection pipeline, no JSON store, no UI.

## File layout

```
~/Library/Application Support/arcade-studio/memory/   ← GLOBAL (all projects)
  RULES.md      human-authored standing instructions
  LEARNED.md    agent append-only, cross-project facts

<projectDir>/memory/                                  ← PROJECT (this project only)
  RULES.md      human-authored standing instructions
  LEARNED.md    agent append-only, project facts
```

- **RULES.md** — the human writes it. The agent NEVER edits it. Seeded as a stub
  with a one-line header comment so the file always exists for the `@import`.
- **LEARNED.md** — the agent appends timestamped one-liners. Append-only contract
  means hand-written rules can never be clobbered. Also seeded as a stub.
- Markdown only. No Studio UI panel in this scope. Files on disk are the source
  of truth; the user edits RULES.md in any editor.

`studioRoot()` already resolves the global base
([server/paths.ts:11-15](../../server/paths.ts)). `projectDir(slug)` resolves the
project base ([server/paths.ts:21-23](../../server/paths.ts)).

## How memory reaches the generator

| Level | Read path | Write path |
|-------|-----------|------------|
| Project | `@memory/RULES.md` + `@memory/LEARNED.md` imports in the project `CLAUDE.md` (relative to cwd) | agent writes the file directly — project dir is already in `--add-dir opts.cwd` ([server/claudeCode.ts:148](../../server/claudeCode.ts)) |
| Global | `@<absolute>/memory/RULES.md` + `@<absolute>/memory/LEARNED.md` imports in the project `CLAUDE.md` | new `--add-dir <studioRoot>/memory` on subprocess spawn grants read+write |

`--bare` disables CLAUDE.md auto-discovery but the explicitly `--add-dir`'d
project CLAUDE.md is still read, and its `@import` lines still resolve (that's how
`@DESIGN.md` already works today). `--dangerously-skip-permissions` is already set,
so the agent can write to any `--add-dir`'d folder without a prompt.

## Components to change

### 1. `server/paths.ts` — path helpers

Add four helpers (mirroring `designMdPath`):

```ts
export function globalMemoryDir(): string {
  return path.join(studioRoot(), "memory");
}
export function projectMemoryDir(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "memory");
}
```

(Individual `RULES.md` / `LEARNED.md` file paths are derived inline where needed;
the dir helpers are the public surface.)

### 2. `server/claudeCode.ts` — global `--add-dir`

Add `globalMemoryDir()` to the `addDirs` default alongside `PROTOTYPER_ROOT` and
`ARCADE_GEN_ROOT` ([server/claudeCode.ts:99](../../server/claudeCode.ts)). The
folder must exist at spawn time (seeded on boot — see §4) or `--add-dir` on a
missing path is ignored/errors; seeding guarantees existence.

### 3. `templates/CLAUDE.md.tpl` — imports + memory protocol

Two edits:

**a. Import lines** — add a `## Memory` section near the `@DESIGN.md` block
(after [templates/CLAUDE.md.tpl:107](../../templates/CLAUDE.md.tpl)):

```
## Memory

Two layers of durable context apply to every turn. Read them before making
design decisions; they outrank one-off prompt phrasing when they conflict.

Global (all projects):
@{{GLOBAL_MEMORY}}/RULES.md
@{{GLOBAL_MEMORY}}/LEARNED.md

Project (this project only):
@memory/RULES.md
@memory/LEARNED.md
```

`{{GLOBAL_MEMORY}}` is a new render var = absolute `globalMemoryDir()`.

**b. Memory protocol** — instructions telling the agent when/how to append:

- When you observe a **durable** preference or correction during a turn — a choice
  the designer will want applied to future frames, not a one-off tweak to *this*
  frame — append one line to the right `LEARNED.md`:
  - a fact that's specific to this project → project `memory/LEARNED.md`
  - a cross-project taste/preference → global `{{GLOBAL_MEMORY}}/LEARNED.md`
- Line format: `- <fact> <!-- YYYY-MM-DD -->`
- Before appending, read the target file and check for a near-duplicate; update
  the existing line rather than piling on a second.
- NEVER edit `RULES.md` (human-owned). Only ever append/update `LEARNED.md`.
- Do NOT record: secrets/PATs, volatile file paths, or this-frame-only details
  ("made this heading bigger"). Record taste, conventions, recurring corrections.
- This memory bookkeeping is silent — it does NOT count as the turn's file change,
  does NOT appear in the journey lines, and does NOT go in the `### Deviations`
  section. A frame edit is still required on a frame-editing turn.

**c. Explicit `remember:`** — documented convention, no new parsing code:

- If the user's prompt contains a `remember:` instruction (e.g. "remember: always
  use teal accents"), write the stated fact verbatim to `LEARNED.md`. Pick project
  vs global from context; if genuinely ambiguous, default to project and note it.
- A bare `remember:` turn with no frame work is allowed to produce no frame change
  and no `### Deviations` section — it's a memory write, not a build.

Both `refreshStaleClaudeMd` ([server/projects.ts:327-356](../../server/projects.ts))
and `createProject` ([server/projects.ts:117](../../server/projects.ts)) render the
template, so both must pass the new `GLOBAL_MEMORY` var. Adding the var changes the
rendered output, so existing projects' CLAUDE.md will be refreshed on next boot
(and their `sessionId` cleared — expected, already how template changes propagate).

### 4. Seeding (idempotent, never overwrites)

A single `ensureMemoryStubs(dir)` helper writes `RULES.md` + `LEARNED.md` stubs in
`dir` only if absent.

- **Project**: call in `createProject` after `mkdir`
  ([server/projects.ts:110-125](../../server/projects.ts)) — `mkdir memory/` then
  `ensureMemoryStubs(projectMemoryDir(slug))`.
- **Global**: call once at server boot, next to `refreshStaleClaudeMd`'s caller, so
  `globalMemoryDir()` exists before the first turn's `--add-dir`.
- **Backfill existing projects**: `refreshStaleClaudeMd` already iterates every
  project on boot — add `ensureMemoryStubs(projectMemoryDir(p.slug))` to that loop
  so projects created before this feature get their `memory/` dir.

Stub contents:

```md
<!-- RULES.md — your standing instructions for <scope>. Hand-written.
     The generator reads this every turn but never edits it. -->
```

```md
<!-- LEARNED.md — facts the generator remembers about <scope>.
     Auto-appended during generation; safe to edit or prune by hand. -->
```

## Data flow (one turn)

1. User sends a prompt for project `<slug>`.
2. `chat.ts` spawns the subprocess with cwd `<projectDir>` and
   `--add-dir [PROTOTYPER, ARCADE_GEN, globalMemoryDir()]`.
3. Subprocess reads the project `CLAUDE.md`; its `@import` lines pull in all four
   memory files (two global by absolute path, two project relative to cwd).
4. Agent builds the frame, honoring rules + learned facts.
5. If the agent noticed something durable, it appends a line to the appropriate
   `LEARNED.md` (project file via cwd, global file via the `--add-dir`'d folder).
6. Next turn — same or different project — re-reads the now-updated files.

## Error handling

- **Missing memory file**: `@import` of an absent file degrades gracefully (Claude
  warns and continues, same as today's `@DESIGN.md` fallback note). Seeding makes
  absence rare; we don't hard-fail a turn over it.
- **Missing global memory dir at spawn**: prevented by boot-time seeding. Defensive:
  `ensureMemoryStubs` runs before the dir is `--add-dir`'d.
- **Agent edits RULES.md anyway**: mitigated by prompt instruction only (no
  filesystem enforcement in this scope). The append-only contract is a convention,
  not a lock. Acceptable for v1; a PostToolUse guard could enforce it later.
- **Corrupt/huge LEARNED.md**: not guarded in v1. Files are user-visible and
  prunable. If a file exceeds normal size the existing per-turn token budget
  pressure is the natural backstop.

## Testing

- `server/paths.test.ts` — `globalMemoryDir()` / `projectMemoryDir()` resolve under
  `studioRoot()` / `projectDir()`; respect `ARCADE_STUDIO_ROOT` override.
- `server/projects.test.ts` — `createProject` seeds `memory/RULES.md` +
  `memory/LEARNED.md`; `ensureMemoryStubs` is idempotent (second call does not
  overwrite edited content); `refreshStaleClaudeMd` backfills `memory/` for a
  project that lacks it.
- `server/claudeCode.test.ts` — spawn args include `--add-dir <globalMemoryDir>`.
- Template render test — rendered CLAUDE.md contains the four `@import` lines and a
  resolved absolute `GLOBAL_MEMORY` path (no unreplaced `{{GLOBAL_MEMORY}}`).

## Out of scope (YAGNI)

- No Studio UI panel for reading/editing/deleting memory entries.
- No JSON store in `settings.json` / `project.json`.
- No override/merge/precedence logic between levels.
- No post-session distill-and-confirm pass.
- No per-fact file splitting or index file (single LEARNED.md per level).
- No filesystem enforcement of the RULES.md read-only / LEARNED.md append-only
  contracts (prompt-instruction only in v1).
