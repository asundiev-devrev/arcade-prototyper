# Arcade Studio Observability — Design Spec

**Date:** 2026-06-08
**Branch:** `feat/studio-observability` (off `main`, app version 0.29.0)
**Status:** Approved design → ready for implementation plan

## Goal

Two questions about the beta:

1. **Is it breaking?** — crashes and errors across all three Electron processes, with enough stack/context to debug remotely.
2. **Are testers actually using it?** — usage events: do they launch, generate frames, succeed, share?

Sentry answers (1). PostHog answers (2). Ship both in one release.

## Non-goals (v1)

- No session replay (decided off — would capture prompt text + PAT inputs).
- No consent toggle — internal beta, telemetry is always on (see Privacy).
- No dev-build telemetry — packaged `.app` only.
- No new event-capture instrumentation where signals already exist; v1 wires existing signals to external sinks.

## Architecture context (as of 0.29.0)

Studio is a **real Electron app** now (not the old Vite-only browser tab). Three processes:

| Process | Code | Role | Already has |
|---|---|---|---|
| **Electron main** | `electron/main.ts` | Window, updater, app lifecycle | `uncaughtException` + `unhandledRejection` handlers; file log to `~/Library/Logs/arcade-studio-electron.log` |
| **Vite child** | spawned via `ELECTRON_RUN_AS_NODE` from `electron/viteRunner.ts` | All server middleware; spawns `claude` for generation | Generation metrics (`server/metrics.ts`) |
| **Renderer** | BrowserWindow, `nodeIntegration:false`, `contextIsolation:true`, no preload | React shell UI; talks to server via `fetch` | `FrameErrorBoundary` → `POST /api/runtime-error` |

**Version note:** real version is `package.json` (`0.29.0`). `studio/packaging/VERSION` is dead (frozen 0.23.1) — do NOT read it for telemetry release tag. Use `app.getVersion()` (main) / a version endpoint or build-time inject (renderer + Vite child).

## Existing signals to reuse (don't rebuild)

| Signal | Where it lives | Telemetry use |
|---|---|---|
| Per-turn generation metrics | `server/metrics.ts` `recordTurnMetric()`, fired at `server/middleware/chat.ts:673` | Source for `frame_generated` / `generation_failed` PostHog events |
| Frame "looked OK but broke at runtime" | `src/frame/FrameErrorBoundary.tsx` → postMessage → `POST /api/runtime-error` (`server/middleware/runtimeError.ts`) | Source for `frame_runtime_error` PostHog event + Sentry exception |
| DevRev identity | `resolveDevuFromPat()` in `server/relay/auth.ts` (`dev-users.self` → `{id, displayName}`) | distinct_id resolution |
| Crash handlers | `electron/main.ts` lines 27–32 | Sentry main-process capture wraps these |

## SDK choices

- **Sentry:** three packages, one shared DSN — `@sentry/electron` (main), `@sentry/node` (Vite child: runs under `ELECTRON_RUN_AS_NODE`, no Electron APIs), `@sentry/browser` (renderer: no preload + `contextIsolation:true` rules out the `@sentry/electron/renderer` IPC bridge). See Resolved item 1.
- **PostHog:** `posthog-node` in the Vite child (all value events originate server-side), `posthog-js` in the renderer (UI-only clicks).

## Identity

- distinct_id = **DevRev email** when a PAT is saved; otherwise anonymous UUID v4.
- Server (Vite child) is the single source of truth:
  1. On boot, read DevRev PAT from keychain/settings.
  2. If present, call `dev-users.self` → email (extend `resolveDevuFromPat` to also return email, or add a sibling resolver).
  3. Persist resolved `distinct_id` in `settings.json` under `telemetry.distinctId`.
  4. No PAT → generate + persist anonymous UUID.
- Renderer fetches `distinct_id` from a small endpoint (`GET /api/telemetry/identity`) on mount so renderer + server events stitch to the same person in PostHog.

## Events catalog (v1 — full wiring)

All events carry super-properties: `version`, `os` (`darwin-arm64`/`darwin-x64`), `process` (`main`|`renderer`|`server`), `distinct_id`, `session_id` (UUID per app launch).

