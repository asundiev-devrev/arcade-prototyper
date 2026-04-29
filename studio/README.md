# Arcade Studio

Arcade Studio is an AI-assisted prototyping workspace for the Arcade Design System. Designers create a project, paste a Figma URL (or type a prompt), and a Claude-driven agent writes React frames into the project's `frames/` directory. Frames hot-reload inside a viewport grid, composed from the production arcade components and the opinionated composites in `prototype-kit/`.

Studio is a sibling of `playground/` under the `arcade-gen` repo — not a pnpm workspace. It shares the root `node_modules` and reaches into the library via path aliases (`arcade`, `arcade-prototypes`).

## Status

Studio is currently a proof of concept — see [STATUS.md](./STATUS.md) for what works and [ROADMAP.md](./ROADMAP.md) for the prioritized enhancement list.

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
├── server/           # Vite middleware + plugins (API, watchers, claude subprocess)
├── prototype-kit/    # Opinionated composites + templates used by generated frames
├── templates/        # CLAUDE.md.tpl — scaffolded into each new project
├── __tests__/        # Vitest unit tests
├── bin/              # (reserved — no CLI entry yet)
├── index.html        # Entry (mounts src/main.tsx)
├── vite.config.ts    # Dev server + middleware + custom plugins
└── vitest.config.ts  # Test config (jsdom)
```

Runtime project storage lives outside the repo:

```
~/Library/Application Support/arcade-studio/projects/<slug>/
├── project.json
├── CLAUDE.md             # Agent system prompt (rendered from templates/CLAUDE.md.tpl)
├── chat-history.json
├── theme-overrides.css
├── frames/<frame-slug>/index.tsx
├── shared/
├── thumbnails/
└── _uploads/
```

## Further reading

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — how the frontend, server middleware, and Claude subprocess fit together
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** — prerequisites, environment variables, common workflows, troubleshooting
- **[packaging/README.md](./packaging/README.md)** — building Arcade Studio as a distributable `.app` / `.dmg` for internal users
- **[prototype-kit/README.md](./prototype-kit/README.md)** — boundary rules between studio composites and the production library
- **[templates/CLAUDE.md.tpl](./templates/CLAUDE.md.tpl)** — the system prompt the agent runs under inside each generated project

## Relationship to other arcade-gen folders

| Folder        | Purpose                                                                  |
|---------------|--------------------------------------------------------------------------|
| `src/`        | Production arcade library (components, tokens, OpenUI bridge)            |
| `playground/` | Prompt-driven demo that renders single components via OpenUI             |
| `studio/`     | Multi-project prototyping workspace; agent generates whole frames        |

All three Vite apps share the root `node_modules` and the root `tokens.tokens.json`.
