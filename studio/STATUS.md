# Status

Arcade Studio is currently a **proof of concept** — technically functional but rough around the edges. The tool is not yet reliable for production use, but designers, PMs, and engineers at DevRev can use it to prototype new experiences against real data (via the DevRev API) and deploy share links.

## What works

- **Project management** — create, rename, delete projects; projects persist outside the repo at `~/Library/Application Support/arcade-studio/projects/`.
- **URL-based routing** — `#/project/<slug>` preserves the open project across refresh and back/forward.
- **Chat with Claude** — send prompts and images to the agent via SSE; agent receives working directory context and can read/write/execute tools.
- **Figma integration** — paste a Figma URL to export a screenshot and attach it to your prompt; agent can also query Figma tree structure and node properties.
- **DevRev API integration** — per-user Personal Access Token stored in the OS keychain; `/api/devrev/*` proxy forwards to `api.devrev.ai` with retry/backoff. Generated frames read real works, parts, chats, timeline entries, etc.
- **Frame generation** — agent writes React `.tsx` files into the project's `frames/` directory.
- **Hot reload** — when the agent writes a frame, the viewport refreshes automatically (Vite HMR + Chokidar watcher).
- **Two page templates** — the agent knows how to scaffold **Settings** and **Computer Chat** archetypes.
- **Responsive device picker** — Mobile / Tablet / Desktop / Wide / Fit switcher in the top bar; frame previews resize at runtime.
- **Vercel share links** — one-click publish a project to a Vercel preview URL (requires a configured Vercel token).
- **Visible frame load errors** — module-load failures (e.g. a bad icon import) render a red error panel inside the iframe instead of a blank box.
- **Studio shell UI** — redesigned top bar with project picker, device toggle, theme toggle, share button, settings, dev-mode panel toggle.

## Known issues

1. **Agent activity streaming is unreadable** — tool calls and results render as terse italic gray text; no structured display, no tool-result summaries.
2. **Studio shell doesn't respect theme toggle** — the toggle currently only switches the iframe; the Studio chrome (chat pane, viewport header) stays light.
3. **No loading states or success feedback** — few spinners, toasts, or "generation complete" confirmations outside of explicit errors.
4. **Chat history re-rendering inconsistency** — after the agent finishes, some tool calls/narrations may not display until the next turn or refresh.

## What's not built yet

See [ROADMAP.md](./ROADMAP.md) for prioritized enhancements. The biggest remaining items are structured streaming output, studio-shell theme switching, and a range of secondary quality-of-life improvements.
