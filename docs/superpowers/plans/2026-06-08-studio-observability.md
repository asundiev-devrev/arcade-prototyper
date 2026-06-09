# Arcade Studio Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sentry (crash/error) + PostHog (usage events) into Arcade Studio's three Electron processes, routing through a console debug-sink until real DSN/keys are added.

**Architecture:** A shared telemetry module under `studio/src/lib/telemetry/`. A single `core.ts` holds the state + `track()`/`captureError()` routing; `server.ts` and `renderer.ts` are thin shims that build a send-adapter (`@sentry/node`+`posthog-node` / `@sentry/browser`+`posthog-js`) and hand it to core. The Electron main process gets a self-contained `electron/telemetry.ts` (`@sentry/electron`) because `electron/tsconfig.json` can't import from `studio/`. All three read keys from one `telemetry.config.json` baked into the bundle at pack time; the renderer (no node access) fetches identity from a server endpoint. Telemetry only sends when packaged + keys present; otherwise events print to a debug sink.

**Tech Stack:** TypeScript, Electron 33, Vite middleware, Vitest, `@sentry/electron`, `@sentry/node`, `@sentry/browser`, `posthog-node`, `posthog-js`.

**Spec:** `docs/superpowers/specs/2026-06-08-studio-observability-design.md`

**Plan shape (vertical slice):** Tasks 1–6 build the pure foundation. Task 7–10 wire the **first event end-to-end** (`prompt_submitted` → debug sink, smoke-tested in dev) to prove the cross-process plumbing before investing in the rest. Tasks 11–14 fan out the remaining events. Tasks 15–16 add the main process, build-time key injection, and release.

---

## File Structure

**New — shared telemetry module (`studio/src/lib/telemetry/`):**
- `events.ts` — typed event-name → payload discriminated union; single source of event shapes.
- `redact.ts` — pure scrubbers: `hashSlug()`, `truncate()`, `stripPaths()`, Sentry `beforeSend`. Node-only (server + main).
- `config.ts` — resolves `{ sentryDsn, posthogKey, posthogHost, enabled, debug }` + reads the injected config file.
- `debugSink.ts` — prints structured events/errors to console when not sending.
- `core.ts` — shared engine: module state + `track()`/`captureError()` routing (adapter when enabled, debug sink when debug, no-op otherwise).
- `identity.ts` — resolves `distinct_id` (DevRev email > anonymous UUID), persisted in `settings.json`.
- `server.ts` — thin: builds the Node send-adapter, calls `initCore`; re-exports `track`/`captureError`.
- `renderer.ts` — thin: builds the browser send-adapter, calls `initCore`; re-exports `track`/`captureError`.
- `index.ts` — re-exports only the shared/safe pieces (types, `EVENT_NAMES`, redact helpers).
- `__mocks__/index.ts` — no-op stubs for vitest.

**New — main process & server endpoint:**
- `electron/telemetry.ts` — self-contained `@sentry/electron` init + `app_launched`/`app_shutdown` via `posthog-node`.
- `studio/server/middleware/telemetryIdentity.ts` — `GET /api/telemetry/identity`.
- `studio/packaging/scripts/gen-telemetry-config.mjs` — writes `telemetry.config.json` from `.env.production` at pack time.

**Modified:**
- `studio/server/relay/auth.ts` — return `email` from `dev-users.self`.
- `studio/server/middleware/chat.ts` — generation events.
- `studio/server/middleware/runtimeError.ts` — `frame_runtime_error`.
- `studio/server/middleware/cloudflare.ts` — share deploy outcome events.
- `studio/server/middleware/settings.ts` — `writeTelemetryDistinctId` helper.
- `studio/src/components/shell/ShareModal.tsx` — share UI click events.
- `studio/src/components/shell/AppSettingsModal.tsx` — `settings_opened`.
- `studio/src/main.tsx` — renderer init.
- `studio/vite.config.ts` — server init + identity middleware registration.
- `electron/main.ts`, `electron/viteRunner.ts` — main telemetry init + env forwarding.
- `electron-builder.yml`, `package.json`, `.gitignore` — packaging + deps.

---

## PHASE A — Foundation (pure, unit-tested)

## Task 1: Dependencies + gitignore

**Files:**
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install runtime deps**

Run from repo root:
```bash
pnpm add @sentry/electron @sentry/node @sentry/browser posthog-node posthog-js
```
Expected: five deps added, lockfile updated.

- [ ] **Step 2: Ignore secrets + generated config**

Add to `.gitignore` (repo root):
```
.env.production
studio/packaging/telemetry.config.json
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "build(studio/observability): add sentry + posthog deps"
```

---

## Task 2: Events catalog (`events.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/events.ts`
- Test: `studio/__tests__/lib/telemetry/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EVENT_NAMES, type TelemetryEvent } from "../../../src/lib/telemetry/events";

describe("telemetry events catalog", () => {
  it("exposes every event name as a const tuple, no duplicates", () => {
    expect(EVENT_NAMES).toContain("app_launched");
    expect(EVENT_NAMES).toContain("frame_generated");
    expect(EVENT_NAMES).toContain("frame_runtime_error");
    expect(EVENT_NAMES).toContain("share_succeeded");
    expect(EVENT_NAMES).toContain("settings_opened");
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("types a payload to its event via discriminated union", () => {
    const e: TelemetryEvent = {
      name: "frame_generated",
      props: { project_slug_hash: "abc", duration_ms: 1200, model: "sonnet", tokens_input: 10, tokens_output: 20, turn_type: "build" },
    };
    expect(e.props.turn_type).toBe("build");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/events.test.ts`
Expected: FAIL — cannot find module `events`.

- [ ] **Step 3: Write `events.ts`**

```ts
/**
 * Telemetry event catalog. ONE source of truth for event names + payload
 * shapes. Call sites import the typed `TelemetryEvent` union so a typo or a
 * wrong payload is a compile error, not a silent bad row in PostHog.
 *
 * Privacy: payloads carry hashes/lengths, never raw prompt text, file paths,
 * project names, or secrets. See redact.ts.
 */

export type GenerationErrorKind = "bedrock_auth" | "cli_crash" | "parser_error" | "timeout" | "other";
export type FrameErrorKind = "module_not_found" | "syntax_error" | "runtime_exception" | "hmr_failure";
export type ShareErrorKind = "auth" | "worker_5xx" | "bundle_error" | "network" | "other";

export type TelemetryEvent =
  // --- app lifecycle (main process) ---
  | { name: "app_launched"; props: { version: string; os: string; os_version: string; is_first_launch: boolean } }
  | { name: "app_shutdown"; props: { session_duration_ms: number } }
  // --- frame generation (vite child) ---
  | { name: "prompt_submitted"; props: { prompt_length: number; project_slug_hash: string; model?: string; frame_count_before: number } }
  | { name: "frame_generated"; props: { project_slug_hash: string; duration_ms?: number; model?: string; tokens_input?: number; tokens_output?: number; turn_type: "build" | "edit" | "none"; frame_lines?: number } }
  | { name: "generation_failed"; props: { project_slug_hash: string; duration_ms?: number; error_kind: GenerationErrorKind; model?: string } }
  | { name: "generation_cancelled"; props: { project_slug_hash: string; duration_ms?: number; model?: string } }
  // --- frame runtime error (vite child, off /api/runtime-error) ---
  | { name: "frame_runtime_error"; props: { project_slug_hash: string; error_kind: FrameErrorKind; error_message: string; frame_hash: string } }
  // --- share flow (renderer click + server outcome) ---
  | { name: "share_opened"; props: { frame_count: number } }
  | { name: "share_started"; props: { frame_count: number; project_slug_hash: string } }
  | { name: "share_succeeded"; props: { duration_ms: number; frame_count: number } }
  | { name: "share_failed"; props: { duration_ms: number; error_kind: ShareErrorKind } }
  | { name: "share_url_copied"; props: Record<string, never> }
  // --- settings (renderer) ---
  | { name: "settings_opened"; props: { tab: string } };

export type TelemetryEventName = TelemetryEvent["name"];

export const EVENT_NAMES = [
  "app_launched", "app_shutdown",
  "prompt_submitted", "frame_generated", "generation_failed", "generation_cancelled",
  "frame_runtime_error",
  "share_opened", "share_started", "share_succeeded", "share_failed", "share_url_copied",
  "settings_opened",
] as const satisfies readonly TelemetryEventName[];
```

