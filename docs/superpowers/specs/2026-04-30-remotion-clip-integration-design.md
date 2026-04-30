# Remotion Clip Integration — Design

**Date:** 2026-04-30
**Scope:** `/studio` project — adds animated-clip sharing as an alternative to the existing Vercel live-URL share.

## Goal

Designers currently share a frame by deploying it to Vercel and passing the URL. Videos and gifs are a better fit for many contexts — Slack reactions, portfolio decks, release notes, async review. This adds a second path inside the existing Share modal: render the selected frame as a short animated `.mov` using Remotion.

v1 is deliberately dumb: one-click, no parameters, a sensible default clip (fade-in → hold → fade-out). We learn from usage before exposing knobs.

## Non-goals (v1)

- Scripted interactions (hover, click, typing, transitions between states).
- GIF or webm output.
- Multi-frame clips (stitching several frames into one video).
- Custom durations, custom animation templates, custom resolutions.
- Remotion Lambda / Cloud Run — everything renders locally.
- Free-text prompts ("describe the animation").
- Audio.

These are future enhancements. The architecture should not block them.

## Feature shape

### Entry point

The existing `ShareButton` in `StudioHeader` continues to open `ShareModal`. The modal grows a **"Share as"** segmented control at the top:

- **Live URL** (Vercel) — the current flow, unchanged.
- **Animated clip** (Remotion) — the new flow.

The frame picker (radio list of frames in the project) is shared between both modes. The action button swaps: **Deploy to Vercel** vs. **Generate clip**.

### Clip generation — one-click

Designer picks a frame and clicks **Generate clip**. No prompt field, no options.

States inside the modal:
1. **Idle** — frame picker + Generate clip button.
2. **Rendering** — progress bar, frame count ("Rendering… 62 / 180 frames"), elapsed time, Cancel button.
3. **Success** — inline `<video autoplay muted loop>` preview, file path, three actions: **Open** / **Reveal in Finder** / **Save to Desktop**.
4. **Error** — error message with retry button.

### Default clip template

6 seconds at 30 fps (180 frames), 1366×768 canvas, `.mov` (H.264).

- **0.0–0.8s** (frames 0–24): Fade-in from black, scale 0.98 → 1.00.
- **0.8–5.0s** (frames 24–150): Hold on-screen, static.
- **5.0–6.0s** (frames 150–180): Fade-out to black.

No synthetic cursor, no simulated interactions. The clip is a hero shot of the frame, not a product demo.

### Canvas composition

- **Fixed canvas:** always 1366×768.
- **Frame placement:** frame rendered at its natural width (one of 375 / 1024 / 1440 / 1920), centered and top-aligned in the 1366 canvas.
  - If frame width > 1366: scale down uniformly (`scale = 1366 / frameWidth`).
  - If frame width ≤ 1366: natural size, no scaling.
- **Vertical behavior:** frame is top-aligned; content taller than the visible 768/scale region gets cropped at the bottom. Hero shots of the top of the page look better than mid-scroll.
- **Letterbox fill:** theme-aware background for uncovered canvas area.
  - v1 fallback: solid `#0a0a0a` (dark mode) / `#f5f5f5` (light mode). Token-driven background is a future improvement.

### Persistence and delivery

Each clip lives in two places:

- **Canonical:** `~/Library/Application Support/arcade-studio/projects/<slug>/clips/<frame-slug>-<timestamp>.mov`.
  - Tracked in `project.json` under a new `clips?: Clip[]` array.
  - Survives if the Desktop copy is deleted; provides history.
- **Desktop copy (optional):** triggered by the modal's **Save to Desktop** action. Copies the canonical file to `~/Desktop/arcade-clip-<project>-<frame>-<timestamp>.mov`. Matches designer muscle memory from arcade-prototyper.

## Architecture

Mirrors the existing Vercel share pipeline:

```
Frontend (src/components/shell/ShareModal.tsx)
    │
    │  POST /api/projects/:slug/clip  { frameSlug }
    ▼
Middleware (server/middleware/clip.ts)
    │
    │  1. Validate project + frame exist
    │  2. Reject with 409 if a render is already in flight for this project
    │  3. Register render (in-memory map: projectSlug → RenderState)
    │  4. Return { renderId } immediately (202 Accepted)
    │  5. Kick off buildFrameClip(ctx) in the background
    │  6. On completion: persist clip record to project.json.clips[]
    │  7. Push progress/done/error events to the SSE stream
    ▼
GET /api/projects/:slug/clip/:renderId/progress  (SSE)
    │  events: progress | done | error
    │  client subscribes from Rendering state, unsubscribes on done/error
    ▼
Clip builder (server/remotion/renderer.ts)
    │
    │  1. Generate Root.tsx via buildDefaultRootSource(ctx)
    │  2. Bundle via @remotion/bundler  (reuses shared bundle config)
    │  3. Render via @remotion/renderer → <slug>/clips/<frame>-<ts>.mov
    │     onProgress callback forwards render progress to SSE
    │  4. Return the absolute path
    ▼
Filesystem:  ~/Library/Application Support/arcade-studio/projects/<slug>/clips/<frame>-<ts>.mov
             served back for inline preview via:
             GET /api/projects/:slug/clips/:file
```

### New files

| File | Responsibility |
|---|---|
| `studio/server/remotion/renderer.ts` | `buildFrameClip(ctx, onProgress) → { path }`. Parallels `server/vercel/bundler.ts`. Writes Root.tsx, calls `@remotion/bundler#bundle`, calls `@remotion/renderer#renderMedia`. |
| `studio/server/remotion/composition.ts` | Pure function `buildDefaultRootSource(ctx) → string` producing the Remotion entry `Root.tsx`. Pure so it is unit-testable without touching Chromium. |
| `studio/server/middleware/clip.ts` | HTTP routes: `POST /api/projects/:slug/clip` (start render), `GET /api/projects/:slug/clip/:renderId/progress` (SSE), `DELETE /api/projects/:slug/clip/:renderId` (cancel in-flight render), `GET /api/projects/:slug/clips/:file` (serve .mov for inline preview). |
| `studio/server/shared/frameBundleConfig.ts` | Extracted-from-Vercel-bundler shared config: `ARCADE_ALIASES`, `devrevStubPlugin()`, `buildFrameTailwindCss()`, `buildInlineFontFaceCss()`, `REPO_ROOT`, `REPO_NODE_MODULES`, `STUDIO_SRC_STYLES`. |

### Modified files

| File | Change |
|---|---|
| `studio/server/types.ts` | Add `Clip` Zod schema: `{ frameSlug: string, path: string, createdAt: string }`. Extend `Project` schema with `clips?: Clip[]`. |
| `studio/vite.config.ts` | Register `clipMiddleware()` in the `configureServer` hook alongside existing middleware. |
| `studio/server/vercel/bundler.ts` | Remove duplicated bundle helpers. Import from `server/shared/frameBundleConfig.ts`. No behavior change. |
| `studio/src/components/shell/ShareModal.tsx` | Add "Share as" segmented control. Branch between Vercel flow and clip flow. Implement Rendering state (SSE subscription) and clip Success state (inline video + Open/Reveal/Save to Desktop). |
| `studio/package.json` | Add `remotion`, `@remotion/bundler`, `@remotion/renderer` as runtime dependencies. |

### Shared bundler config — why the refactor

The Remotion renderer needs to bundle the frame's React source with the **exact same** tool-chain the Vercel bundler uses:

- `ARCADE_ALIASES` (arcade, arcade/components, arcade-prototypes).
- `devrevStubPlugin` (stubs `shared/devrev` imports in generated frames).
- `buildFrameTailwindCss` (compiles Tailwind v4 for the frame's utility classes).
- `buildInlineFontFaceCss` (inlines the CDN-fetched Chip fonts to survive the Remotion render — headless Chrome will not have the CDN whitelisted either).

Duplicating these between `vercel/bundler.ts` and `remotion/renderer.ts` would be a maintenance trap: the two bundlers need to stay in lockstep with `studio/vite.config.ts`'s aliases and Tailwind setup. Extracting them is a bounded refactor with no behavior change to Vercel — same functions, same call sites, just moved.

## Data types

Added to `studio/server/types.ts`:

```ts
export const ClipSchema = z.object({
  frameSlug: z.string(),
  path: z.string(),      // absolute path inside the project dir
  createdAt: z.string(), // ISO 8601
});

export type Clip = z.infer<typeof ClipSchema>;

// Extension to existing ProjectSchema:
export const ProjectSchema = z.object({
  // ...existing fields
  clips: z.array(ClipSchema).optional(),
});
```

## Render lifecycle

### Concurrency

**One render per project at a time.** The middleware keeps an in-memory `Map<projectSlug, RenderState>`. On `POST /clip`:
- If an entry exists for the slug → respond `409 Conflict` with `{ error: { code: "render_in_progress" } }`.
- Otherwise → create entry, return `202 Accepted { renderId }`, start the render.

On completion or failure, the entry is removed. If the process crashes mid-render, stale entries die with it (they are in-memory) — the next render for that project will proceed normally.

The client disables the Generate button while the SSE stream is open, so in practice a collision should only happen if two Studio windows target the same project.

### SSE progress events

`GET /api/projects/:slug/clip/:renderId/progress` emits:

```
event: progress
data: {"frame": 62, "totalFrames": 180, "elapsedMs": 4810}

event: done
data: {"path": "/abs/path/to/frame-2026-04-30T12-34-56.mov", "relativePath": "clips/frame-2026-04-30T12-34-56.mov"}

event: error
data: {"code": "bundle_failed" | "render_failed" | "timeout" | "disk_full", "message": "..."}
```

Remotion's `renderMedia()` exposes an `onProgress` callback that fires with `renderedFrames / totalFrames`; the middleware debounces to ~4 emits per second to avoid spamming the client.

### Timeout

Per-render cap: **180 seconds**. At the cap the render is aborted (Remotion's `abortSignal`) and an `error` event with code `timeout` is emitted.

## Error handling

| Failure | Detection | SSE error code | User-facing message |
|---|---|---|---|
| Frame source fails to compile | esbuild throws inside `bundle()` | `bundle_failed` | "Frame has build errors. Fix them in the chat and try again." |
| Remotion Chromium missing / blocked download | `renderMedia` throws on startup | `render_failed` | "Couldn't start the renderer. Remotion needs Chromium — check your internet connection and try again." |
| Out of disk space | fs write throws `ENOSPC` | `disk_full` | "Out of disk space. Free up space and try again." |
| Render runs past 180s | AbortController timeout | `timeout` | "Render timed out after 3 minutes. The frame may be too complex." |
| Unexpected | Caught at top level of `buildFrameClip` | `render_failed` | Raw error message (already surfaced in studio today; parity with chat errors). |

No auto-retry. The error states live in the modal with a Retry button; the designer decides whether to fix the underlying issue or try again.

## Frontend state machine

`ShareModal` gains a small state machine, driven by `ShareMode` ("url" | "clip") and `ClipState` ("idle" | "rendering" | "success" | "error"):

```
         ┌─────────┐
         │  idle   │───── Generate clip ───┐
         └─────────┘                       │
              ▲                            ▼
      Retry   │                      ┌───────────┐
              │                      │ rendering │─── SSE: progress ──┐
              │                      └───────────┘                    │
              │                        │     │                        │
              │         SSE: error     │     │   SSE: done            │
              │        ◄───────────────┘     └───────────►            │
              │                                                       │
         ┌──────┐                                            ┌────────┐
         │error │                                            │success │
         └──────┘                                            └────────┘
```

- **Rendering → Success:** on SSE `done`, switch to success panel, load the video from `/api/projects/:slug/clips/:file` (the canonical file served back for preview), autoplay/muted/loop.
- **Rendering → Error:** on SSE `error`, close the stream, show the error message and Retry.
- **Cancel button (while rendering):** closes the SSE stream from the client side and sends `DELETE /api/projects/:slug/clip/:renderId`. Server aborts the render via `AbortController`, cleans up the in-memory map, removes any partial `.mov` file from disk.

## Testing

All tests go in `studio/__tests__/` following existing conventions. Tests use vitest.

### Unit

- **`server/remotion/composition.test.ts`**
  - Given `{ framePath, theme, mode, frameWidth }`, `buildDefaultRootSource()` produces a Root.tsx string that:
    - Imports the frame from the correct path.
    - Wraps in `<DevRevThemeProvider mode="...">`.
    - Registers a `<Composition id="frame-clip" durationInFrames={180} fps={30} width={1366} height={768} />`.
    - Intro/hold/outro opacity interpolations correct for each frame bound.
  - Snapshot test (fixed input → fixed output) is the clearest way to assert these.

- **`server/shared/frameBundleConfig.test.ts`** (if any of the extracted helpers are pure enough to test; otherwise skip — the existing `vercel/bundler.test.ts` already exercises them indirectly.)

### Integration

- **`server/middleware/clip.test.ts`**
  - Spins up a fake project with a minimal frame (e.g., a button-only component).
  - `POST /api/projects/:slug/clip` → asserts `202 Accepted` with `renderId`.
  - Subscribes to the SSE progress stream → asserts at least one `progress` event, then one `done` event.
  - Asserts the `.mov` file exists on disk, has non-zero size, and `project.json.clips[]` has a new entry.
  - Gated behind `SKIP_SLOW_TESTS=1` so CI does not pay for a ~30s Remotion render on every run. Local dev runs it via `pnpm test:slow`.

- **Collision test:** two back-to-back `POST /clip` calls for the same project — second must return `409 Conflict` while the first is still running.

### What we explicitly do not test

- Pixel-level correctness of rendered frames (Remotion itself is the authority).
- Chromium download path (first-time Remotion install) — this is Remotion's concern.
- File-size bounds on the output `.mov` — empirically variable; we only assert non-zero.

## Dependencies

New runtime deps (`studio/package.json`):

```
remotion          ^4.x   (peer + runtime)
@remotion/bundler ^4.x
@remotion/renderer ^4.x
```

Remotion auto-downloads Chromium to its own cache directory on first `renderMedia()` call (~120 MB). This is one-time and silent — no extra packaging work needed. The packaged `.app` ships with `node_modules/` but the Chromium cache is user-local and will populate on first use.

**Packaging note:** the packaging flow (`studio/packaging/`) that bundles `node_modules/` into the `.app` should not break — Remotion's cache lives under `~/.remotion/` by default, not inside `node_modules/`. Verify after integration.

## Open questions (resolved during brainstorming)

1. **Clip = derived from a frame, not a first-class artifact.** Keeps the mental model aligned with the existing Share → Vercel flow.
2. **One-click default, no prompt field in v1.** Fastest path to value; we add a prompt later if feedback demands it.
3. **Share modal hosts both modes.** Clip is an alternative share path, not a separate button.
4. **Studio owns the renderer, agent doesn't scaffold a Remotion project.** Mirrors Vercel share architecture, avoids per-clip `npm install`, faster first-run.
5. **1366×768 fixed canvas.** Standard landscape size, drops cleanly into Slack / Notion / GitHub / doc tools.
6. **Clips persist to project dir + optional Desktop copy.** History survives; Desktop matches existing muscle memory.

## Success criteria

- [ ] Share modal has a "Share as" segmented control; switching modes swaps the action button.
- [ ] Clicking **Generate clip** on a frame produces a 6s 1366×768 `.mov` on disk at `~/.../projects/<slug>/clips/<frame>-<ts>.mov`.
- [ ] `project.json.clips[]` has a new entry after a successful render.
- [ ] Rendering state shows frame-level progress via SSE.
- [ ] Success state shows an autoplaying inline preview of the rendered clip.
- [ ] **Save to Desktop** copies the file to `~/Desktop/` with a sensible name.
- [ ] **Reveal in Finder** opens the Finder window on the clip.
- [ ] A second render for the same project while one is in flight is rejected (409); UI disables the button.
- [ ] Cancel during rendering aborts the render and removes the partial file.
- [ ] Frame build errors surface as `bundle_failed` with a clear message.
- [ ] Bundler refactor (shared config module) does not change Vercel share behavior — existing tests still pass.

## References

- Existing Vercel share flow: `studio/server/middleware/vercel.ts`, `studio/server/vercel/bundler.ts`, `studio/server/vercel/deploy.ts`
- Existing Share modal: `studio/src/components/shell/ShareModal.tsx`, `studio/src/components/shell/ShareButton.tsx`
- Studio architecture: `studio/ARCHITECTURE.md`
- Remotion docs: https://remotion.dev/docs
- Remotion bundler API: https://remotion.dev/docs/bundler
- Remotion renderer API: https://remotion.dev/docs/renderer
