# Development

This is the hands-on guide for running, testing, and troubleshooting Arcade Studio. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the mental model first.

## Prerequisites

Studio is currently macOS-first. `server/firstRun.ts` will check for these on startup and surface a banner if anything is missing.

| Tool           | Why                                                    | Install                                               |
|----------------|--------------------------------------------------------|-------------------------------------------------------|
| Node.js        | Runs Vite and the studio middleware                    | `brew install node`                                   |
| pnpm           | Package manager the repo expects                       | `brew install pnpm`                                   |
| Homebrew       | Used by `firstRun.ts` to bootstrap the rest (macOS)    | https://brew.sh                                       |
| AWS CLI + SSO  | Claude CLI runs against Bedrock in this setup          | `brew install awscli`; then `aws configure sso`       |
| figmanage      | REST-backed Figma bridge used by `figmaCli.ts`         | Install the `figmanage` CLI (see its own README)      |
| Figma Desktop  | figma-cli talks to it via CDP on `localhost:9222`      | Download Figma Desktop                                |
| Claude CLI     | Agent runtime                                          | Installed as a dep: `@anthropic-ai/claude-code`       |

### AWS SSO

Studio runs Claude through Bedrock. Before the first chat turn of the day:

```bash
aws sso login --profile dev
```

`awsPreflight.ts` calls `aws sts get-caller-identity` and caches the result for 30 s. If credentials are expired, the chat endpoint returns a synthetic SSE error (`kind: end, ok: false, error: "AWS SSO credentials expired..."`) and the frontend shows an auth-error banner with a retry button.

Local testing that shouldn't hit Bedrock: `export ARCADE_STUDIO_SKIP_SSO_CHECK=1`.

### Figma Desktop + figma-cli

1. Install Figma Desktop and open the file(s) you want to prototype from.
2. Clone figma-cli to `~/figma-cli` (or set `ARCADE_STUDIO_FIGMA_CLI_DIR`).
3. Start its daemon per its own README. The daemon talks to Figma Desktop via CDP (`localhost:9222`).
4. `GET /api/figma/status` confirms the daemon is reachable; the studio UI's "From Figma" button depends on this.

## Running studio

From the repo root:

```bash
pnpm install      # installs deps into arcade-gen/node_modules (shared)
pnpm studio       # starts Vite on http://localhost:5556 and opens the browser
pnpm studio:test  # runs vitest with jsdom environment
```

There is no production build target for studio — it is a dev-only tool.

### What happens on startup

1. Vite loads `studio/vite.config.ts`.
2. `injectStudioSourcePlugin` appends `@source "<projectsRoot>/**/frames/**/*.{ts,tsx}"` to `arcade-gen/src/styles/globals.css` so Tailwind v4 scans generated frames for utility classes. (See the "Tailwind v4 content scanning" memory — auto-detect misses the studio subdir.)
3. `apiPlugin` wires up all middleware (`chat`, `projects`, `figma`, `uploads`, `preflight`, `fonts`), attaches the build-error reporter, and runs `refreshStaleClaudeMd()` once: if `templates/CLAUDE.md.tpl` has changed since a project was scaffolded, the project's `CLAUDE.md` is rewritten and `sessionId` is cleared.
4. `projectWatchPlugin` starts a Chokidar watcher on `projectsRoot` (depth 6).
5. `frameMountPlugin` registers the `/api/frames/:slug/:frame` route and the virtual module.
6. Vite serves the React shell from `src/main.tsx`.

## Project storage

Projects are stored outside the repo so git never sees them:

```
~/Library/Application Support/arcade-studio/projects/<slug>/
├── project.json
├── CLAUDE.md
├── chat-history.json
├── theme-overrides.css
├── frames/<frame-slug>/index.tsx
├── shared/
├── thumbnails/
└── _uploads/
```

Override with `ARCADE_STUDIO_ROOT=/some/path`. The slug regex is `/^[a-z0-9][a-z0-9-]{0,62}$/i` — validated on every path builder in `server/paths.ts`.

Helpful commands:

```bash
open "$HOME/Library/Application Support/arcade-studio/projects"
# or from within studio: "Reveal in Finder" context menu on a project card
```

## Environment variables

| Variable                       | Default                                                  | Purpose                                        |
|--------------------------------|----------------------------------------------------------|------------------------------------------------|
| `ARCADE_STUDIO_ROOT`           | `~/Library/Application Support/arcade-studio`            | Root for all project storage                   |
| `ARCADE_STUDIO_CLAUDE_BIN`     | `<repo>/node_modules/.bin/claude`                        | Path to the Claude CLI                         |
| `ARCADE_STUDIO_FIGMA_CLI_DIR`  | `~/figma-cli`                                            | figma-cli checkout location                    |
| `ARCADE_STUDIO_SKIP_SSO_CHECK` | unset                                                    | `"1"` skips the SSO preflight                  |
| `AWS_REGION`                   | `us-east-1`                                              | Passed to the Claude subprocess for Bedrock    |

## Common workflows

### Add a new API endpoint

1. Create a middleware module in `server/middleware/yourThing.ts` exporting a factory that returns `(req, res, next) => void`.
2. Register it in `apiPlugin` inside `vite.config.ts`.
3. If the route reads/writes files inside a project, use `paths.ts` helpers — don't concatenate strings. They enforce slug validation.
4. Add a test in `__tests__/middleware/yourThing.test.ts` using the existing fixtures pattern.