> The `satisfies readonly TelemetryEventName[]` clause enforces at COMPILE time that every name in the tuple is a real event and (with the union) catches drift. No separate runtime parity test needed.

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/events.ts studio/__tests__/lib/telemetry/events.test.ts
git commit -m "feat(studio/observability): typed event catalog"
```

---

## Task 3: Redaction helpers (`redact.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/redact.ts`
- Test: `studio/__tests__/lib/telemetry/redact.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashSlug, truncate, stripPaths, sentryBeforeSend } from "../../../src/lib/telemetry/redact";

describe("redact", () => {
  it("hashSlug is stable + non-reversible", () => {
    const h = hashSlug("my-secret-project");
    expect(h).toBe(hashSlug("my-secret-project"));
    expect(h).not.toContain("secret");
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });

  it("truncate caps length and marks elision", () => {
    expect(truncate("x".repeat(300), 200)).toHaveLength(201);
    expect(truncate("short", 200)).toBe("short");
  });

  it("stripPaths removes arcade-studio project paths", () => {
    const msg = "ENOENT at /Users/me/Library/Application Support/arcade-studio/projects/foo/frames/a.tsx line 3";
    expect(stripPaths(msg)).not.toContain("/projects/foo/");
    expect(stripPaths(msg)).toContain("ENOENT");
  });

  it("sentryBeforeSend scrubs Authorization headers and prompt extras", () => {
    const event: any = {
      request: { headers: { Authorization: "Bearer secret", "Content-Type": "application/json" } },
      extra: { prompt: "my confidential idea", other: "kept" },
    };
    const out = sentryBeforeSend(event);
    expect(out.request.headers.Authorization).toBe("[redacted]");
    expect(out.extra.prompt).toBe("[redacted]");
    expect(out.extra.other).toBe("kept");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/redact.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `redact.ts`**

```ts
import { createHash } from "node:crypto";

/** sha1 of input, first 12 hex chars. Stable, non-reversible for our purposes.
 *  Used for project slugs + frame paths so we can correlate events for the same
 *  project without leaking its name. */
export function hashSlug(slug: string): string {
  return createHash("sha1").update(slug).digest("hex").slice(0, 12);
}

/** Truncate to `max` chars, appending a single ellipsis char when cut. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

/** Remove absolute arcade-studio project paths, leaving the readable error. */
export function stripPaths(s: string): string {
  return s
    .replace(/\/[^\s]*arcade-studio\/projects\/[^\s]*/g, "<frame-path>")
    .replace(/\/Users\/[^\s/]+/g, "<home>");
}

/** Sentry beforeSend: scrub auth headers + prompt-bearing extras. */
export function sentryBeforeSend<T extends Record<string, any>>(event: T): T {
  const headers = event?.request?.headers;
  if (headers && typeof headers === "object") {
    for (const key of Object.keys(headers)) {
      if (/^authorization$/i.test(key)) headers[key] = "[redacted]";
    }
  }
  if (event?.extra && typeof event.extra === "object" && "prompt" in event.extra) {
    event.extra.prompt = "[redacted]";
  }
  return event;
}
```

> Uses `node:crypto` — imported by `server.ts` / `electron/telemetry.ts` only, never the renderer (renderer events carry no slug; server-emitted events arrive pre-hashed).

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/redact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/redact.ts studio/__tests__/lib/telemetry/redact.test.ts
git commit -m "feat(studio/observability): redaction helpers"
```

---

## Task 4: Config resolver + debug sink (`config.ts`, `debugSink.ts`)

Two small pure modules in one task — both are leaves, neither warrants its own commit cycle.

**Files:**
- Create: `studio/src/lib/telemetry/config.ts`, `studio/src/lib/telemetry/debugSink.ts`
- Test: `studio/__tests__/lib/telemetry/config.test.ts`, `studio/__tests__/lib/telemetry/debugSink.test.ts`

- [ ] **Step 1: Write the failing tests**

`config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveConfig } from "../../../src/lib/telemetry/config";

describe("resolveConfig", () => {
  it("disabled when not packaged, even with keys", () => {
    const c = resolveConfig({ packaged: false, debugEnv: undefined, fileConfig: { sentryDsn: "d", posthogKey: "k" } });
    expect(c.enabled).toBe(false);
    expect(c.debug).toBe(false);
  });
  it("enabled when packaged + keys present", () => {
    const c = resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: { sentryDsn: "d", posthogKey: "k", posthogHost: "https://us.i.posthog.com" } });
    expect(c.enabled).toBe(true);
    expect(c.posthogHost).toBe("https://us.i.posthog.com");
  });
  it("packaged but no keys → disabled (silent)", () => {
    expect(resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: {} }).enabled).toBe(false);
  });
  it("debug env forces debug sink, never real send", () => {
    const c = resolveConfig({ packaged: false, debugEnv: "1", fileConfig: {} });
    expect(c.debug).toBe(true);
    expect(c.enabled).toBe(false);
  });
});
```

`debugSink.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { debugTrack, debugError } from "../../../src/lib/telemetry/debugSink";

