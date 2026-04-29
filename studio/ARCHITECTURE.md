# Architecture

Studio is three things stitched together:

1. A **Vite + React frontend** (`src/`) that runs the project list, chat pane, and viewport grid.
2. A **Node server** that lives as Vite middleware and custom plugins (`server/`), exposing a small REST/SSE API and orchestrating subprocesses.
3. A **Claude subprocess** (`@anthropic-ai/claude-code` CLI) spawned per chat turn, writing React source files directly into the project's `frames/` directory.

Vite's file watcher, a Chokidar watcher, and its websocket HMR loop tie these together so that when the agent writes a frame file on disk, the iframe viewport reloads automatically.

## System diagram

```
┌───────────────────────── browser (localhost:5556) ─────────────────────────┐
│  React frontend (src/)                                                     │
│    ProjectList  ──────────────────────────────────────────────────────┐    │
│    ProjectDetail                                                      │    │
│      ├── ChatPane     →  useChatStream  →  SSE /api/chat              │    │
│      ├── Viewport     →  <iframe src="/api/frames/:slug/:frame">      │    │
│      └── DevModePanel →  /api/projects/:slug/tree, /file?path=...     │    │
└───────────────────────────────────────────────────────────────────────┬────┘
                                                                        │
┌──────────────── Vite dev server (studio/vite.config.ts) ──────────────┴────┐
│  Middleware:                                                               │
│    chatMiddleware       POST /api/chat         (SSE, spawns claude)        │
│    projectsMiddleware   CRUD /api/projects/*                               │
│    figmaMiddleware      /api/figma/* (proxy to figma-cli)                  │
│    uploadsMiddleware    POST /api/uploads/:slug                            │
│    preflightMiddleware  GET  /api/preflight  (dep check)                   │
│    fontsMiddleware      GET  /api/fonts/:name (DevRev CDN proxy)           │
│                                                                            │
│  Plugins:                                                                  │
│    frameMountPlugin        serves /api/frames/:slug/:frame as React HTML   │
│    projectWatchPlugin      Chokidar → reconcileFrames + full-reload        │
│    injectStudioSourcePlugin appends `@source` to Tailwind globals.css      │
│                                                                            │
│  Subprocess orchestration:                                                 │
│    runClaudeTurn → spawn node_modules/.bin/claude --output-format stream-json
│    ensureFigmaFileSelected → CDP on localhost:9222                         │
│    ssoIsValid → `aws sts get-caller-identity`                              │
│    attachBuildErrorReporter → listens to `vite:error`, dispatches auto-fix │
└──────────────┬─────────────────────────────────────────────────┬───────────┘
               │                                                 │
               ▼                                                 ▼
   ~/Library/Application Support/                   Claude CLI (Bedrock)
        arcade-studio/projects/<slug>/              Figma Desktop + figma-cli
```

## Core flows

### 1. Create project

`ProjectList` "+ New project" button → `POST /api/projects` → `server/projects.ts:createProject()`:

1. Slugify the name, ensure unique.
2. `mkdir` `{projectDir}/{frames,shared,thumbnails}`.
3. Write `project.json` (theme, mode, empty frames).
4. Render `templates/CLAUDE.md.tpl` with `{{PROJECT_NAME}}` and `{{THEME}}`, write `CLAUDE.md`.
5. Write empty `chat-history.json` and `theme-overrides.css`.

Response: the new `Project` object; the frontend opens `ProjectDetail`.

### 2. Chat turn

`PromptInput` calls `useChatStream.send(prompt, images)`:

1. Images are uploaded first to `POST /api/uploads/:slug` (`uploadsMiddleware`, 10 MB cap, writes to `_uploads/`).
2. `POST /api/chat {slug, prompt, images}` opens an SSE stream.
3. `chatMiddleware`:
   - Calls `ssoIsValid()` (30 s cache). If expired, sends a synthetic `end ok:false error:"AWS SSO credentials expired..."` event and closes.
   - `ensureFigmaFileSelected(prompt)` — if the prompt contains a Figma URL, uses CDP on `localhost:9222` to close other `/design` tabs in Figma Desktop.
   - Appends the user message to `chat-history.json`.
   - `runClaudeTurn()` spawns the Claude CLI with the project's `CLAUDE.md` as its working context:
     ```
     node_modules/.bin/claude
       -p "<prompt>\n\nReference images:\n@<abs path>"
       --output-format stream-json --verbose
       --dangerously-skip-permissions
       --allowed-tools Read,Edit,Write,Glob,Grep,Bash
       --disallowed-tools mcp__figma-console
       --add-dir <arcade-gen root>
       [--resume <sessionId>]
     ```
     Env: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION=us-east-1`. Timeout 8 min.
4. Claude streams JSON lines on stdout; `lib/streamJson.ts:parseStreamLineAll()` converts them into `StudioEvent`s (`session`, `narration`, `tool_call`, `tool_result`, `end`).
5. Each event is forwarded as SSE: `event: <kind>\ndata: <json>\n\n`.
6. The first event of a new turn carries the Claude `sessionId`; studio stores it on `project.json` so the next turn can `--resume`.

### 3. Agent writes a frame

The Claude subprocess uses its `Write` tool to place `{projectDir}/frames/<frame-slug>/index.tsx`. From that point studio takes over:

1. `projectWatchPlugin` (Chokidar on `projectsRoot`, depth 6) sees the `.tsx` change.
2. It calls `reconcileFrames(slug)` — walks `frames/`, updates `project.frames` in `project.json` with any newly-discovered frame slugs.
3. It broadcasts `{type: "full-reload", path: "*"}` to every Vite websocket client.
4. The frontend `Viewport` re-renders, adds a `FrameCard`, and mounts `<iframe src="/api/frames/:slug/:frame">`.
5. `frameMountPlugin` serves that URL by generating HTML that imports a virtual module:
   - `resolveId("virtual:arcade-studio-frame.tsx?project=...&frame=...")`
   - `load()` dynamically imports `{frameDir}/index.tsx`, wraps it in `<DevRevThemeProvider>` → `<FrameFontProxy>` → `<FrameErrorBoundary>`, injects arcade's `globals.css`, typography, and the `core/light|dark/component` token CSS, then hands it to esbuild.
6. Vite HMRs the changed frame — the iframe updates without a reload.

### 4. Auto-fix on build error

`buildErrorReporter.ts:attachBuildErrorReporter(server)` listens for Vite's `vite:error` event.

- `parseBuildError()` extracts `slug` + `frameName` from the failing file path. If it isn't under `<slug>/frames/<frame>/...`, skip.
- Rate-limit: one auto-fix per frame per 60 s.
- On pass, fire-and-forget `runClaudeTurn()` with the project's existing `sessionId` and prompt: _"The frame `<frameName>` is failing to build with: `<message>`. Fix the smallest thing that resolves it; do not restructure."_
- The agent sees the error with prior conversation context and rewrites the frame. Never crashes Vite.

### 5. Figma integration

Two paths:

- **Screenshot for prompt** — `FigmaUrlModal` → `POST /api/figma/export` → `figmaCli.exportNodePng()` shells out to `node ~/figma-cli/src/index.js export node <id> -o <path> -s 2`. The PNG goes into `_uploads/` and is attached to the next prompt as `@<path>`.
- **Structure reads** — `GET /api/figma/node/:id` and `GET /api/figma/tree/:id?d=<depth>` proxy to figma-cli; the agent also calls `figmanage` directly via its `Bash` tool from inside the subprocess (it has the allowlist).

`figma-cli` talks to Figma Desktop via CDP on `localhost:9222`. The optional `figmaTabSelector` helper ensures the right file is the focused tab before the agent reads.

## Boundaries and layering

| Layer                  | Path                              | May import from                                      |
|------------------------|-----------------------------------|------------------------------------------------------|
| Arcade library (prod)  | `arcade-gen/src/`                 | Its own subtree only. **Must not** import studio or prototype-kit. |
| Prototype kit          | `studio/prototype-kit/`           | `arcade` primitives only                             |
| Generated frames       | `~/.../projects/<slug>/frames/*`  | `arcade` + `arcade-prototypes`                       |
| Studio UI              | `studio/src/`                     | `arcade` + studio-local modules                      |
| Studio server          | `studio/server/`                  | Node stdlib + studio-local modules                   |

The boundary rule (arcade-gen/src ⊥ prototype-kit) is enforced by `__tests__/prototype-kit-boundary.test.ts`. Imports use path aliases declared in three places that must agree:

- `studio/vite.config.ts` → `resolve.alias`
- `studio/tsconfig.json` → `compilerOptions.paths`
- `studio/vitest.config.ts` → `resolve.alias`

## Key types

Defined in `server/types.ts` (Zod schemas):

- **`Project`** — `{ name, slug, createdAt, updatedAt, theme: "arcade"|"devrev-app", mode: "light"|"dark", sessionId?, frames: Frame[] }`
- **`Frame`** — `{ slug, name, createdAt, size: "375"|"1024"|"1440"|"1920" }`
- **`ChatMessage`** — `{ id, role: "user"|"assistant"|"system", content, images?, createdAt }`

Slugs are validated against `/^[a-z0-9][a-z0-9-]{0,62}$/i`.

Frontend stream events (in `src/lib/streamJson.ts`): `session | narration | tool_call | tool_result | end`.

## Server file map

### `server/` (core)

| File                    | Responsibility                                                                                                  |
|-------------------------|-----------------------------------------------------------------------------------------------------------------|
| `projects.ts`           | Project CRUD, `reconcileFrames`, file-tree reader, `refreshStaleClaudeMd` (rewrites on template change)         |
| `claudeCode.ts`         | `runClaudeTurn()` — spawn + stream-json parse + `onEvent` callback + abort/timeout                              |
| `figmaCli.ts`           | `parseFigmaUrl`, `daemonStatus`, `getNode`, `nodeTree`, `exportNodePng` — all shell out to figma-cli            |
| `figmaTabSelector.ts`   | `ensureFigmaFileSelected(prompt)` — CDP tab management on `localhost:9222`                                      |
| `awsPreflight.ts`       | `ssoIsValid()` — cached `aws sts get-caller-identity`; env escape hatch `ARCADE_STUDIO_SKIP_SSO_CHECK=1`        |
| `firstRun.ts`           | `ensureDeps()` — checks `brew` (macOS), `node`, `pnpm`, `figmanage`                                             |
| `buildErrorReporter.ts` | `attachBuildErrorReporter`, `parseBuildError`, `handleViteError` — rate-limited auto-fix dispatcher             |
| `thumbnails.ts`         | `placeholderTint(theme)` — gradient strings per theme                                                           |
| `paths.ts`              | `studioRoot()`, `projectsRoot()`, `projectDir()`, `frameDir()`, `sharedDir()`, `chatHistoryPath()`              |
| `types.ts`              | Zod schemas: `Project`, `Frame`, `ChatMessage`                                                                  |

### `server/middleware/`

| File           | Routes                                                                                        |
|----------------|-----------------------------------------------------------------------------------------------|
| `chat.ts`      | `POST /api/chat` (SSE)                                                                        |
| `projects.ts`  | `GET|POST|PATCH|DELETE /api/projects[/:slug[/history|tree|file|reveal|frames/:frameSlug]]`    |
| `figma.ts`     | `GET /api/figma/{status, node/:id, tree/:id}`, `POST /api/figma/export`                       |
| `uploads.ts`   | `POST /api/uploads/:slug` — image upload, 10 MB cap, writes to `_uploads/`                    |
| `preflight.ts` | `GET /api/preflight` — dependency check                                                       |
| `fonts.ts`     | `GET /api/fonts/:name` — proxies DevRev font CDN (strips Referer)                             |

### `server/plugins/`

| Plugin                        | Role                                                                                           |
|-------------------------------|------------------------------------------------------------------------------------------------|
| `frameMountPlugin`            | Serves `/api/frames/:slug/:frame` as React HTML + `virtual:arcade-studio-frame.tsx` module     |
| `projectWatchPlugin`          | Chokidar watcher → `reconcileFrames` + `ws.send({type: "full-reload"})`                        |
| `injectStudioSourcePlugin`    | Appends `@source "<projectsRoot>/**/frames/**/*.{ts,tsx}"` to arcade's `globals.css`           |