### App lifecycle (main process emits)
| Event | When | Payload |
|---|---|---|
| `app_launched` | main `app.whenReady` in packaged build | `version`, `os`, `os_version`, `is_first_launch` |
| `app_shutdown` | `before-quit` | `session_duration_ms` |

### Frame generation (Vite child emits, off `recordTurnMetric` callsite)
| Event | When | Payload |
|---|---|---|
| `prompt_submitted` | `/api/chat` handler entry | `prompt_length`, `project_slug_hash`, `model`, `frame_count_before` |
| `frame_generated` | turn ok + build/edit classified | `project_slug_hash`, `duration_ms`, `model`, `tokens_input`, `tokens_output`, `turn_type`, `frame_lines` |
| `generation_failed` | turn not ok | `project_slug_hash`, `duration_ms`, `error_kind` (`bedrock_auth`/`cli_crash`/`parser_error`/`timeout`/`other`), `model` |
| `generation_cancelled` | user aborts mid-stream | `project_slug_hash`, `duration_ms`, `model` |

### Frame runtime error — the "silent failure" signal (Vite child emits, off `/api/runtime-error`)
| Event | When | Payload |
|---|---|---|
| `frame_runtime_error` | `POST /api/runtime-error` handler | `project_slug_hash`, `error_kind` (`module_not_found`/`syntax_error`/`runtime_exception`/`hmr_failure`), `error_message` (truncated 200ch, paths stripped), `frame_hash` |

Pairs with `frame_generated` to compute "% of generated frames that actually render." This is the screenshot case (agent invents an icon export name → `does not provide an export named 'Lightning'`): generation reports success, frame won't mount.

### Share flow (renderer emits clicks; Vite child emits deploy outcome)
| Event | When | Payload |
|---|---|---|
| `share_opened` | ShareModal mounts | `frame_count` |
| `share_started` | deploy clicked | `frame_count`, `project_slug_hash` |
| `share_succeeded` | Worker returns URL | `duration_ms`, `frame_count` |
| `share_failed` | Worker error / network fail | `duration_ms`, `error_kind` (`auth`/`worker_5xx`/`bundle_error`/`network`/`other`) |
| `share_url_copied` | copy button clicked | — |

### Settings (renderer emits)
| Event | When | Payload |
|---|---|---|
| `settings_opened` | AppSettingsModal opens | `tab` |

## Sentry scope

- Captures all unhandled exceptions in main + renderer + Vite child.
- Main-process handlers (`electron/main.ts:27–32`) integrate with Sentry rather than only file-logging.
- Renderer wrapped in `Sentry.ErrorBoundary` (or the existing FrameErrorBoundary forwards to Sentry).
- `beforeSend` scrubs: `prompt` field from breadcrumbs/extra, `Authorization` headers, any filesystem path under `…/arcade-studio/projects/`.
- Release tag = `arcade-studio@<package.json version>`.
- The same frame runtime error feeds both: PostHog (`frame_runtime_error`, the product metric) and Sentry (exception, the debug view). One shared emit path to keep them in agreement.

## Privacy — what never leaves the machine

- Prompt text (length only).
- Frame contents, file paths, project names (hashed `project_slug_hash` / `frame_hash` only — sha1 of relative path/slug).
- DevRev / Figma / Cloudflare PATs; AWS Bedrock credentials.
- DevRev email IS sent (as distinct_id) — accepted for internal beta.

## Package layout

```
studio/src/lib/telemetry/
  index.ts          # public API: track(), captureError(), identify(), shutdown()
  config.ts         # reads build-time env, returns { sentryDsn, posthogKey, posthogHost, enabled, debug }
  renderer.ts       # @sentry/browser + posthog-js init
  server.ts         # posthog-node + @sentry/node init (Vite child)
  events.ts         # typed event names + payload types (discriminated union)
  identity.ts       # distinct_id resolver (DevRev email > anonymous UUID)
  redact.ts         # path/secret scrubbers shared by Sentry beforeSend + payload builders
  debugSink.ts      # console sink used when no keys / ARCADE_TELEMETRY_DEBUG=1
  __mocks__/index.ts # no-op stubs for tests

electron/telemetry.ts  # @sentry/electron/main init + app lifecycle events (main process)
```