describe("debugSink", () => {
  it("prints event name + props with a stable prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    debugTrack("renderer", { name: "settings_opened", props: { tab: "general" } }, "user-1");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:renderer] settings_opened"),
      expect.objectContaining({ tab: "general", distinct_id: "user-1" }),
    );
    spy.mockRestore();
  });
  it("prints errors with process tag", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugError("server", new Error("boom"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[telemetry:server] error"), expect.any(Error));
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/config.test.ts studio/__tests__/lib/telemetry/debugSink.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `config.ts`**

```ts
export interface TelemetryFileConfig { sentryDsn?: string; posthogKey?: string; posthogHost?: string }

export interface ResolvedTelemetryConfig {
  sentryDsn?: string;
  posthogKey?: string;
  posthogHost: string;
  /** True only when packaged AND both keys present — actually sends. */
  enabled: boolean;
  /** True when ARCADE_TELEMETRY_DEBUG is set — prints to console sink. */
  debug: boolean;
}

const DEFAULT_HOST = "https://us.i.posthog.com";

export function resolveConfig(input: { packaged: boolean; debugEnv: string | undefined; fileConfig: TelemetryFileConfig }): ResolvedTelemetryConfig {
  const { packaged, debugEnv, fileConfig } = input;
  const hasKeys = Boolean(fileConfig.sentryDsn && fileConfig.posthogKey);
  return {
    sentryDsn: fileConfig.sentryDsn,
    posthogKey: fileConfig.posthogKey,
    posthogHost: fileConfig.posthogHost ?? DEFAULT_HOST,
    enabled: packaged && hasKeys,
    debug: Boolean(debugEnv),
  };
}

/** Read telemetry.config.json from a resources dir. {} on any failure. Node-only. */
export async function readFileConfig(resourcesPath: string | undefined): Promise<TelemetryFileConfig> {
  if (!resourcesPath) return {};
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return JSON.parse(await fs.readFile(path.join(resourcesPath, "telemetry.config.json"), "utf-8"));
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Write `debugSink.ts`**

```ts
import type { TelemetryEvent } from "./events";

export type ProcessTag = "main" | "renderer" | "server";

export function debugTrack(proc: ProcessTag, event: TelemetryEvent, distinctId: string): void {
  console.log(`[telemetry:${proc}] ${event.name}`, { ...event.props, distinct_id: distinctId });
}

export function debugError(proc: ProcessTag, err: unknown): void {
  console.error(`[telemetry:${proc}] error`, err);
}
```

- [ ] **Step 5: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/config.test.ts studio/__tests__/lib/telemetry/debugSink.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/telemetry/config.ts studio/src/lib/telemetry/debugSink.ts studio/__tests__/lib/telemetry/config.test.ts studio/__tests__/lib/telemetry/debugSink.test.ts
git commit -m "feat(studio/observability): config resolver + debug sink"
```

---

## Task 5: Core engine (`core.ts`)

The shared `track()`/`captureError()` routing both processes use. Holds module state; routes to the injected send-adapter when enabled, the debug sink when debug, no-op otherwise. This is the merge that removes server/renderer duplication.

**Files:**
- Create: `studio/src/lib/telemetry/core.ts`
- Test: `studio/__tests__/lib/telemetry/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initCore, track, captureError, __resetForTest } from "../../../src/lib/telemetry/core";

const base = { proc: "server" as const, distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64" };

describe("core telemetry routing", () => {
  beforeEach(() => __resetForTest());

  it("track is a no-op before init", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    track({ name: "settings_opened", props: { tab: "x" } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("routes to debug sink when debug=true, enabled=false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    initCore({ ...base, enabled: false, debug: true, adapter: null });
    track({ name: "frame_generated", props: { project_slug_hash: "h", turn_type: "build" } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:server] frame_generated"),
      expect.objectContaining({ distinct_id: "u1", session_id: "s1", version: "0.30.0" }),
    );
    spy.mockRestore();
  });

  it("routes to adapter when enabled, with super-props merged", () => {
    const captured: any[] = [];
    initCore({ ...base, enabled: true, debug: false, adapter: {
      capture: (name, distinctId, props) => captured.push({ name, distinctId, props }),
      captureException: () => {},
    }});
    track({ name: "settings_opened", props: { tab: "general" } });
    expect(captured[0].name).toBe("settings_opened");
    expect(captured[0].props).toMatchObject({ tab: "general", process: "server", session_id: "s1" });
  });

  it("captureError routes to adapter.captureException when enabled", () => {
    let caught: unknown = null;
    initCore({ ...base, enabled: true, debug: false, adapter: {
      capture: () => {}, captureException: (e) => { caught = e; },
    }});
    const err = new Error("x");
    captureError(err);
    expect(caught).toBe(err);
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/core.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `core.ts`**

```ts
import type { TelemetryEvent } from "./events";
import { debugTrack, debugError, type ProcessTag } from "./debugSink";

/** Pluggable send target. server.ts/renderer.ts build this from their SDKs. */
export interface SendAdapter {
  capture(eventName: string, distinctId: string, props: Record<string, unknown>): void;
  captureException(err: unknown): void;
}

interface CoreState {
  proc: ProcessTag;
  enabled: boolean;
  debug: boolean;
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
  adapter: SendAdapter | null;
}

let state: CoreState | null = null;

export function initCore(args: CoreState): void {
  state = { ...args };
}

function superProps() {
  return {
    distinct_id: state!.distinctId,
    session_id: state!.sessionId,
    version: state!.version,
    os: state!.os,
    process: state!.proc,
  };
}

export function track(event: TelemetryEvent): void {
  if (!state) return; // not initialized → no-op
  const props = { ...event.props, ...superProps() };
  if (state.enabled && state.adapter) {
    try { state.adapter.capture(event.name, state.distinctId, props); }
    catch (err) { console.warn("[telemetry] capture failed:", err instanceof Error ? err.message : err); }
    return;
  }
  if (state.debug) debugTrack(state.proc, event, state.distinctId);
}

export function captureError(err: unknown): void {
  if (!state) return;
  if (state.enabled && state.adapter) {
    try { state.adapter.captureException(err); } catch {}
    return;
  }
  if (state.debug) debugError(state.proc, err);
}

/** Test-only: clears module state between tests. */
export function __resetForTest(): void { state = null; }
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/core.ts studio/__tests__/lib/telemetry/core.test.ts
git commit -m "feat(studio/observability): shared core routing engine"
```

---

## Task 6: Identity resolver + DevRev email

Combines the pure `distinct_id` resolver with the one-line `auth.ts` extension it depends on.

**Files:**
- Create: `studio/src/lib/telemetry/identity.ts`
- Modify: `studio/server/relay/auth.ts`
- Test: `studio/__tests__/lib/telemetry/identity.test.ts`, `studio/__tests__/server/relay/auth-email.test.ts`

- [ ] **Step 1: Write the failing tests**

`identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveDistinctId } from "../../../src/lib/telemetry/identity";

describe("resolveDistinctId", () => {
  it("returns persisted id when already set", async () => {
    const id = await resolveDistinctId({
      readSettings: async () => ({ telemetry: { distinctId: "alice@devrev.ai" } }),
      writeDistinctId: async () => {}, resolveEmail: async () => null, genUuid: () => "uuid-x",
    });
    expect(id).toBe("alice@devrev.ai");
  });
  it("uses DevRev email when no persisted id", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}), writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => "bob@devrev.ai", genUuid: () => "uuid-x",
    });
    expect(id).toBe("bob@devrev.ai");
    expect(writes).toEqual(["bob@devrev.ai"]);
  });
  it("falls back to anonymous uuid when no email", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}), writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => null, genUuid: () => "anon-uuid-1",
    });
    expect(id).toBe("anon-uuid-1");
    expect(writes).toEqual(["anon-uuid-1"]);
  });
});
```

`auth-email.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/relay/auth";

describe("resolveDevuFromPat email", () => {
  afterEach(() => vi.restoreAllMocks());
  it("returns email when present in dev-users.self", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ dev_user: { id: "devu/1", display_name: "Al", email: "al@devrev.ai" } }),
    })) as any);
    const id = await resolveDevuFromPat("pat");
    expect(id?.email).toBe("al@devrev.ai");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/identity.test.ts studio/__tests__/server/relay/auth-email.test.ts`
Expected: FAIL — module/email missing.

- [ ] **Step 3: Write `identity.ts`**

```ts
/**
 * Resolves the telemetry distinct_id. Dependency-injected for pure testing.
 * Order: persisted settings.telemetry.distinctId → DevRev email → anon UUID.
 * Whatever is resolved is persisted so renderer + server agree.
 */
export interface IdentityDeps {
  readSettings: () => Promise<{ telemetry?: { distinctId?: string } }>;
  writeDistinctId: (id: string) => Promise<void>;
  resolveEmail: () => Promise<string | null>;
  genUuid: () => string;
}

