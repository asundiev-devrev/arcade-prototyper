# Architecture

Studio is three things stitched together:

1. A **Vite + React frontend** (`src/`) that runs the project list, chat pane, and viewport grid.
2. A **Node server** that lives as Vite middleware and custom plugins (`server/`), exposing a small REST/SSE API and orchestrating subprocesses.
3. A **Claude subprocess** (`@anthropic-ai/claude-code` CLI) spawned per chat turn, writing React source files directly into the project's `frames/` directory.

Vite's file watcher, a Chokidar watcher, and its websocket HMR loop tie these together so that when the agent writes a frame file on disk, the iframe viewport reloads automatically.

## System diagram

The diagram below shows the *core* path (chat → spawn → frame). It is illustrative,
not exhaustive — the real server has ~21 middleware and several subsystems (Figma
kit-emit, DevRev/Computer, Cloudflare share, LIFT). See the subsystem index below for
the full surface; `apiPlugin` in `vite.config.ts` is the authoritative wiring.

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
2. `mkdir` `{projectDir}/{frames,shared}`.
3. Write `project.json` (theme, mode, empty frames).
4. Render the project `CLAUDE.md` from the template, write it.
5. Write empty `chat-history.json` and `theme-overrides.css`.

Response: the new `Project` object; the frontend opens `ProjectDetail`.

### 2. Chat turn

`PromptInput` calls `useChatStream.send(prompt, images)`:

