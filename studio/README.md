# Arcade Studio

Arcade Studio is an AI-assisted prototyping workspace for the Arcade Design System. Designers create a project, paste a Figma URL (or type a prompt), and a Claude-driven agent writes React frames into the project's `frames/` directory. Frames hot-reload inside a viewport grid, composed from the production arcade components and the opinionated composites in `prototype-kit/`.

Studio lives in the `studio/` directory of the `arcade-prototyper` repo. It is **not** a pnpm workspace member — it shares the repo-root `node_modules` and reaches the production component library via the `arcade` path alias, which resolves to the published `@xorkavi/arcade-gen` dependency (not in-tree).

## Status

Studio is a **beta** macOS app distributed to internal DevRev users as a signed `.dmg` — good enough for real prototyping work. See [STATUS.md](./STATUS.md) for what works and [ROADMAP.md](./ROADMAP.md) for the prioritized enhancement list.

## Quickstart

Prerequisites (see [DEVELOPMENT.md](./DEVELOPMENT.md) for details):
- Node.js + pnpm
- `figmanage` CLI installed globally (`npm install -g figmanage`, then `figmanage login`) — the packaged `.app` bundles it, but local dev needs it on PATH
- AWS SSO (`aws sso login --profile dev`) for Bedrock-backed Claude

From the repo root:

```bash
pnpm install
pnpm studio        # dev server on http://localhost:5556
pnpm studio:test   # run vitest
```

Studio auto-opens in the browser. Projects are stored outside the repo at `~/Library/Application Support/arcade-studio/projects/`.

## Directory layout

```
studio/
├── src/              # React frontend (Vite, port 5556)
├── server/           # Vite middleware + plugins + subsystems (see ARCHITECTURE.md)
├── prototype-kit/    # Opinionated composites + templates used by generated frames
├── worker/           # Cloudflare Worker that proxies share deploys
├── packaging/        # .app/.dmg/.vsix packaging scripts + vendored CLIs
├── templates/        # CLAUDE.md template — scaffolded into each new project
├── __tests__/        # Vitest suite
├── index.html        # Entry (mounts src/main.tsx)
├── vite.config.ts    # Dev server + middleware + custom plugins
└── vitest.config.ts  # Test config (jsdom)
```

The Electron main process + bundle config live at the repo root (`electron/`,
`electron-builder.yml`); `server/sidecar/bin.ts` is the CLI entry (`pnpm sidecar`).

Runtime project storage lives outside the repo:

```
~/Library/Application Support/arcade-studio/projects/<slug>/
├── project.json
├── CLAUDE.md             # Agent system prompt (rendered from the project template)
├── chat-history.json
├── theme-overrides.css
├── frames/<frame-slug>/index.tsx
├── shared/               # e.g. DEVREV-API.md, copied in on demand
└── _uploads/             # uploaded + Figma-exported images
```

## Further reading

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — how the frontend, server middleware, and Claude subprocess fit together
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** — prerequisites, environment variables, common workflows, troubleshooting
- **[packaging/README.md](./packaging/README.md)** — building Arcade Studio as a distributable `.app` / `.dmg` for internal users
- **[prototype-kit/README.md](./prototype-kit/README.md)** — boundary rules between studio composites and the production library
- **[templates/CLAUDE.md.tpl](./templates/CLAUDE.md.tpl)** — the system prompt the agent runs under inside each generated project

## Relationship to the rest of the repo

The `arcade-prototyper` repo holds two independent products (see the repo-root `CLAUDE.md`):

| Path        | Product                                                                      |
|-------------|------------------------------------------------------------------------------|
| repo root   | **Arcade Prototyper skill** — `SKILL.md` + `DESIGN.md`, a Claude Code skill   |
| `studio/`   | **Arcade Studio** — this app; multi-project workspace, agent generates frames |

The production component library is the external `@xorkavi/arcade-gen` dependency, not a sibling folder in this repo.