export async function resolveDistinctId(deps: IdentityDeps): Promise<string> {
  const existing = (await deps.readSettings()).telemetry?.distinctId;
  if (existing) return existing;
  const id = (await deps.resolveEmail()) ?? deps.genUuid();
  await deps.writeDistinctId(id);
  return id;
}
```

- [ ] **Step 4: Extend `auth.ts`**

In `studio/server/relay/auth.ts`, add `email` to the interface:
```ts
export interface DevuIdentity {
  id: string;
  displayName: string;
  email?: string;
}
```
And update the parse + return block:
```ts
    const data = (await res.json()) as {
      dev_user?: { id?: string; display_name?: string; email?: string };
    };
    if (data.dev_user?.id && data.dev_user?.display_name) {
      return { id: data.dev_user.id, displayName: data.dev_user.display_name, email: data.dev_user.email };
    }
```

- [ ] **Step 5: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/identity.test.ts studio/__tests__/server/relay/auth-email.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/telemetry/identity.ts studio/server/relay/auth.ts studio/__tests__/lib/telemetry/identity.test.ts studio/__tests__/server/relay/auth-email.test.ts
git commit -m "feat(studio/observability): distinct_id resolver + devrev email"
```

---

## PHASE B — Walking skeleton (first end-to-end signal)

## Task 7: Server adapter shim + index + mocks (`server.ts`, `index.ts`, `__mocks__`)

**Files:**
- Create: `studio/src/lib/telemetry/server.ts`, `index.ts`, `__mocks__/index.ts`
- Test: `studio/__tests__/lib/telemetry/server.test.ts`

`server.ts` builds the Node send-adapter (lazy-imports `@sentry/node` + `posthog-node` only when enabled) and delegates everything else to core.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initServerTelemetry } from "../../../src/lib/telemetry/server";
import { track, __resetForTest } from "../../../src/lib/telemetry/core";

describe("server telemetry shim", () => {
  beforeEach(() => __resetForTest());

  it("wires core so track routes to the debug sink when debug=true", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await initServerTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64",
    });
    track({ name: "prompt_submitted", props: { prompt_length: 3, project_slug_hash: "h", frame_count_before: 0 } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:server] prompt_submitted"),
      expect.objectContaining({ distinct_id: "u1" }),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/server.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `server.ts`**

```ts
import type { ResolvedTelemetryConfig } from "./config";
import { sentryBeforeSend } from "./redact";
import { initCore, type SendAdapter } from "./core";

export { track, captureError } from "./core";

interface InitArgs {
  config: Pick<ResolvedTelemetryConfig, "enabled" | "debug" | "posthogHost"> & { sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

let posthogRef: any = null;

export async function initServerTelemetry(args: InitArgs): Promise<void> {
  let adapter: SendAdapter | null = null;
  let sentry: any = null;
  let posthog: any = null;
  try {
    if (args.config.enabled && args.config.sentryDsn) {
      sentry = await import("@sentry/node");
      sentry.init({ dsn: args.config.sentryDsn, release: `arcade-studio@${args.version}`, beforeSend: (e: any) => sentryBeforeSend(e) });
      sentry.setTag("process", "server");
    }
    if (args.config.enabled && args.config.posthogKey) {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(args.config.posthogKey, { host: args.config.posthogHost });
    }
    if (args.config.enabled) {
      adapter = {
        capture: (name, distinctId, props) => posthog?.capture({ distinctId, event: name, properties: props }),
        captureException: (err) => sentry?.captureException(err),
      };
    }
  } catch (err) {
    console.warn("[telemetry] server init failed:", err instanceof Error ? err.message : err);
  }
  posthogRef = posthog;
  initCore({ proc: "server", enabled: args.config.enabled, debug: args.config.debug, distinctId: args.distinctId, sessionId: args.sessionId, version: args.version, os: args.os, adapter });
}

export async function shutdownServerTelemetry(): Promise<void> {
  try { await posthogRef?.shutdown?.(); } catch {}
}
```

- [ ] **Step 4: Write `index.ts` + `__mocks__/index.ts`**

`index.ts` (only shared/safe re-exports — call sites import `./server` or `./renderer` directly for `track`):
```ts
export type { TelemetryEvent, TelemetryEventName, GenerationErrorKind, FrameErrorKind, ShareErrorKind } from "./events";
export { EVENT_NAMES } from "./events";
export { hashSlug, truncate, stripPaths } from "./redact";
```

`__mocks__/index.ts`:
```ts
export const EVENT_NAMES = [] as const;
export const hashSlug = (s: string) => s;
export const truncate = (s: string) => s;
export const stripPaths = (s: string) => s;
```

- [ ] **Step 5: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/telemetry/server.ts studio/src/lib/telemetry/index.ts studio/src/lib/telemetry/__mocks__/index.ts studio/__tests__/lib/telemetry/server.test.ts
git commit -m "feat(studio/observability): server adapter shim + index"
```

---

## Task 8: Identity endpoint middleware

**Files:**
- Create: `studio/server/middleware/telemetryIdentity.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/middleware/telemetry-identity.test.ts`

`GET /api/telemetry/identity` returns the snapshot the server resolves at boot, so the renderer inits with the same identity + keys.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { telemetryIdentityMiddleware, __setIdentitySnapshot } from "../../../server/middleware/telemetryIdentity";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockRes() {
  const chunks: string[] = []; let status = 0;
  return { writeHead(s: number) { status = s; }, end(b?: string) { if (b) chunks.push(b); },
    get status() { return status; }, get body() { return chunks.join(""); } } as unknown as ServerResponse & { status: number; body: string };
}

describe("telemetry identity endpoint", () => {
  it("returns the cached identity snapshot", async () => {
    __setIdentitySnapshot({ distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64", config: { enabled: false, debug: true, posthogHost: "h" } });
    const res = mockRes() as any; let nextCalled = false;
    await telemetryIdentityMiddleware()({ url: "/api/telemetry/identity", method: "GET" } as IncomingMessage, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).distinctId).toBe("u1");
  });
  it("passes through unrelated urls", async () => {
    const res = mockRes() as any; let nextCalled = false;
    await telemetryIdentityMiddleware()({ url: "/api/other", method: "GET" } as IncomingMessage, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/server/middleware/telemetry-identity.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `telemetryIdentity.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

export interface IdentitySnapshot {
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
  config: { enabled: boolean; debug: boolean; posthogHost: string; posthogKey?: string; sentryDsn?: string };
}

let snapshot: IdentitySnapshot | null = null;

/** Called once at server boot after identity is resolved. */
export function setIdentitySnapshot(s: IdentitySnapshot): void { snapshot = s; }
/** Test seam. */
export function __setIdentitySnapshot(s: IdentitySnapshot): void { snapshot = s; }

export function telemetryIdentityMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/telemetry/identity" || req.method !== "GET") return next?.();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot ?? { distinctId: "", sessionId: "", version: "", os: "", config: { enabled: false, debug: false, posthogHost: "" } }));
  };
}
```

- [ ] **Step 4: Register in `vite.config.ts`**

Add import after line 37:
```ts
import { telemetryIdentityMiddleware } from "./server/middleware/telemetryIdentity";
```
Register inside `configureServer`, right after `server.middlewares.use(versionMiddleware());` (line 53):
```ts
      server.middlewares.use(telemetryIdentityMiddleware());
```

- [ ] **Step 5: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/server/middleware/telemetry-identity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/telemetryIdentity.ts studio/vite.config.ts studio/__tests__/server/middleware/telemetry-identity.test.ts
git commit -m "feat(studio/observability): /api/telemetry/identity endpoint"
```

---

## Task 9: Server boot — resolve identity + init telemetry

**Files:**
- Modify: `studio/vite.config.ts`, `studio/server/middleware/settings.ts`