## Frontend file map

### `src/` (entry + routes)

- `main.tsx` — mounts `<App />` in `<DevRevThemeProvider mode="light">`; imports arcade globals + typography + token CSS.
- `App.tsx` — trivial router: `{openSlug ? <ProjectDetail /> : <ProjectList />}`.
- `routes/ProjectList.tsx` — grid of `<ProjectCard>`, search, `+ New project` modal.
- `routes/ProjectDetail.tsx` — 3-column layout (ChatPane 400 px · Viewport · DevModePanel 320 px), mode toggle, back button.

### `src/components/`

| Dir         | Contents (purpose)                                                                                     |
|-------------|--------------------------------------------------------------------------------------------------------|
| `chat/`     | `ChatPane`, `MessageList`, `MessageBubble`, `AgentNarration`, `PromptInput`, `FigmaUrlModal`, `EmptyStatePrompts` |
| `devmode/`  | `DevModePanel` — file tree + file viewer for the open project                                          |
| `feedback/` | Error/info banners                                                                                     |
| `projects/` | `ProjectCard`, `ProjectSearch`                                                                         |
| `viewport/` | `Viewport`, `FrameCard`, `FrameCornerMenu`, `EmptyViewport`                                            |
| `Header.tsx`| Top bar (project name, mode toggle, dev panel toggle, back)                                            |

