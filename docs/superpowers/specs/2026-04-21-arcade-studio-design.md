# Arcade Studio — Design Spec

**Date:** 2026-04-21
**Status:** Approved (brainstorm phase complete)
**Owner:** Design System team
**Working name:** `arcade-studio`

---

## 1. Summary

Arcade Studio is an internal macOS tool that lets DevRev designers prototype features against the real arcade-gen design system through a conversational agent, with optional Figma reference as input. It is inspired by Pencil and Claude Design, narrowed to a single use case: production-grade DevRev prototypes.

The tool is a wrapper around Claude Code. The agent does the actual file editing; the tool provides the designer-first UX, project management, figma-cli integration, and live multi-frame rendering. AWS Bedrock auth comes for free via Claude Code's existing SSO flow.

The tool is delivered as a new workspace (`studio/`) inside the existing `arcade-gen` repository, parallel to `playground/`. Designers run it via `pnpm studio`. Electron packaging is a v-next goal, not v1.

## 2. Target user and use case

**User.** DevRev designers on macOS. Single-user, internal. Designers know design language, not engineering. They have Figma Desktop installed. They do not typically have Node, pnpm, or figma-cli installed — the tool must handle first-run setup silently, matching the existing arcade-prototyper skill's behavior.

**Use case.** Turn a design idea (text prompt, Figma URL, or reference image) into a working, interactive prototype built from real arcade-gen components, with enough fidelity to feel like production. Iterate conversationally across multiple screens in a single user-journey flow. Come back tomorrow and keep going.

**Not the use case.** Drawing tools. Open-ended code authoring. Production handoff. Multi-user collaboration. Mobile-first responsive design workflows. None of these are goals for v1.

## 3. Core product decisions

| Decision | Choice | Rationale |
|---|---|---|
| Session model | Conversational with live artifact | Matches Claude.ai Artifacts / Claude Design pattern. Supports iteration without losing context. |
| Artifact output | Live React app using real arcade-gen components | Pixel-parity with production. Uses the 47 real components, tokens, and Chip fonts that ship in arcade-gen. |
| Rendering | Files on disk + Vite HMR | Real build environment. Supports Tailwind v4, token CSS imports, chart deps, multi-file prototypes. |
| Figma integration | figma-cli for v1, Figma Dev Mode MCP later | figma-cli gives annotations and full Plugin API access. MCP requires Code Connect, which waits on arcade-gen being official. |
| Form factor v1 | Local web app (browser + Vite) | Fast to build, easy to iterate, works with figma-cli (requires local Figma Desktop). |
| Form factor v-next | Electron desktop app | Target end-state: no Node/pnpm setup, double-click to launch. After core UX stabilizes. |
| LLM integration | Claude Code as subprocess | Inherits AWS Bedrock auth from designer's `aws sso login --profile dev`. No re-implementation of agentic loop, tool use, file editing, streaming, or session resume. |
| Layout | Chat left (~380–420px fixed), viewport right | Claude Artifacts-like shell, with a Pencil-style journey row inside the viewport. |
| Viewport shape | Horizontal row of frames, tall vertical screens, horizontal scroll | Matches user-journey mental model. Supports "see all screens in the flow at once." |
| Frame creation | Hybrid — agent proposes, designer accepts | Agent-driven speed with user-editable naming and deletion. |
| Multi-frame logic | Described in chat only | No in-tool navigation wiring UI for v1. Prototypes are interactive within a frame (button clicks, modals, tabs). |
| Theme overrides | Local `theme-overrides.css` per project | Never touches arcade-gen source. No "promote to library" PR flow in v1. |
| Persistence | Named projects, all local on disk | No cloud sync, no sharing links. Project folder = portable unit. |
| Figma input modes | Paste URL in chat OR "+ From Figma" action chip | Both conversational and explicit. Matches how designers actually work. |
| Image input | Drag and paste into chat | Free via clipboard / drop handlers. Claude is multimodal. |
| Theme toggle | Global (light/dark), plus explicit chat overrides | Single toggle in header. Per-frame logic stays conversational. |
| Frame chrome | Naked frame with label above | Clean. Size presets in a hover corner menu. No bezels or browser chrome. |
| First-time UX | Project list screen with "+ New project" | Familiar pattern (Figma, VS Code). Projects are the unit of work. |
| Designer-first principle | Narrate tool calls in plain language. Plain-language errors. Dev mode as read-only escape hatch. | Eventually a designer will want to take the code away; Dev mode gives them that without cluttering day-to-day UX. |

