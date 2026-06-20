# Status

Arcade Studio is a **beta** macOS app (current release: see `package.json#version`).
Designers, PMs, and engineers at DevRev install the signed/notarized `.dmg`, type
prompts, and watch an embedded Claude Code subprocess generate React frames into
their project directory. It is good enough for real prototyping work, with honest
rough edges around generation fidelity.

## What works

- **Project management** — create, rename, delete projects; projects persist outside the repo at `~/Library/Application Support/arcade-studio/projects/`.
- **URL-based routing** — `#/project/<slug>` preserves the open project across refresh and back/forward.
- **Chat with Claude** — send prompts, images, and documents to the agent via SSE; structured, scannable activity streaming (tool verb + truncated args, summarized results); a live cursor shows the frame being written.
- **`@Computer` agent** — mention `@Computer` to route a turn to the DevRev Computer agent; product-truth "chime-in" notes surface against generated frames.
- **Figma import (kit-emit)** — paste a Figma URL and the frame is imported deterministically from Figma's REST data, mapping to real `@xorkavi/arcade-gen` components where the curated mapping matches. No LLM on this path.
- **Figma export (fiber-walk)** — push a generated frame into Figma via the fiber-walk → SLJ → execute-plan pipeline, building real component instances.
- **DevRev API integration** — per-user Personal Access Token stored in the OS keychain; `/api/devrev/*` proxy forwards to `api.devrev.ai` with retry/backoff. Generated frames read real works, parts, chats, timeline entries, etc.
- **AWS Bedrock** — `~/.aws` bootstrapped on first run; the chat preflight verifies SSO before a turn.
- **Frame generation + hot reload** — the agent writes React `.tsx` into `frames/`; the viewport refreshes automatically (Vite full-reload scoped to frame writes).
- **Page templates** — the kit ships Settings, Vista, Computer, and Builder page archetypes plus Modal/Card/Select composites.
- **LIFT manifest** — every frame emits a `LIFT.xml` handoff manifest mapping prototype code to production `@devrev-web-internal` imports for a ~80%-mergeable handoff.
- **Share to web (Cloudflare Pages)** — one-click publish a frame to a `*.pages.dev` URL behind Cloudflare Access; the real CF token lives only in the share Worker, never on tester machines.
- **Responsive viewport** — frame-width + zoom controls in the canvas; per-project zoom persists.
- **Visible frame load errors** — module-load failures (e.g. a bad icon import) render a red error panel inside the iframe instead of a blank box.
- **In-app auto-update** — the app polls the public release mirror once per launch and applies notarized updates (electron-updater; turn-aware restart).
- **Observability** — Sentry + PostHog telemetry across the React shell, Vite server, and Electron main; per-turn generation metrics logged.

## Known rough edges

- **Generation fidelity** — the agent sometimes diverges from a Figma reference; the systemic accuracy work (kit-emit mappings + drift audit) is ongoing rather than per-frame patching.
- **Cross-platform** — everything assumes macOS paths/dependencies; Linux/Windows are not supported.

## What's not built yet

See [ROADMAP.md](./ROADMAP.md). The two features being rebuilt from scratch —
**multiplayer (live sharing + spectator)** and a **richer Figma export** — had
their legacy implementations removed to keep the tree clean for the rebuild.