### Add a new composite to the prototype kit

1. Create the `.tsx` under `prototype-kit/composites/`.
2. Export it from `prototype-kit/index.ts`.
3. Compose existing `arcade` primitives. Do **not** import from `arcade-gen/src/` in a way that creates a reverse dependency — `__tests__/prototype-kit-boundary.test.ts` will fail.
4. Update `templates/CLAUDE.md.tpl` with a usage note so the agent knows about it.

### Update the agent's system prompt

`templates/CLAUDE.md.tpl` is the single source of truth for the agent's behavior inside generated projects. It uses `{{PROJECT_NAME}}` and `{{THEME}}` tokens.

When you change it, existing projects will have their `CLAUDE.md` silently refreshed on next studio startup (`refreshStaleClaudeMd()` in `server/projects.ts`) — and their `sessionId` is cleared so the next chat turn starts a fresh Claude session. This is intentional: the agent's instructions changed, so prior context would be stale.

### Debug a hanging chat turn

1. Check the browser console for SSE events.
2. Check the terminal running `pnpm studio` — `claudeCode.ts` logs the spawn + every parsed event.
3. Find the running `claude` process: `ps aux | grep claude`. Kill it if stuck; studio will send `end ok:false`.
4. The chat endpoint has an 8-minute timeout (`runClaudeTurn` default). A turn pushing past that is almost always an agent loop.

### Debug an agent that won't stop touching the wrong file

The agent is started with `--dangerously-skip-permissions` and an allowlist of `Read,Edit,Write,Glob,Grep,Bash`. It also has `--add-dir <repo root>`. That means it can read the entire arcade-gen checkout but its writes should stay inside its own project. If you see it writing outside, that's a prompt bug in `templates/CLAUDE.md.tpl`, not a sandbox issue — the sandbox is deliberately off.

## Testing

```bash
pnpm studio:test                      # all tests
pnpm studio:test <pattern>            # filter by filename
pnpm studio:test -t "description"     # filter by test name
```

Config: `vitest.config.ts` — jsdom environment, setup at `__tests__/setup.ts`, path aliases mirror `vite.config.ts`.

Coverage today (`__tests__/`):

- **Server**: `claudeCode`, `types`, `projects`, `figmaCli`, `thumbnails`, `buildErrorReporter`, `paths`, `firstRun`, `awsPreflight`
- **Middleware**: `dev`, `projects`, `figma`, `preflight`, `chat`, `uploads`
- **Plugins**: `frameMountPlugin`
- **Hooks**: `useChatStream`
- **Lib**: `figmaUrl`, `streamJson`
- **Boundary**: `prototype-kit-boundary.test.ts` — fails if `arcade-gen/src/` imports from `prototype-kit/`

Integration tests for server endpoints hit the real filesystem inside a temp dir fixture (see `__tests__/fixtures/`). They do **not** mock disk — the project's memory records this as a deliberate choice ([`feedback_scalable_accuracy.md`](../.claude/projects/-Users-andrey-sundiev-arcade-prototyper/memory/feedback_scalable_accuracy.md)).

## Troubleshooting

### "AWS SSO credentials expired" banner in the chat pane

Run `aws sso login --profile dev`. The preflight cache is 30 s, so give it a moment before retrying.

### "Missing dependencies: figmanage" on first run

Install figma-cli to `~/figma-cli` (or set `ARCADE_STUDIO_FIGMA_CLI_DIR`) and make sure its daemon can start. `GET /api/preflight` is the endpoint the banner reads.

### Frame appears but is blank

Open the iframe in a new tab (`/api/frames/:slug/:frame`). If it renders there, the issue is parent-frame CSS isolation. If it's blank there too, open devtools on the iframe — `FrameErrorBoundary` will have caught any React error. Otherwise check the terminal for esbuild errors coming from `frameMountPlugin`.

### Tailwind classes in generated frames have no effect

`injectStudioSourcePlugin` must be running. If you copied `globals.css` without the `@source` append, Tailwind v4 won't scan the project directory. Restart studio to re-run the transform.

### Agent writes a frame, but the viewport doesn't update

1. Check the terminal for `projectWatchPlugin` logs.
2. Confirm the new file is at `{projectDir}/frames/<slug>/index.tsx`, not a nested path.
3. Verify the file extension is `.tsx` — the watcher ignores other extensions.
4. If all else fails, hit Cmd+R in the browser; `reconcileFrames` runs on every `GET /api/projects/:slug` too.

### Build error auto-fix loops forever

`buildErrorReporter.ts` rate-limits at one fix per frame per 60 s, so it can't burn money indefinitely on a single error — but it will keep retrying. If an error is truly stuck, delete the frame's `index.tsx` and let the agent regenerate it, or cancel via the chat pane.

### "Port 5556 already in use"

Studio hardcodes port 5556. Kill the old process: `lsof -ti:5556 | xargs kill`.

## Related reading

- [README.md](./README.md) — project overview and directory layout
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system diagram, flows, file map
- [prototype-kit/README.md](./prototype-kit/README.md) — boundary rules for composites
- [templates/CLAUDE.md.tpl](./templates/CLAUDE.md.tpl) — agent system prompt (reads as documentation for how frames get built)
- Repo root [README.md](../README.md) — the broader arcade design system