## 4. Architecture

### 4.1 Process topology

A single Vite dev server backs the whole tool. One browser tab. Two panes. Behind the scenes:

```
Browser tab (localhost:5556)
  └── Vite dev server (studio root)
       ├── Chat UI + Viewport UI (React, uses arcade-gen itself)
       ├── Middleware: /api/chat                            → spawns Claude Code subprocess
       ├── Middleware: /api/projects                        → reads/writes project folders
       ├── Middleware: /api/figma                           → invokes figma-cli
       └── Middleware: /api/frames/:projectSlug/:frameSlug  → serves each frame's rendered React
```

The tool dogfoods arcade-gen: its own chrome (buttons, inputs, chat bubbles, modals, side panels) uses arcade-gen components with the Arcade theme.

### 4.2 On-disk layout

All state is local, on the designer's Mac:

```
~/Library/Application Support/arcade-studio/
  projects/
    <project-slug>/
      project.json              # name, created, updated, theme, frames metadata, sessionId
      CLAUDE.md                 # project conventions (auto-generated)
      DESIGN.md                 # arcade-gen component + token reference (auto-generated)
      theme-overrides.css       # local DS overrides — never modifies arcade-gen
      shared/                   # shared React primitives used across frames
        Header.tsx
        ...
      frames/
        01-welcome/
          index.tsx             # frame's root component; default export renders the frame
          ...                   # additional frame-local files as needed
        02-signup/
          index.tsx
      chat-history.json         # full conversation transcript (tool-managed)
      thumbnails/
        01-welcome.png          # first-frame screenshots for project card cache
```

Claude Code's own session files live in their default location (`~/.claude/projects/<sanitized-path>/`) and are referenced by `sessionId` in `project.json`.

### 4.3 Frame rendering

Each frame is a real React module served at a live URL by the Vite dev server. A custom Vite plugin mounts `frames/<slug>/index.tsx` from arbitrary project directories at `/api/frames/<project-slug>/<frame-slug>`. The viewport uses one `<iframe>` per frame, pointing at these URLs. Vite watches the project directory; file changes trigger HMR, iframes reload inline.

Projects do not install their own dependencies. A Vite alias in `studio/vite.config.ts` maps `import ... from "arcade"` directly to arcade-gen's source at `../src` (since studio lives alongside `playground/` inside the arcade-gen repo). React, Tailwind, charts, and all other runtime deps resolve through the shared `node_modules` at the repo root. The cost of extraction later (publishing arcade-gen or workspace linking) is noted in Risks §7 R3.

Theme overrides in each project's `theme-overrides.css` are loaded only inside frame iframes, scoped to each project. Studio chrome is served from the studio root and is unaffected. Iframes have distinct document scopes, so CSS custom properties on `:root` do not leak between studio and frames.

### 4.4 Claude Code integration

Every chat turn spawns:

```bash
claude \
  -p "<user message>" \
  --resume "<session-id>" \
  --output-format stream-json \
  --cwd "<project-dir>" \
  --allowed-tools Read,Edit,Write,Glob,Grep,Bash(figma-cli:*)
```

First turn omits `--resume`; the tool captures the session ID from Claude Code's first event and stores it in `project.json`. Subsequent turns always pass `--resume`.

Stdout is parsed as a stream of stream-json events: narration (from `assistant` messages), tool calls (`tool_use`), tool results (`tool_result`). The chat UI transforms these into plain-language lines and inline previews, never exposing raw tool call names.

The environment for the subprocess is configured with `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION=us-east-1`, and inherits the designer's AWS SSO credentials from the default credential chain. The tool itself never touches these credentials.

The `@anthropic-ai/claude-code` npm package is pinned in `studio/package.json`'s `devDependencies`, and its `claude` CLI bin is invoked from `node_modules/.bin/claude` — never from the designer's global install — to avoid stream-json format drift across versions.

### 4.5 Agent grounding

Each project starts with two generated files at its root:

**`CLAUDE.md`** — mechanical, project-specific conventions:
- Where frames live (`frames/<slug>/index.tsx`, default-exports the component)
- Where shared primitives go (`shared/`)
- How to override the DS (`theme-overrides.css`; never modify `node_modules/`, never touch arcade-gen)
- Which tools are allowed (Read, Edit, Write, Glob, Grep, `Bash(figma-cli:*)`)
- Hard rules: no hardcoded hex, no package installs, stay inside the project dir

**`DESIGN.md`** — generated from arcade-gen source:
- Component inventory with brief usage for each (`<Button>`, `<Table>`, `<Chart>`, etc.)
- Semantic token guide (text, background, border, feedback, action, intelligence)
- Typography scale + Chip font weight rules (440/540/660 — never 400/500/700)
- Arcade vs DevRev App theme distinction
- Common layout patterns (app shell, centered content, header bar)

`DESIGN.md` is regenerated on every studio launch by a script that walks arcade-gen's own `src/components/` and `src/tokens/generated/` (one directory up from `studio/`). The result is copied into each project on first open, and updated on demand via a "refresh design reference" action in Dev mode. This keeps it in sync as arcade-gen evolves without forcing existing projects to adopt new DS changes mid-flow.

### 4.6 Figma integration

figma-cli runs locally against the designer's Figma Desktop via its local socket (no API token, no REST API, no plugin). Studio wraps it in a `/api/figma` middleware that exposes three primary operations:

- Read frame metadata and node tree for a given Figma URL / node ID
- Read annotations (Dev Mode notes) on a node and its children
- Export SVGs for vector nodes / icons to a scratch directory

The agent invokes these via `Bash(figma-cli:*)` when a Figma URL appears in context. The chat UI detects Figma URLs in user messages and in the "+ From Figma" action; when detected, the message to the agent is shaped to include a hint ("Build a new frame from this Figma URL: ...").

When arcade-gen graduates to official and Code Connect becomes viable, the `/api/figma` implementation swaps to Figma Dev Mode MCP with no agent-side changes — the agent still sees "figma tool calls," not CLI specifics.

### 4.7 Auth

The tool assumes the designer has run `aws sso login --profile dev` in a terminal at some point in the current session. Claude Code reads credentials from the standard AWS credential chain (env vars, then shared config, then SSO cache). The tool's UI never prompts for or stores AWS credentials.

If credentials are missing or expired when a turn is attempted, Claude Code's subprocess emits an auth error. The tool detects this in the stream, surfaces a plain-language message, and shows the exact command: `aws sso login --profile dev`. The in-flight user message is preserved so the designer can retry after re-authenticating.