Modified:
- `electron/main.ts` — init main-process Sentry early; emit `app_launched` / `app_shutdown`.
- `studio/vite.config.ts` (or server bootstrap) — init server telemetry once; emit nothing here directly.
- `studio/server/middleware/chat.ts` — generation events off the `recordTurnMetric` callsite.
- `studio/server/middleware/runtimeError.ts` — `frame_runtime_error` + Sentry capture.
- `studio/server/middleware/cloudflare.ts` (share endpoint) — share deploy outcome events.
- New `studio/server/middleware/telemetryIdentity.ts` — `GET /api/telemetry/identity`.
- `studio/src/main.tsx` — renderer telemetry init.
- `studio/src/components/shell/AppSettingsModal.tsx` — `settings_opened`.
- `studio/src/components/.../ShareModal.tsx` — share click events.

## Env vars (build-time)

`.env.production` at repo root, **gitignored**:
```
SENTRY_DSN_STUDIO=https://...@sentry.io/...
POSTHOG_KEY_STUDIO=phc_...
POSTHOG_HOST=https://us.i.posthog.com
```
Vite `define` inlines for renderer + Vite child; `electron/main.ts` reads from a build-time inject for the main process. Missing keys → `config.enabled=false`, app runs silent, logs `[telemetry] disabled — no DSN` once.

## v1 build mode: debug-sink

Build ALL init points + ALL events now, but route through `debugSink.ts` (prints structured events to console / file log) when keys are absent or `ARCADE_TELEMETRY_DEBUG=1`. Lets us smoke-test the full pipeline in dev without signups. Real Sentry/PostHog keys plug in later with zero code change — only `.env.production` gains values.

## Packaged-only gate

`config.ts` enables telemetry only when `app.isPackaged` (main) / `import.meta.env.PROD` (renderer/Vite child). Dev `pnpm run studio` and `pnpm run studio:electron` → debug-sink only, never sends to real Sentry/PostHog even if keys present (unless `ARCADE_TELEMETRY_DEBUG` explicitly overrides to console).

## Failure handling

- Telemetry init errors → `console.warn`, never block boot.
- `track()` is fire-and-forget; never awaited in app paths.
- Network failures → SDK queue/retry; no app-side intervention.
- `app_shutdown` flushes both SDKs in `before-quit` before `app.exit(0)` (bounded timeout so quit never hangs).

## Test discipline

- `studio/__tests__/lib/telemetry/`: `identity.test.ts` (email > anon fallback), `events.test.ts` (payload shapes typed), `config.test.ts` (packaged-only gate), `redact.test.ts` (paths/secrets scrubbed), `debugSink.test.ts`.
- `__mocks__/index.ts` no-op stubs auto-used by vitest.
- Static test: every event name in call sites exists in `events.ts` typed union (no string-literal drift).
- Assert `track()` not called when `config.enabled=false`.
- Run full suite (`pnpm run studio:test`) before commit.

## Resolved implementation details (were open items)

1. **Sentry = three packages, one DSN.** `@sentry/electron` in main; `@sentry/node` in the Vite child (it runs under `ELECTRON_RUN_AS_NODE`, Electron APIs unavailable); `@sentry/browser` in the renderer (no preload + `contextIsolation:true` rules out `@sentry/electron/renderer`'s IPC bridge).
2. **Build-time env → one config file in Resources.** No Vite `define` reaches the main process (it's `tsc`-built to `electron/dist`). The pack step reads `.env.production` and writes `<Resources>/telemetry.config.json` (`{ sentryDsn, posthogKey, posthogHost }`). Main + Vite child read it with `fs` via `process.resourcesPath`; the renderer (no node access) fetches values from `GET /api/telemetry/identity`. PostHog project key + Sentry DSN are client-shippable keys, so baking into the bundle is standard.
3. **Share callsites located.** UI: `studio/src/components/shell/ShareModal.tsx`. Server deploy: `studio/server/middleware/cloudflare.ts` — `deployViaWorker` ~L100, success `send(... {url, deployId})` L129, failure `deploy_failed` L133.
4. **`error_kind` derives from existing signals** at the `recordTurnMetric` callsite + `onCrash`: `info.timedOut`→`timeout`; `info.exitCode !== 0`→`cli_crash`; `pendingEnd.error` matches bedrock/auth→`bedrock_auth`; stream parse failure→`parser_error`; else `other`. `didStall`/`retries` already tracked.
```