1. Images are uploaded first to `POST /api/uploads/:slug` (`uploadsMiddleware`, 10 MB cap, writes to `_uploads/`).
2. `POST /api/chat {slug, prompt, images}` opens an SSE stream.
3. `chatMiddleware`:
   - Calls `ssoIsValid()` (30 s cache). If expired, sends a synthetic `end ok:false error:"AWS SSO credentials expired..."` event and closes.
   - Appends the user message to `chat-history.json`.
   - `runClaudeTurn()` spawns the Claude CLI with the project's `CLAUDE.md` as its working context:
     ```
     node_modules/.bin/claude
       -p "<prompt>\n\nReference images:\n@<abs path>"
       --output-format stream-json --verbose
       --dangerously-skip-permissions
       --allowed-tools <DEFAULT_ALLOWED_TOOLS>
       --disallowed-tools <DEFAULT_DISALLOWED_TOOLS>
       --model <resolved model>
       --add-dir <projectCwd> [--add-dir <extra dirs>]
       [--resume <sessionId>]
     ```
     Env: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION=us-east-1`. Timeout 8 min.
     Model resolves as: per-request `opts.model` → `ARCADE_STUDIO_MODEL` env →
     `DEFAULT_GENERATION_MODEL` (`"sonnet"`). The exact tool allow/deny lists are
     constants in `claudeCode.ts` — read them there rather than trusting a copy here.
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

`figma-cli` talks to Figma Desktop via CDP on `localhost:9222`.

## Boundaries and layering

| Layer                  | Path                              | May import from                                      |
|------------------------|-----------------------------------|------------------------------------------------------|
| Arcade library (prod)  | `@xorkavi/arcade-gen` (published) | External dependency — the production component library, consumed via the `arcade` alias |
| Prototype kit          | `studio/prototype-kit/`           | `arcade` primitives only                             |
| Generated frames       | `~/.../projects/<slug>/frames/*`  | `arcade` + `arcade-prototypes`                       |
| Studio UI              | `studio/src/`                     | `arcade` + studio-local modules                      |
| Studio server          | `studio/server/`                  | Node stdlib + studio-local modules                   |

The arcade library is no longer in-tree — it ships as the `@xorkavi/arcade-gen`
npm dependency (see the repo-root `.npmrc` for the private registry). The boundary
rule (the prototype kit must not create a reverse dependency back into the library)
is enforced by `__tests__/prototype-kit-boundary.test.ts`. Imports use path aliases
declared in three places that must agree:

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

## Server subsystem index

The server has outgrown a per-file table (it would rot on every feature). This is a
**subsystem map** instead — to find the exact files, `ls studio/server/<dir>`; the
authoritative wiring (which middleware mount in what order) is the `apiPlugin` block
near the top of `studio/vite.config.ts`.

| Subsystem | Where | What it does |
|-----------|-------|--------------|
| **Core orchestration** | `server/*.ts` | The spine: `claudeCode.ts` (spawn + stream-json + retry/throttle/abort), `projects.ts` (CRUD, `reconcileFrames`, `refreshStaleClaudeMd`), `paths.ts` (slug-validated path builders — every FS path goes through here), `types.ts` (Zod schemas), `buildErrorReporter.ts` (auto-fix dispatch), `awsPreflight.ts` / `firstRun.ts` / `claudeBin.ts` (preflight + binary resolution), `turnRegistry.ts` (in-flight turn tracking), `metrics.ts` (per-turn telemetry) |
| **HTTP/SSE layer** | `server/middleware/*.ts` | ~21 middleware, one concern each (chat SSE, projects, frames, figma, uploads, settings, devrev, cloudflare, components, assets, lift, export, metrics, version, turns, awsLogin, …). Mounted in order by `apiPlugin`. |
| **Vite plugins** | `server/plugins/*.ts` | `frameMountPlugin` (serves `/api/frames/...` via a virtual module), `projectWatchPlugin` (Chokidar → reconcile + full-reload), `injectStudioSourcePlugin` (Tailwind `@source`), `kitManifestPlugin`, `liftEmitPlugin` |
| **Figma kit-emit + export** | `server/figma/` | The big one — `kitEmit.ts` + siblings translate Figma nodes into kit-based TSX (componentId→set-key matching, token resolution, layout inference). See auto-memory `figma-kit-emit-engine`. |
| **Figma bridge** | `server/figmaBridge/` | `wsServer.ts` — websocket bridge to the Figma plugin for the code→design export (fiber-walk). See `figma-export-fiber-walk-pipeline`. |
| **DevRev / Computer** | `server/devrev/` | Computer-agent integration (`computerAgent.ts`, `computerContext.ts`, identity, scaffold). Fragile path — see `devrev_computer_agent_capabilities`. |
| **Cloudflare share** | `server/cloudflare/` | `bundler.ts` (esbuild + Tailwind per frame) + `deploy.ts` (Worker client). The real CF token lives only in `worker/`. |
| **Secrets** | `server/secrets/` | `keychain.ts` — DevRev PAT via keytar/macOS Keychain, 0600 plaintext fallback. |
| **Sidecar** | `server/sidecar/` | `bin.ts` CLI entry (`pnpm sidecar`) for the rendezvous/packaging path. |
| **Write hooks** | `server/hooks/*.mjs` | `validateArcadeImports.mjs` + `blockImageReshape.mjs` — Claude Code hooks run on the subprocess's writes. Launched via `process.execPath` (see `studio-hooks-node-not-found-dmg`). |

## Frontend subsystem index

Entry: `src/main.tsx` mounts `<App />` inside `<DevRevThemeProvider>`; `App.tsx` routes
between `routes/HomePage.tsx` (project list + templates) and `routes/ProjectDetail.tsx`
(the chat + viewport workspace).

| Area | Where | What it holds |
|------|-------|---------------|
| **Components** | `src/components/{chat,viewport,devmode,inspector,assets,home,projects,shell,feedback}/` | One dir per UI region. `shell/` = app chrome incl. `AppSettingsModal`; `inspector/` = the live element inspector; `assets/` = the Assets panel. |
| **Hooks** | `src/hooks/` | `useChatStream` (SSE client), `useProjects`, `useFrames`, edit/stream contexts |
| **Lib** | `src/lib/` | `api.ts`, `figmaUrl.ts`, `streamJson.ts` (CLI JSON → `StudioEvent`), `telemetry/*` (PostHog/Sentry + scrubbers) |
| **Inside-iframe** | `src/frame/` | `FrameErrorBoundary`, `FrameFontProxy`, the element `inspector`/`picker` — loaded *inside* the frame iframe, not the shell |
| **Figma export** | `src/export/` | Client side of the fiber-walk serializer (`fiberWalk.ts`, `slj.ts`, token index) |
| **LIFT** | `src/lift/` | Prototype→production handoff: manifest build, render harness, drift audit, mappings |

## Environment variables

| Variable                        | Default                                                  | Purpose                                        |
|---------------------------------|----------------------------------------------------------|------------------------------------------------|
| `ARCADE_STUDIO_ROOT`            | `~/Library/Application Support/arcade-studio`            | Root for all project storage                   |
| `ARCADE_STUDIO_PORT`            | `5556`                                                   | Vite dev-server port (`strictPort`)            |
| `ARCADE_STUDIO_CLAUDE_BIN`      | `<repo>/node_modules/.bin/claude`                        | Path to the Claude CLI binary                  |
| `ARCADE_STUDIO_MODEL`           | `sonnet` (`DEFAULT_GENERATION_MODEL`)                    | Generation model override (alias or pinned id) |
| `ARCADE_STUDIO_FIGMA_CLI_DIR`   | `~/figma-cli`                                            | figma-cli checkout location                    |
| `ARCADE_STUDIO_OPEN_BROWSER`    | `1`                                                      | `"0"` suppresses auto-open (Electron path)     |
| `ARCADE_STUDIO_SKIP_SSO_CHECK`  | unset                                                    | `"1"` skips `aws sts get-caller-identity`      |
| `AWS_REGION`                    | `us-east-1`                                              | Passed to the Claude subprocess for Bedrock    |

`ARCADE_TELEMETRY_DEBUG`, `ARCADE_STUDIO_CLASSIFIER_MODEL`, and `ARCADE_STUDIO_SYNTH_MODEL`
also exist for telemetry-debug and Figma-classification tuning.

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full setup checklist.