### `src/frame/`

Loaded *inside* the iframe, not in the main shell:

- `FrameErrorBoundary.tsx` — catches render errors in the generated frame.
- `FrameFontProxy.tsx` — injects `@font-face` rules pointing at `/api/fonts/*` (works around the CDN's Referer whitelist).

### `src/hooks/`

- `useChatStream` — SSE client for `/api/chat`; exposes `{busy, error, errorKind, narrations, lastEvent, lastPrompt, send, cancel, retry}`.
- `useProjects` — polling client for `/api/projects`.
- `useFrames` — polling client for project frames.

### `src/lib/`

- `api.ts` — `createProject`, `renameProject`, `deleteProject` helpers.
- `figmaUrl.ts` — `parseFigmaUrl(url) → {fileId, nodeId}`.
- `streamJson.ts` — `parseStreamLineAll()` maps Claude CLI JSON lines to `StudioEvent`s; `prettyTool(name, input)` renders human-readable tool labels.

## Environment variables

| Variable                        | Default                                                  | Purpose                                        |
|---------------------------------|----------------------------------------------------------|------------------------------------------------|
| `ARCADE_STUDIO_ROOT`            | `~/Library/Application Support/arcade-studio`            | Root for all project storage                   |
| `ARCADE_STUDIO_CLAUDE_BIN`      | `<repo>/node_modules/.bin/claude`                        | Path to the Claude CLI binary                  |
| `ARCADE_STUDIO_FIGMA_CLI_DIR`   | `~/figma-cli`                                            | figma-cli checkout location                    |
| `ARCADE_STUDIO_SKIP_SSO_CHECK`  | unset                                                    | `"1"` skips `aws sts get-caller-identity`      |
| `AWS_REGION`                    | `us-east-1`                                              | Passed to the Claude subprocess for Bedrock    |

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full setup checklist.