At boot: read injected config, resolve distinct_id, init server telemetry, publish the snapshot. Reads env forwarded by `viteRunner.ts` (Task 15): `ARCADE_RESOURCES_PATH`, `ARCADE_IS_PACKAGED`, `ARCADE_APP_VERSION`. `session_id` = a UUID per Vite-child launch. The server does NOT emit `app_launched` — main owns lifecycle (Task 15).

- [ ] **Step 1: Add a distinct_id writer to `settings.ts`**

After `readGlobalSettings`, add (mirror the file's existing write path; if a private `writeSettings(next)` exists, call it instead of re-implementing the write):
```ts
/** Persist the resolved telemetry distinct_id under settings.telemetry.distinctId. */
export async function writeTelemetryDistinctId(id: string): Promise<void> {
  const current = await readSettings();
  const next = mergeSettings(current as Record<string, unknown>, { telemetry: { distinctId: id } });
  const file = path.join(studioRoot(), SETTINGS_FILE);
  await fs.writeFile(file, JSON.stringify(next, null, 2));
}
```

- [ ] **Step 2: Add the boot block to `vite.config.ts`**

Add imports near the other server imports:
```ts
import { resolveConfig, readFileConfig } from "./src/lib/telemetry/config";
import { resolveDistinctId } from "./src/lib/telemetry/identity";
import { initServerTelemetry } from "./src/lib/telemetry/server";
import { setIdentitySnapshot } from "./server/middleware/telemetryIdentity";
import { writeTelemetryDistinctId, readGlobalSettings } from "./server/middleware/settings";
import { resolveDevuFromPat } from "./server/relay/auth";
import { getDevRevPat } from "./server/secrets/keychain";
import { randomUUID } from "node:crypto";
```
Add right before `void logVersionOnBoot();` (line ~134):
```ts
      void (async () => {
        try {
          const resourcesPath = process.env.ARCADE_RESOURCES_PATH;
          const packaged = process.env.ARCADE_IS_PACKAGED === "1";
          const fileConfig = await readFileConfig(resourcesPath);
          const config = resolveConfig({ packaged, debugEnv: process.env.ARCADE_TELEMETRY_DEBUG, fileConfig });

          const distinctId = await resolveDistinctId({
            readSettings: async () => (await readGlobalSettings()) as any,
            writeDistinctId: writeTelemetryDistinctId,
            resolveEmail: async () => {
              try {
                const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
                if (!pat) return null;
                return (await resolveDevuFromPat(pat))?.email ?? null;
              } catch { return null; }
            },
            genUuid: () => randomUUID(),
          });

          const version = process.env.ARCADE_APP_VERSION || process.env.npm_package_version || "0.0.0";
          const os = `${process.platform}-${process.arch}`;
          const sessionId = randomUUID();

          await initServerTelemetry({ config, distinctId, sessionId, version, os });
          setIdentitySnapshot({ distinctId, sessionId, version, os, config });
          if (config.debug || config.enabled) console.log(`[telemetry] server ready (enabled=${config.enabled} debug=${config.debug})`);
        } catch (err) {
          console.warn("[telemetry] server boot block failed:", err instanceof Error ? err.message : err);
        }
      })();
```

- [ ] **Step 3: Verify dev boot prints debug-ready when forced**

Run:
```bash
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio
```
Expected: console shows `[telemetry] server ready (enabled=false debug=true)` shortly after boot. Ctrl-C to quit.

- [ ] **Step 4: Full suite (no regressions)**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts studio/server/middleware/settings.ts
git commit -m "feat(studio/observability): server boot resolves identity + inits telemetry"
```

---

## Task 10: WALKING SKELETON — `prompt_submitted` end-to-end + smoke test

The first event through the whole pipe. `prompt_submitted` is the simplest (fires at handler entry, no classification). Proves config gate + identity + server init + core routing + a real callsite, all in dev via the debug sink. **Stop and confirm this works before fanning out.**

**Files:**
- Modify: `studio/server/middleware/chat.ts`

- [ ] **Step 1: Add imports to `chat.ts`**

Near the other server imports:
```ts
import { track } from "../../src/lib/telemetry/server";
import { hashSlug } from "../../src/lib/telemetry/redact";
```

- [ ] **Step 2: Emit `prompt_submitted` in `handleStart`**

In `handleStart`, after the running-turn 409 guard (after `project` is confirmed, before launching the turn), add:
```ts
  track({
    name: "prompt_submitted",
    props: {
      prompt_length: prompt.length,
      project_slug_hash: hashSlug(slug),
      frame_count_before: project.frames?.length ?? 0,
    },
  });
```

- [ ] **Step 3: SMOKE TEST end-to-end in dev**

Run:
```bash
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio
```
In the browser: open a project, send a prompt. In the terminal confirm:
```
[telemetry] server ready (enabled=false debug=true)
[telemetry:server] prompt_submitted { prompt_length: …, project_slug_hash: '…', frame_count_before: …, distinct_id: '…', session_id: '…', version: '…', os: 'darwin-…', process: 'server' }
```
This is the plumbing proof: config → identity → core → debug sink → real callsite all work. If the line is missing, fix before continuing (check the boot block ran, env forwarded, import path).

- [ ] **Step 4: Confirm silent when no debug flag**

Run: `pnpm run studio` (no flag). Send a prompt. Expected: NO `[telemetry:*]` lines.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/chat.ts
git commit -m "feat(studio/observability): prompt_submitted event (walking skeleton, end-to-end verified)"
```

---

## PHASE C — Fan out remaining events

## Task 11: Generation outcome events + classifier (chat.ts)

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Test: `studio/__tests__/server/chat-telemetry.test.ts`

Adds `frame_generated` / `generation_failed` at the `recordTurnMetric` callsite (~line 692) and `generation_cancelled` in `handleCancel`, plus the pure exported classifier.

- [ ] **Step 1: Write the failing classifier test**

```ts
import { describe, it, expect } from "vitest";
import { classifyGenerationError } from "../../server/middleware/chat";

describe("classifyGenerationError", () => {
  it("bedrock auth from message", () => {
    expect(classifyGenerationError({ error: "Bedrock credentials expired", timedOut: false, exitCode: 0 })).toBe("bedrock_auth");
  });
  it("timeout", () => {
    expect(classifyGenerationError({ error: "timed out after 120s", timedOut: true, exitCode: null })).toBe("timeout");
  });
  it("cli crash on nonzero exit", () => {
    expect(classifyGenerationError({ error: "boom", timedOut: false, exitCode: 1 })).toBe("cli_crash");
  });
  it("other fallback", () => {
    expect(classifyGenerationError({ error: "weird", timedOut: false, exitCode: 0 })).toBe("other");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/server/chat-telemetry.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the classifier + import to `chat.ts`**

Add import:
```ts
import type { GenerationErrorKind } from "../../src/lib/telemetry/events";
```
Add the exported classifier near the top-level helpers:
```ts
/** Map a finished/crashed turn to a telemetry error_kind. Pure + exported for test. */
export function classifyGenerationError(info: { error?: string; timedOut: boolean; exitCode: number | null }): GenerationErrorKind {
  if (info.timedOut) return "timeout";
  const msg = (info.error ?? "").toLowerCase();
  if (/bedrock|credential|expired|auth|sso|token/.test(msg)) return "bedrock_auth";
  if (typeof info.exitCode === "number" && info.exitCode !== 0) return "cli_crash";
  if (/parse|json|unexpected token/.test(msg)) return "parser_error";
  return "other";
}
```

- [ ] **Step 4: Emit outcome events after the `recordTurnMetric` callsite**

Right AFTER the `void recordTurnMetric({...});` block (line ~692):
```ts
  if (endResult.ok) {
    track({
      name: "frame_generated",
      props: {
        project_slug_hash: hashSlug(slug),
        duration_ms: lastMetrics?.durationMs,
        model: lastMetrics?.model,
        tokens_input: lastMetrics?.inputTokens,
        tokens_output: lastMetrics?.outputTokens,
        turn_type: turnType,
        frame_lines: frameLines,
      },
    });
  } else {
    track({
      name: "generation_failed",
      props: {
        project_slug_hash: hashSlug(slug),
        duration_ms: lastMetrics?.durationMs,
        error_kind: classifyGenerationError({ error: endResult.error, timedOut: didStall, exitCode: null }),
        model: lastMetrics?.model,
      },
    });
  }
```

- [ ] **Step 5: Emit `generation_cancelled` in `handleCancel`**

In `handleCancel` (takes the slug match group), after the turn is aborted:
```ts
  track({ name: "generation_cancelled", props: { project_slug_hash: hashSlug(slug) } });
```

- [ ] **Step 6: Run classifier test + full suite**

Run: `pnpm run studio:test studio/__tests__/server/chat-telemetry.test.ts`
Expected: PASS.
Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/chat-telemetry.test.ts
git commit -m "feat(studio/observability): generation outcome events + error classifier"
```

---

## Task 12: frame_runtime_error (runtimeError.ts)

**Files:**
- Modify: `studio/server/middleware/runtimeError.ts`
- Test: `studio/__tests__/server/runtime-error-telemetry.test.ts`

The screenshot case: generation reports success, frame won't mount (`does not provide an export named 'Lightning'`). Already arrives at `/api/runtime-error`; emit a PostHog event + Sentry exception alongside the existing auto-fix dispatch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyFrameError } from "../../server/middleware/runtimeError";

describe("classifyFrameError", () => {
  it("module not found from export error", () => {
    expect(classifyFrameError("does not provide an export named 'Lightning'")).toBe("module_not_found");
  });
  it("syntax error", () => {
    expect(classifyFrameError("SyntaxError: Unexpected token")).toBe("syntax_error");
  });
  it("hmr failure", () => {
    expect(classifyFrameError("[hmr] Failed to reload")).toBe("hmr_failure");
  });
  it("runtime exception fallback", () => {
    expect(classifyFrameError("Cannot read properties of undefined")).toBe("runtime_exception");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/server/runtime-error-telemetry.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Modify `runtimeError.ts`**

Add imports:
```ts
import { track, captureError } from "../../src/lib/telemetry/server";
import { hashSlug, truncate, stripPaths } from "../../src/lib/telemetry/redact";
import type { FrameErrorKind } from "../../src/lib/telemetry/events";
```
Add the exported classifier:
```ts
export function classifyFrameError(message: string): FrameErrorKind {
  if (/does not provide an export|Failed to (resolve|fetch|load).*module|Cannot find module/i.test(message)) return "module_not_found";
  if (/SyntaxError|Unexpected token/i.test(message)) return "syntax_error";
  if (/\[hmr\]|hot update|hmr/i.test(message)) return "hmr_failure";
  return "runtime_exception";
}
```
Inside the handler, after the validation guard (where `slug`, `frame`, `message` are set) and alongside the `handleRuntimeError` dispatch:
```ts
    const kind = classifyFrameError(message);
    track({
      name: "frame_runtime_error",
      props: {
        project_slug_hash: hashSlug(slug),
        error_kind: kind,
        error_message: truncate(stripPaths(message), 200),
        frame_hash: hashSlug(frame),
      },
    });
    captureError(new Error(`frame_runtime_error: ${kind}`));
```

- [ ] **Step 4: Run + verify PASS + full suite**

Run: `pnpm run studio:test studio/__tests__/server/runtime-error-telemetry.test.ts`
Expected: PASS.
Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/runtimeError.ts studio/__tests__/server/runtime-error-telemetry.test.ts
git commit -m "feat(studio/observability): frame_runtime_error event"
```

---

## Task 13: Share events (server + UI)

**Files:**
- Modify: `studio/server/middleware/cloudflare.ts`, `studio/src/components/shell/ShareModal.tsx`
- Test: `studio/__tests__/server/cloudflare-telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyShareError } from "../../server/middleware/cloudflare";

describe("classifyShareError", () => {
  it("auth from invalid_key code", () => {
    expect(classifyShareError({ code: "invalid_key", status: 401 })).toBe("auth");
  });
  it("worker 5xx", () => {
    expect(classifyShareError({ code: undefined, status: 503 })).toBe("worker_5xx");
  });
  it("bundle error", () => {
    expect(classifyShareError({ code: "bundle_error", status: 500 })).toBe("bundle_error");
  });
  it("network fallback", () => {
    expect(classifyShareError({ code: undefined, status: 0 })).toBe("network");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/server/cloudflare-telemetry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `cloudflare.ts`**

Add imports:
```ts
import { track } from "../../src/lib/telemetry/server";
import type { ShareErrorKind } from "../../src/lib/telemetry/events";
```
Add classifier:
```ts
export function classifyShareError(info: { code?: string; status: number }): ShareErrorKind {
  if (info.code === "invalid_key" || info.code === "missing_key" || info.status === 401) return "auth";
  if (info.code === "bundle_error") return "bundle_error";
  if (info.status >= 500) return "worker_5xx";
  if (info.status === 0) return "network";
  return "other";
}
```
Before `let deployment;` capture a start stamp:
```ts
        const shareStart = Date.now();
```
Change the success path (line 129) to emit then return:
```ts
        track({ name: "share_succeeded", props: { duration_ms: Date.now() - shareStart, frame_count: projectJson.frames?.length ?? 0 } });
        return send(res, 200, { url: deployment.url, deployId: deployment.deployId });
```
In the inner `invalid_key`/`missing_key` 401 branch (line ~111), before its `send(res, 401, ...)`:
```ts
          track({ name: "share_failed", props: { duration_ms: Date.now() - shareStart, error_kind: "auth" } });
```
In the outer `catch (err)` (line ~130), before the 500 send:
```ts
        track({ name: "share_failed", props: { duration_ms: Date.now() - shareStart, error_kind: classifyShareError({ code: err?.code, status: 500 }) } });
```

- [ ] **Step 4: Modify `ShareModal.tsx`**

Add import:
```ts
import { track } from "../../lib/telemetry/renderer";
```
On open — in the `useEffect(() => { ... }, [open])` (line ~56), at the top of the effect when `open`:
```ts
    if (open) track({ name: "share_opened", props: { frame_count: frames?.length ?? 0 } });
```
> Use whatever the component already holds for the frame list/count.
On deploy click — in the handler that does `setPhase("deploying")` (line ~84), right before the fetch:
```ts
    track({ name: "share_started", props: { frame_count: frames?.length ?? 0, project_slug_hash: "" } });
```
> `project_slug_hash` is hashed server-side for outcome events; the renderer doesn't import `node:crypto`. Send `""` — correlation uses distinct_id + session_id.
On copy — in the copy-URL handler:
```ts
    track({ name: "share_url_copied", props: {} });
```

- [ ] **Step 5: Run + verify PASS + full suite**

Run: `pnpm run studio:test studio/__tests__/server/cloudflare-telemetry.test.ts`
Expected: PASS.
Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/cloudflare.ts studio/src/components/shell/ShareModal.tsx studio/__tests__/server/cloudflare-telemetry.test.ts
git commit -m "feat(studio/observability): share flow events"
```

---

## Task 14: Renderer shim + init + settings_opened

**Files:**
- Create: `studio/src/lib/telemetry/renderer.ts`
- Modify: `studio/src/main.tsx`, `studio/src/components/shell/AppSettingsModal.tsx`
- Test: `studio/__tests__/lib/telemetry/renderer.test.ts`

`renderer.ts` is the browser twin of `server.ts`: builds a `@sentry/browser` + `posthog-js` adapter, delegates to core. No `node:crypto`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initRendererTelemetry } from "../../../src/lib/telemetry/renderer";
import { track, __resetForTest } from "../../../src/lib/telemetry/core";

describe("renderer telemetry shim", () => {
  beforeEach(() => __resetForTest());
  it("wires core so track routes to debug sink when debug=true", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    initRendererTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1", sessionId: "s1", version: "0.30.0", os: "darwin-arm64",
    });
    track({ name: "settings_opened", props: { tab: "general" } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:renderer] settings_opened"),
      expect.objectContaining({ tab: "general", distinct_id: "u1" }),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/renderer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `renderer.ts`**

```ts
import { initCore, type SendAdapter } from "./core";

export { track, captureError } from "./core";

interface InitArgs {
  config: { enabled: boolean; debug: boolean; posthogHost: string; sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

export function initRendererTelemetry(args: InitArgs): void {
  let adapter: SendAdapter | null = null;
  if (args.config.enabled && (args.config.sentryDsn || args.config.posthogKey)) {
    // Build a deferred adapter; SDKs load async but track() before they're
    // ready simply no-ops the capture (debug path already gated off).
    let sentry: any = null;
    let posthog: any = null;
    if (args.config.sentryDsn) {
      void import("@sentry/browser").then((S) => {
        S.init({ dsn: args.config.sentryDsn!, release: `arcade-studio@${args.version}` });
        S.setTag("process", "renderer");
        sentry = S;
      });
    }
    if (args.config.posthogKey) {
      void import("posthog-js").then(({ default: ph }) => {
        ph.init(args.config.posthogKey!, { api_host: args.config.posthogHost, autocapture: false, capture_pageview: false, disable_session_recording: true });
        ph.identify(args.distinctId);
        posthog = ph;
      });
    }
    adapter = {
      capture: (name, _distinctId, props) => { try { posthog?.capture(name, props); } catch {} },
      captureException: (err) => { try { sentry?.captureException(err); } catch {} },
    };
  }
  initCore({ proc: "renderer", enabled: args.config.enabled, debug: args.config.debug, distinctId: args.distinctId, sessionId: args.sessionId, version: args.version, os: args.os, adapter });
}
```

> `disable_session_recording: true` — spec decided replay OFF.

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Init renderer telemetry in `main.tsx`**

Replace `main.tsx` body:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "@xorkavi/arcade-gen/styles.css";
import "./styles/tailwind.css";
import "./styles/arcade-gen-patches.css";
import "./styles/studio.css";
import { App } from "./App";
import { initRendererTelemetry } from "./lib/telemetry/renderer";

async function boot() {
  try {
    const res = await fetch("/api/telemetry/identity");
    if (res.ok) {
      const id = await res.json();
      initRendererTelemetry({ config: id.config, distinctId: id.distinctId, sessionId: id.sessionId, version: id.version, os: id.os });
    }
  } catch { /* telemetry must never block boot */ }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

void boot();
```

- [ ] **Step 6: Emit `settings_opened` in `AppSettingsModal.tsx`**

Add import:
```ts
import { track } from "../../lib/telemetry/renderer";
```
Update the open effect (line ~119):
```ts
  useEffect(() => {
    if (open) {
      void fetchSettings();
      track({ name: "settings_opened", props: { tab: "general" } });
    }
  }, [open, fetchSettings]);
```
> If the modal holds an `activeTab` state, pass it instead of `"general"`.

- [ ] **Step 7: Full suite**

Run: `pnpm run studio:test`
Expected: PASS.
> If AppSettingsModal component tests break on the renderer import, add to that test file: `vi.mock("../../src/lib/telemetry/renderer", () => ({ track: () => {} }))`.

- [ ] **Step 8: Commit**

```bash
git add studio/src/lib/telemetry/renderer.ts studio/src/main.tsx studio/src/components/shell/AppSettingsModal.tsx studio/__tests__/lib/telemetry/renderer.test.ts
git commit -m "feat(studio/observability): renderer init + settings_opened event"
```

---

## PHASE D — Main process + packaging

## Task 15: Main process telemetry + lifecycle (electron/)

**Files:**
- Create: `electron/telemetry.ts`
- Modify: `electron/main.ts`, `electron/viteRunner.ts`

Self-contained (`electron/tsconfig.json` can't reach `studio/src`). Inits `@sentry/electron` in main, emits `app_launched`/`app_shutdown` via its own `posthog-node`, and forwards `ARCADE_RESOURCES_PATH`/`ARCADE_IS_PACKAGED`/`ARCADE_APP_VERSION`/`ARCADE_TELEMETRY_DEBUG` into the Vite child.

- [ ] **Step 1: Write `electron/telemetry.ts`**

```ts
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface FileConfig { sentryDsn?: string; posthogKey?: string; posthogHost?: string }

function readConfig(): FileConfig {
  try { return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "telemetry.config.json"), "utf-8")); }
  catch { return {}; }
}

let posthog: any = null;
let sessionStart = 0;
let distinctId = "anonymous";
let enabled = false;
let debug = false;
const DEFAULT_HOST = "https://us.i.posthog.com";

export async function initMainTelemetry(): Promise<void> {
  const cfg = readConfig();
  debug = Boolean(process.env.ARCADE_TELEMETRY_DEBUG);
  enabled = app.isPackaged && Boolean(cfg.sentryDsn && cfg.posthogKey);
  sessionStart = Date.now();

  if (enabled && cfg.sentryDsn) {
    try {
      const Sentry = await import("@sentry/electron/main");
      Sentry.init({ dsn: cfg.sentryDsn, release: `arcade-studio@${app.getVersion()}` });
    } catch (err) { console.error("[telemetry] main sentry init failed:", err); }
  }
  if (enabled && cfg.posthogKey) {
    try {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(cfg.posthogKey, { host: cfg.posthogHost ?? DEFAULT_HOST });
    } catch (err) { console.error("[telemetry] main posthog init failed:", err); }
  }
}

function emit(event: string, props: Record<string, unknown>): void {
  const full = { ...props, distinct_id: distinctId, process: "main", version: app.getVersion() };
  if (enabled && posthog) { try { posthog.capture({ distinctId, event, properties: full }); } catch {} }
  else if (debug) console.log(`[telemetry:main] ${event}`, full);
}

export function emitAppLaunched(isFirstLaunch: boolean): void {
  emit("app_launched", {
    version: app.getVersion(),
    os: `${process.platform}-${process.arch}`,
    os_version: process.getSystemVersion?.() ?? "",
    is_first_launch: isFirstLaunch,
  });
}

export async function emitAppShutdown(): Promise<void> {
  emit("app_shutdown", { session_duration_ms: Date.now() - sessionStart });
  try { await posthog?.shutdown?.(); } catch {}
}
```

> v1 simplification: main uses `distinct_id="anonymous"` (the Vite child resolves the real DevRev id and carries the bulk of value events). `is_first_launch` is always `false`. Both flagged in "Known follow-ups".

- [ ] **Step 2: Wire into `electron/main.ts`**

Add import at top:
```ts
import { initMainTelemetry, emitAppLaunched, emitAppShutdown } from "./telemetry.js";
```
Set env flags before `createWindow` (near `patchPath()`, line ~51):
```ts
process.env.ARCADE_IS_PACKAGED = app.isPackaged ? "1" : "0";
process.env.ARCADE_APP_VERSION = app.getVersion();
```
Make `whenReady` async + init first (line ~192):
```ts
app.whenReady().then(async () => {
  await initMainTelemetry();
  emitAppLaunched(false);
  void createWindow();
  initUpdater();
});
```
Flush in `before-quit` (line ~204):
```ts
app.on("before-quit", async (event) => {
  event.preventDefault();
  await emitAppShutdown();
  await stopVite();
  app.exit(0);
});
```

- [ ] **Step 3: Forward env in `viteRunner.ts`**

In the `spawn(... { env: {...} })` block (line ~26):
```ts
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ARCADE_STUDIO_OPEN_BROWSER: "0",
      ARCADE_RESOURCES_PATH: process.resourcesPath ?? "",
      ARCADE_IS_PACKAGED: process.env.ARCADE_IS_PACKAGED ?? "",
      ARCADE_APP_VERSION: process.env.ARCADE_APP_VERSION ?? "",
    },
```

- [ ] **Step 4: Compile + smoke-test**

Run:
```bash
pnpm exec tsc -p electron/tsconfig.json
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio:electron
```
Expected: terminal shows `[telemetry:main] app_launched {...}` on launch and `[telemetry:main] app_shutdown {...}` on quit; server events still appear from the Vite child.

- [ ] **Step 5: Commit**

```bash
git add electron/telemetry.ts electron/main.ts electron/viteRunner.ts
git commit -m "feat(studio/observability): main-process sentry + app lifecycle events"
```

---

## Task 16: Build-time config injection + release

**Files:**
- Create: `studio/packaging/scripts/gen-telemetry-config.mjs`
- Modify: `electron-builder.yml`, `package.json`, `studio/CHANGELOG.md`
- Test: `studio/__tests__/packaging/gen-telemetry-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildConfigObject } from "../../packaging/scripts/gen-telemetry-config.mjs";

describe("buildConfigObject", () => {
  it("maps env names to config keys", () => {
    expect(buildConfigObject({ SENTRY_DSN_STUDIO: "https://x@sentry.io/1", POSTHOG_KEY_STUDIO: "phc_abc", POSTHOG_HOST: "https://eu.i.posthog.com" }))
      .toEqual({ sentryDsn: "https://x@sentry.io/1", posthogKey: "phc_abc", posthogHost: "https://eu.i.posthog.com" });
  });
  it("returns empty object when no keys (build still works, telemetry silent)", () => {
    expect(buildConfigObject({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/packaging/gen-telemetry-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `gen-telemetry-config.mjs`**

```js
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Pure: map raw env to the telemetry.config.json shape. Only emits present keys
 *  so a missing key → silent telemetry. */
export function buildConfigObject(env) {
  const out = {};
  if (env.SENTRY_DSN_STUDIO) out.sentryDsn = env.SENTRY_DSN_STUDIO;
  if (env.POSTHOG_KEY_STUDIO) out.posthogKey = env.POSTHOG_KEY_STUDIO;
  if (env.POSTHOG_HOST) out.posthogHost = env.POSTHOG_HOST;
  return out;
}

function parseDotenv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", "..");
  const envPath = join(repoRoot, ".env.production");
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, "utf-8")) : {};
  const config = buildConfigObject({ ...fileEnv, ...process.env });
  const outPath = join(here, "..", "telemetry.config.json");
  writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`[gen-telemetry-config] wrote ${outPath} (${Object.keys(config).length} keys)`);
}
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/packaging/gen-telemetry-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Add to `electron-builder.yml` extraResources**

In the `extraResources:` list:
```yaml
  - from: "studio/packaging/telemetry.config.json"
    to: "telemetry.config.json"
```

- [ ] **Step 6: Run the gen script in pack/release (`package.json`)**

Insert `node studio/packaging/scripts/gen-telemetry-config.mjs &&` right before `pnpm exec electron-builder` in BOTH `studio:pack` and `studio:release`:
```
"studio:pack": "pnpm run kit:build && bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && node studio/packaging/scripts/gen-telemetry-config.mjs && pnpm exec electron-builder --mac --config electron-builder.yml --publish never",
```

- [ ] **Step 7: Verify the gen script writes a file**

Run:
```bash
node studio/packaging/scripts/gen-telemetry-config.mjs && cat studio/packaging/telemetry.config.json
```
Expected: prints `{}` (no `.env.production` yet) and logs `wrote … (0 keys)`. File is gitignored (Task 1).

- [ ] **Step 8: Bump version + CHANGELOG**

`package.json`: `"version": "0.29.0"` → `"0.30.0"`.
`studio/CHANGELOG.md`, under `## [Unreleased]`, add:
```markdown
## [0.30.0] — 2026-06-08

### Added
- **The app now reports crashes and basic usage (internal beta).** Studio sends crash reports plus a small set of usage events — app launches, frame generations and their outcomes, frames that fail to render, share attempts, and settings opens — so the team can see whether the beta is working and being used. No prompt text, file contents, or project names ever leave your machine; events are tagged with your DevRev email so we know who to follow up with. Telemetry only runs in the installed app, never in local dev.
```

- [ ] **Step 9: Full suite + final dev smoke test**

Run: `pnpm run studio:test`
Expected: PASS.
Run: `ARCADE_TELEMETRY_DEBUG=1 pnpm run studio:electron` and verify the full event sequence:
- `[telemetry:main] app_launched` (terminal)
- `[telemetry:renderer] settings_opened` (DevTools console) after opening Settings
- `[telemetry:server] prompt_submitted` then `frame_generated` (terminal) after a generation
- broken-icon prompt → `[telemetry:server] frame_runtime_error` (terminal)
- share modal open → `[telemetry:renderer] share_opened` (DevTools)
- quit → `[telemetry:main] app_shutdown` (terminal)

- [ ] **Step 10: Commit + push**

```bash
git add studio/packaging/scripts/gen-telemetry-config.mjs electron-builder.yml package.json studio/CHANGELOG.md studio/__tests__/packaging/gen-telemetry-config.test.ts
git commit -m "build(studio/observability): inject telemetry.config.json + bump 0.30.0"
git push -u origin feat/studio-observability
```

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** every catalog event maps to a task — lifecycle (15), generation (10, 11), frame-runtime-error (12), share (13), settings (14); Sentry across all three processes (7 server, 14 renderer, 15 main); identity (6, 9); packaged gate (4); debug-sink (4, 5); env injection (16); redaction/privacy (3).
- **Type consistency:** `track(event: TelemetryEvent)` re-exported identically from `server.ts`/`renderer.ts` via `core.ts`; `classifyGenerationError`/`classifyFrameError`/`classifyShareError` return the matching `*ErrorKind` union; `IdentitySnapshot.config` shape matches `resolveConfig` output consumed in `main.tsx`; `SendAdapter` identical across both shims.
- **Cuts vs the first draft:** dropped the redundant runtime parity test (compile-time `satisfies` covers it); merged duplicated server/renderer track logic into `core.ts`; folded config+debugSink and identity+email into single tasks. ~16 tasks, ~9 logical units before fan-out.
- **Vertical slice:** Task 10 proves the full pipe end-to-end (config → identity → core → debug sink → real callsite) in dev before any further wiring.

## Known follow-ups (not v1)

- Real Sentry/PostHog signups → fill `.env.production`; zero code change.
- Main-process events use `distinct_id="anonymous"` and `is_first_launch=false` — refine by reading the persisted `settings.json` id once the Vite child has written it.
- Optional consent toggle if external testers are added (currently internal-only, always-on).