## 5. UI and interaction

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  ◄ Projects   •   Project Name                  [☀/☾]  [Dev ⎔]    │  Header
├──────────────────┬─────────────────────────────────────────────────┤
│                  │                                                 │
│                  │   ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│                  │   │          │  │          │  │          │     │
│                  │   │  Welcome │  │  Sign up │  │  Verify  │     │
│    Conversation  │   │          │  │          │  │          │     │
│                  │   │          │  │          │  │          │     │
│                  │   └──────────┘  └──────────┘  └──────────┘     │
│                  │   ← horizontal scroll through frame row →      │
│                  │                                                 │
│  [Prompt input]  │                                                 │
└──────────────────┴─────────────────────────────────────────────────┘
```

**Header.** Thin (44–48px). Left: "◄ Projects" link back to the list, separator, inline-editable project name. Right: global theme toggle, Dev mode toggle.

**Chat pane.** Fixed 380–420px width. Message bubbles use arcade-gen's `ChatBubble`. Designer messages right-aligned, agent messages left-aligned. Agent narration lines ("Reading Figma frame…", "Creating Welcome screen…") render as lightweight secondary-text lines between bubbles, not as full bubbles. Tool results that matter — screenshots, Figma reference thumbnails — render inline as small cards.

Prompt input at the bottom: textarea, Cmd+Enter sends. Small chips directly above: "📎 Attach image", "🎨 Paste Figma URL". Drag/paste into the input attaches an image as a thumbnail above the input; send includes the image.

**Viewport pane.** Horizontal row of frames, horizontal scroll. Each frame:
- Naked (no bezel, no browser chrome)
- Title label above the frame (inline-editable on hover)
- Hover corner menu (small icon button): size presets (375 / 1024 / 1440 / 1920), rename, duplicate, delete
- Tall vertical — fills available viewport height by default
- Frames separated by `--spacing-global-lg` (32px)

Background is a subtle neutral (`--surface-backdrop`).

**Empty viewport.** Centered muted prompt: "Describe what you want to build — or drop a Figma frame into the chat." Drop-target outline appears when the designer drags an image/file over the viewport.

**Dev mode panel.** Slides in from the right when toggled. Read-only file tree of the current project. Clicking a file previews its contents. A "Reveal in Finder" button opens the project folder for the designer who wants to edit code directly. Not an in-tool editor — it's an escape hatch.

### 5.2 Project list (home screen)

Full-width grid or list. Each card shows:
- Project name
- Last-modified date
- Thumbnail of the first frame (cached PNG from last render)
- Overflow menu: rename, duplicate, delete, reveal in Finder

Top-right: "+ New project" primary button. Top-left: search input for name filtering.

"+ New project" opens a modal asking for name and starting theme (Arcade / DevRev App). On submit, scaffolds the project directory with empty `frames/`, empty `shared/`, templated `CLAUDE.md`, generated `DESIGN.md`, empty `theme-overrides.css`, empty `chat-history.json`. User lands in the project detail view with the chat pane focused.

### 5.3 Interaction patterns

**Starting a conversation.** Designer types a prompt, hits Cmd+Enter or clicks Generate. Server spawns `claude -p ...`. Stream events render live:
- Narration lines appear as they arrive
- Tool calls render as narration ("Reading your Figma frame…")
- File writes trigger the viewport's file watcher; new/modified frames appear with a subtle fade-in animation

**Following up.** Same flow, with `--resume <sessionId>`. Claude Code loads prior context automatically.

**Common command patterns** (agent interprets these naturally):
- "Change the button on screen 2 to outlined" → edits `frames/02-signup/index.tsx`
- "Make all primary buttons rounded" → edits `theme-overrides.css`, affects all frames
- "Show me the dark mode version" → edits the root theme wrapper
- "Add a confirm dialog here" → wires an interactive modal into the frame
- "Undo that" → natural-language undo; agent interprets and reverts

**Figma import.** Paste URL in chat → agent detects it, invokes figma-cli, reads frame + annotations, exports SVG icons to scratch dir, generates the corresponding prototype frame using DESIGN.md's token-mapping guidance. Or use "+ From Figma" chip → small form for URL paste → pre-shaped message sent to agent.

**Image attachment.** Drag or paste an image into the prompt area → thumbnail above the input → sent with the user message. Agent uses the image as visual reference for generation.

**Frame creation.** Agent creates frames as part of its natural file edits. File watcher detects new `frames/<slug>/` directory, tool animates a new frame into the viewport row. Name is whatever the agent chose; inline-editable on hover.

**Closing and reopening.** Close the tab at any time. State is on disk: `project.json`, `chat-history.json`, `sessionId` in project.json, frames/ folder. Next launch: click the project card → full rehydration (chat history loaded, viewport re-renders each frame, next turn resumes the same Claude Code session).

### 5.4 Error handling

| Condition | Designer sees |
|---|---|
| Figma Desktop not running | "I couldn't reach Figma Desktop. Open Figma and try again." |
| figma-cli not installed | Silent install on first use (Homebrew → Node → pnpm → figma-cli via `pnpm link`), matching the `arcade-prototyper` skill's pre-flight. If that fails: "I couldn't set up Figma access. Your Mac might ask for your password." |
| Claude Code subprocess crash | "Something went wrong. Let me try that again." + one automatic retry. Second failure: plain message + "Copy diagnostic info" (hidden behind Dev mode). |
| Frame build error (TypeScript/Vite) | Small banner at the bottom of the affected frame: "This frame has a rendering issue. I'll fix it." Tool auto-sends a follow-up turn with the error. |
| AWS SSO expired | "Your AWS session looks expired. Run `aws sso login --profile dev` in a terminal and try again." Preserves in-flight user message. |

Raw stack traces and technical errors are never surfaced to the main UI. They live behind the Dev mode "Copy diagnostic info" action.

## 6. Execution plan

Sequenced as one serial phase (conventions) followed by three parallel waves, each with a half-day integration checkpoint before the next wave starts.

### Phase 0 — Scaffolding (serial, ~1 day, 1 agent)

- Add `studio/` workspace to arcade-gen, alongside `playground/`
- Vite config, TypeScript, Tailwind v4 (inheriting playground's setup)
- `pnpm studio` script in root `package.json`
- Base React shell: theme provider, Chip fonts, empty header + project list + empty viewport
- First-launch initialization of `~/Library/Application Support/arcade-studio/`

This sets the conventions (directory structure, script names, Vite alias config for `arcade` imports) that every subsequent agent depends on.

### Wave A — Independent foundations (parallel, ~3 days, 3 agents)

- **A1 — Project lifecycle.** Project list screen, new-project modal, `project.json` CRUD, card thumbnails (placeholder), inline rename and delete. Pure UI + filesystem.
  - *Success:* create/list/delete/rename projects on disk.
- **A2 — Claude Code subprocess.** `/api/chat` middleware. Spawns `claude -p ...`, parses stream-json, streams events via SSE. Session ID capture, persistence in `project.json`, `--resume` threading. Tested via curl.
  - *Success:* send prompt → receive streaming events → see file written to project dir.
- **A3 — Figma-cli wrapper.** `/api/figma` middleware wrapping figma-cli (read frame, read annotations, export SVG, screenshot). Standalone tests against a real Figma Desktop.
  - *Success:* hit `/api/figma/frame?url=...` → structured JSON response.

**Integration checkpoint (0.5 day).** Wire chat UI to A2 stream, verify project switching uses the right session ID.

### Wave B — Rendering and grounding (parallel, ~3 days, 3 agents)

- **B1 — Frame rendering.** Vite plugin mounting `frames/<slug>/index.tsx` at a served URL. Horizontal-row viewport UI, one iframe per frame, file watcher → live HMR, frame corner menu (size presets, rename, duplicate, delete).
  - *Success:* dropping a `.tsx` file in `frames/` makes it appear in the viewport.
- **B2 — DESIGN.md generator.** Script that walks `src/components/` and `src/tokens/generated/`, emits a structured `DESIGN.md`. Runs on studio launch and on demand.
  - *Success:* running the script produces a file reflecting arcade-gen's current state.
- **B3 — Grounding templates.** `CLAUDE.md` template with project conventions, rules, tool permissions. Example-prompt chips in the new-project empty state. DESIGN.md reference wiring (so the agent pulls it into context via CLAUDE.md).
  - *Success:* a new project starts with a working `CLAUDE.md` that references `DESIGN.md`.

**Integration checkpoint (0.5 day).** First end-to-end: "build a login screen" → agent writes file → frame renders → DS fidelity check (tokens, typography, components).

### Wave C — Interaction polish (parallel, ~2 days, 2 agents)

- **C1 — Figma and image inputs.** URL detection in chat, "+ From Figma" action chip + form, drag/paste image handling with thumbnails, image-to-agent channel. Wires A3's middleware into the chat flow.
  - *Success:* paste a Figma URL → agent creates a matching frame. Drop a PNG → agent builds from it.
- **C2 — UI polish.** Global theme toggle wired to frames. Dev mode panel (read-only file tree + "Reveal in Finder"). Project card thumbnails captured from first frame render. Empty states, loading states, error states — tightened using arcade-gen components.
  - *Success:* tool's own UI uses arcade-gen consistently; every state has a designed treatment.

**Integration checkpoint (0.5 day).** Full MVP walkthrough — create project → prompt → Figma import → image attachment → theme toggle → Dev mode reveal.

### Phase ∞ — Hardening (serial, ongoing, 1 agent at a time)

- Frame build-error recovery loop (auto-prompt agent on TypeScript/Vite errors)
- AWS SSO expiry detection and guidance
- Session resumption edge cases (deleted sessions, corrupt `project.json`)
- Silent first-run dependency install (Node, pnpm, figma-cli) matching the current skill's behavior

### Estimate

~10 calendar days to MVP with 3 parallel agents per wave. ~14 days serial. Execution itself is driven by a coordinator + wave-worker pattern following the `superpowers:dispatching-parallel-agents` skill — each worker agent runs isolated with a self-contained prompt; the coordinator holds architectural context and verifies integration checkpoints.

## 7. Risks and mitigations

**R1 — Claude Code subprocess stability.** Long sessions with large projects could hit session corruption, failed `--resume`, or stream-json format drift. Mitigation: pin `@anthropic-ai/claude-code` version, back up session files, provide a "start fresh" fallback for corrupted sessions, never block the user on resume failure.

**R2 — Vite HMR across arbitrary project directories.** Vite is designed for a single project root, not arbitrary subdirectories. Serving `frames/<slug>/index.tsx` from outside the studio app requires either (a) a Vite plugin with virtual modules, (b) nested Vite dev servers per project, or (c) workspace aliasing. Option (a) is the intended path; prototype in Wave A before committing Wave B. If HMR proves unreliable, fall back to full iframe reload on file change (less snappy but simple).

**R3 — Shared `node_modules`.** Projects resolve `arcade` imports through studio's own `node_modules` via Vite alias. This works because studio lives inside arcade-gen. If the tool is later extracted to its own repo, this needs revisiting (publish arcade-gen, or use workspace linking).

**R4 — Per-project theme override isolation.** `theme-overrides.css` in a project must scope to that project's iframes and not affect the studio chrome. Iframes have distinct document scopes, so this should work naturally. Verify in Wave B.

**R5 — figma-cli as a moving target.** figma-cli is a community CLI. If it breaks with a Figma Desktop update, the tool breaks. Mitigation: all calls go through `/api/figma`, so the implementation is swappable. When arcade-gen graduates and Code Connect is viable, swap in Figma Dev Mode MCP without touching the agent.

**R6 — AWS Bedrock session expiry mid-turn.** SSO tokens expire. If expiry hits during generation, the stream fails. Mitigation: detect auth errors in-stream, show plain-language re-login prompt, preserve in-flight user message. Don't silently refresh tokens.

**R7 — First-run install friction.** Designers don't have Node/pnpm/figma-cli. Mitigation: pre-flight script on first launch detects missing deps and installs silently (Homebrew → node → pnpm → figma-cli), matching the current skill's behavior. Password prompt only for the whole install, not per-tool.

**R8 — DESIGN.md drift.** If the generator lags behind arcade-gen changes, projects reflect stale component lists. Mitigation: regenerate on every studio launch; on-demand refresh button in Dev mode.

**R9 — Claude Code context window bloat.** Long conversations + large DESIGN.md + many frames could exceed context. Claude Code auto-compacts, so usually fine. Mitigation: keep DESIGN.md lean — link to arcade-gen source files rather than inlining everything; keep CLAUDE.md mechanical and short.

## 8. Open questions deferred to later

- **Upgrade flow.** When arcade-gen adds new components, what does a designer do? Baseline answer: `pnpm install` from studio's root, DESIGN.md regenerates on next launch. Needs documentation and probably automation (a "studio is out of date" prompt in the header).
- **Analytics.** Not in v1.
- **Ownership and path split.** v1 lives inside arcade-gen. If the tool eventually ships independently, the extraction path is non-trivial — `node_modules` sharing, the Vite alias setup, the DESIGN.md generator all need rework. Decide when the tool is proven, not now.

## 9. v-next (explicit non-goals for v1)

- Electron packaging
- Figma Dev Mode MCP integration (via Code Connect on arcade-gen)
- Project sharing and export (link or static bundle)
- Multi-frame click-through navigation UI
- "Promote to arcade-gen" flow for theme overrides
- Multi-user collaboration
- In-tool code editor
- Undo/redo beyond natural-language "undo that"
- Session branching

## 10. Definition of done for v1

- A designer can `pnpm studio` from a cloned arcade-gen repo and see the project list screen.
- They can create a new project, type "Build a dashboard with a bar chart and a data table," and see a real React app rendered in the viewport using arcade-gen components.
- They can paste a Figma URL, and the tool creates a frame that visually matches the Figma design with DS tokens applied correctly.
- They can iterate conversationally — "change this color," "add a sidebar," "show me the dark mode" — and the frame updates live.
- They can close the tab, relaunch, and pick up where they left off with full chat history and session continuity.
- They can never see raw tool call names, file paths in their primary UI, stack traces, or AWS credentials.

---

*Spec authored in brainstorming session on 2026-04-21. Next step: invoke the `superpowers:writing-plans` skill to produce a detailed implementation plan organized around the Phase 0 → Wave A → Wave B → Wave C structure, with coordinator/worker prompts for parallel agent dispatch.*
