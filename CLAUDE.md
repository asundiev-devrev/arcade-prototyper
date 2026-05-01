# CLAUDE.md

This repo contains **two independent products**. Start here before reading anywhere else so you don't confuse them.

## The two products

### 1. Arcade Prototyper — a Claude Code skill (top level of the repo)

Installed by users into `~/.claude/skills/arcade-prototyper/`. Turns any Claude Code session into a "generate a one-off HTML prototype from a sentence" tool. Source of truth for skill behavior is `SKILL.md` + `DESIGN.md`. No build step, no runtime — it's just instructions for another Claude instance to follow.

### 2. Arcade Studio — a standalone desktop app (`studio/` directory)

A Vite-served localhost app packaged into a macOS `.dmg`. Beta testers open the app, type prompts, and watch an embedded Claude Code subprocess generate React frames into their project directory. Much bigger codebase than the skill: Vite middleware server, React shell, packaging scripts, integrations with Figma/DevRev/Vercel/AWS Bedrock.

**When in doubt, the user almost always means Studio.** Signals: "the app", "the DMG", "beta tester", "generate a frame", "share to Vercel", "studio", "Settings modal", "sidebar".

## Which to work in

**Work inside `studio/`** (and read `studio/CLAUDE.md` first) when the user mentions:
- Chat / prompts / "Thinking…" / the generator
- Figma connection, Vercel share, DevRev PAT, AWS Bedrock
- Settings modal, version label, changelog
- The `.dmg`, the packaged `.app`, beta testers
- `pnpm run studio`, `pnpm run studio:test`, `pnpm run studio:pack`

**Work at the repo root** only when the user mentions:
- `SKILL.md`, `DESIGN.md` (Stitch), `/skills/`, skill installation
- `README.md` changes that describe the skill itself

## Conventions (repo-wide)

- **Package manager is pnpm.** `npm install` / `yarn` will break the lockfile — always `pnpm`.
- **Commits use Conventional Commits**: `fix(studio/chat): ...`, `feat(studio/packaging): ...`, `docs(studio): ...`. Scope is the area touched (usually `studio/<area>`). See `git log --oneline` for the pattern.
- **Never `git add -A` or `git add .`** — the repo has loose screenshots and scratch files in the root that shouldn't be committed. Always stage explicit paths.
- **Auto memory at `~/.claude/projects/-Users-andrey-sundiev-arcade-prototyper/memory/`** has durable learnings; consult it when relevant.

## Non-obvious facts that catch fresh agents

- The repo root has no `package.json` for the skill — only for the studio build. `pnpm run studio:*` scripts live at the root but operate on `studio/`.
- `studio/` is a **sibling**, not a workspace member. It shares `node_modules` with the root via path aliases; there's no `pnpm-workspace.yaml`.
- Many one-off files in the repo root (screenshots, `.py` helpers, cache JSON) are untracked by design — don't try to add or delete them unprompted.
