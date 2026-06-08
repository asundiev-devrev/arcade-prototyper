# Arcade Studio Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sentry (crash/error) + PostHog (usage events) into Arcade Studio's three Electron processes, routing through a console debug-sink until real DSN/keys are added.

**Architecture:** A shared telemetry module under `studio/src/lib/telemetry/` serves the renderer (`@sentry/browser` + `posthog-js`) and the Vite child server (`@sentry/node` + `posthog-node`). The Electron main process gets a self-contained `electron/telemetry.ts` (`@sentry/electron`) because `electron/tsconfig.json` can't import from `studio/`. All three read keys from one `telemetry.config.json` baked into the app bundle at pack time; the renderer (no node access) fetches identity from a server endpoint. Telemetry only sends when packaged + keys present; otherwise events print to a debug sink.

**Tech Stack:** TypeScript, Electron 33, Vite middleware, Vitest, `@sentry/electron`, `@sentry/node`, `@sentry/browser`, `posthog-node`, `posthog-js`.

**Spec:** `docs/superpowers/specs/2026-06-08-studio-observability-design.md`

---

## File Structure

**New — shared telemetry module (`studio/src/lib/telemetry/`):**
- `events.ts` — typed event-name → payload discriminated union; the single source of event shapes.
- `redact.ts` — pure scrubbers: `hashSlug()`, `truncate()`, `stripPaths()`, Sentry `beforeSend`.
- `config.ts` — resolves `{ sentryDsn, posthogKey, posthogHost, enabled, debug }` from injected config + env + packaged gate.
- `debugSink.ts` — prints structured events/errors to console when not sending.
- `identity.ts` — resolves `distinct_id` (DevRev email > anonymous UUID), persisted in `settings.json`.
- `server.ts` — server-side init (`@sentry/node` + `posthog-node`) + `track`/`captureError`/`shutdown`.
- `renderer.ts` — renderer init (`@sentry/browser` + `posthog-js`) + `track`/`captureError`.
- `index.ts` — re-exports the right surface; thin.
- `__mocks__/index.ts` — no-op stubs for vitest.

**New — main process & server endpoint:**
- `electron/telemetry.ts` — self-contained `@sentry/electron` init + `app_launched`/`app_shutdown` via `posthog-node`.
- `studio/server/middleware/telemetryIdentity.ts` — `GET /api/telemetry/identity`.
- `studio/packaging/scripts/gen-telemetry-config.mjs` — writes `telemetry.config.json` from `.env.production` at pack time.

**Modified:**
- `studio/server/middleware/chat.ts` — generation events.
- `studio/server/middleware/runtimeError.ts` — `frame_runtime_error`.
- `studio/server/middleware/cloudflare.ts` — share deploy outcome events.
- `studio/src/components/shell/ShareModal.tsx` — share UI click events.
- `studio/src/components/shell/AppSettingsModal.tsx` — `settings_opened`.
- `studio/src/main.tsx` — renderer init.
- `studio/vite.config.ts` — server init + identity middleware registration.
- `electron/main.ts` — main telemetry init + lifecycle.
- `electron/viteRunner.ts` — forward `resourcesPath`/`isPackaged` to the Vite child.
- `electron-builder.yml` — copy `telemetry.config.json` into Resources.
- `package.json` — add deps + run gen script in `studio:pack`/`studio:release`.
- `.gitignore` — ignore `.env.production` + generated `telemetry.config.json`.

---

## Task 1: Dependencies + gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install runtime deps**

Run from repo root:
```bash
pnpm add @sentry/electron @sentry/node @sentry/browser posthog-node posthog-js
```
Expected: all five added to `package.json` `dependencies`, lockfile updated.

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
  it("exposes every event name as a const tuple", () => {
    expect(EVENT_NAMES).toContain("app_launched");
    expect(EVENT_NAMES).toContain("frame_generated");
    expect(EVENT_NAMES).toContain("frame_runtime_error");
    expect(EVENT_NAMES).toContain("share_succeeded");
    expect(EVENT_NAMES).toContain("settings_opened");
  });

  it("types a payload to its event via discriminated union", () => {
    const e: TelemetryEvent = {
      name: "frame_generated",
      props: {
        project_slug_hash: "abc",
        duration_ms: 1200,
        model: "sonnet",
        tokens_input: 10,
        tokens_output: 20,
        turn_type: "build",
      },
    };
    expect(e.props.turn_type).toBe("build");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

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

export type GenerationErrorKind =
  | "bedrock_auth"
  | "cli_crash"
  | "parser_error"
  | "timeout"
  | "other";

export type FrameErrorKind =
  | "module_not_found"
  | "syntax_error"
  | "runtime_exception"
  | "hmr_failure";

export type ShareErrorKind =
  | "auth"
  | "worker_5xx"
  | "bundle_error"
  | "network"
  | "other";

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
  "app_launched",
  "app_shutdown",
  "prompt_submitted",
  "frame_generated",
  "generation_failed",
  "generation_cancelled",
  "frame_runtime_error",
  "share_opened",
  "share_started",
  "share_succeeded",
  "share_failed",
  "share_url_copied",
  "settings_opened",
] as const satisfies readonly TelemetryEventName[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/events.ts studio/__tests__/lib/telemetry/events.test.ts
git commit -m "feat(studio/observability): typed event catalog"
```

---

## Task 2b: Static call-site/catalog parity test

**Files:**
- Test: `studio/__tests__/lib/telemetry/events.test.ts` (extend)

- [ ] **Step 1: Add a failing test that asserts no event name appears at a call site without being in `EVENT_NAMES`**

Append to the existing test file:
```ts
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

describe("event name parity", () => {
  it("EVENT_NAMES has no duplicates and matches the union length", () => {
    const set = new Set(EVENT_NAMES);
    expect(set.size).toBe(EVENT_NAMES.length);
  });
});
```

- [ ] **Step 2: Run + verify PASS** (the union+const-tuple `satisfies` already enforces membership at compile time; this guards duplicates at runtime).

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/events.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/lib/telemetry/events.test.ts
git commit -m "test(studio/observability): event-name parity guard"
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
  it("hashSlug is stable + non-reversible (no raw slug present)", () => {
    const h = hashSlug("my-secret-project");
    expect(h).toBe(hashSlug("my-secret-project"));
    expect(h).not.toContain("secret");
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });

  it("truncate caps length and marks elision", () => {
    expect(truncate("x".repeat(300), 200)).toHaveLength(201); // 200 + ellipsis char
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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/redact.test.ts`
Expected: FAIL — cannot find module `redact`.

- [ ] **Step 3: Write `redact.ts`**

```ts
import { createHash } from "node:crypto";

/** sha1 of the input, first 12 hex chars. Stable across runs, non-reversible
 *  for our purposes. Used for project slugs + frame paths so we can correlate
 *  events for the same project without leaking its name. */
export function hashSlug(slug: string): string {
  return createHash("sha1").update(slug).digest("hex").slice(0, 12);
}

/** Truncate to `max` chars, appending a single ellipsis char when cut. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/** Remove absolute arcade-studio project paths from a message, leaving the
 *  human-readable error intact. */
export function stripPaths(s: string): string {
  return s
    .replace(/\/[^\s]*arcade-studio\/projects\/[^\s]*/g, "<frame-path>")
    .replace(/\/Users\/[^\s/]+/g, "<home>");
}

/** Sentry beforeSend: scrub auth headers + prompt-bearing extras. Returns the
 *  mutated event (Sentry expects the event or null to drop). */
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

> NOTE: `redact.ts` uses `node:crypto` and is imported by server + main only. The renderer never hashes slugs directly — server-emitted events already carry hashes, and renderer events (`share_*`, `settings_opened`) carry no slug. Keep `redact.ts` out of the renderer bundle (only `server.ts`/`electron/telemetry.ts` import it).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/redact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/redact.ts studio/__tests__/lib/telemetry/redact.test.ts
git commit -m "feat(studio/observability): redaction helpers"
```

---

## Task 4: Config resolver (`config.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/config.ts`
- Test: `studio/__tests__/lib/telemetry/config.test.ts`

- [ ] **Step 1: Write the failing test**

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
    const c = resolveConfig({ packaged: true, debugEnv: undefined, fileConfig: {} });
    expect(c.enabled).toBe(false);
  });

  it("debug env forces debug sink regardless of packaging", () => {
    const c = resolveConfig({ packaged: false, debugEnv: "1", fileConfig: {} });
    expect(c.debug).toBe(true);
    expect(c.enabled).toBe(false); // debug means console-sink, not real send
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/config.test.ts`
Expected: FAIL — cannot find module `config`.

- [ ] **Step 3: Write `config.ts`**

```ts
export interface TelemetryFileConfig {
  sentryDsn?: string;
  posthogKey?: string;
  posthogHost?: string;
}

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

export function resolveConfig(input: {
  packaged: boolean;
  debugEnv: string | undefined;
  fileConfig: TelemetryFileConfig;
}): ResolvedTelemetryConfig {
  const { packaged, debugEnv, fileConfig } = input;
  const hasKeys = Boolean(fileConfig.sentryDsn && fileConfig.posthogKey);
  const enabled = packaged && hasKeys;
  return {
    sentryDsn: fileConfig.sentryDsn,
    posthogKey: fileConfig.posthogKey,
    posthogHost: fileConfig.posthogHost ?? DEFAULT_HOST,
    enabled,
    debug: Boolean(debugEnv),
  };
}

/** Read telemetry.config.json from a resources directory. Returns {} on any
 *  failure — telemetry must never break boot. Node-only (server + main). */
export async function readFileConfig(resourcesPath: string | undefined): Promise<TelemetryFileConfig> {
  if (!resourcesPath) return {};
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.join(resourcesPath, "telemetry.config.json"), "utf-8");
    return JSON.parse(raw) as TelemetryFileConfig;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/config.ts studio/__tests__/lib/telemetry/config.test.ts
git commit -m "feat(studio/observability): config resolver + packaged gate"
```

---

## Task 5: Debug sink (`debugSink.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/debugSink.ts`
- Test: `studio/__tests__/lib/telemetry/debugSink.test.ts`

- [ ] **Step 1: Write the failing test**

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

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/debugSink.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `debugSink.ts`**

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

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/debugSink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/debugSink.ts studio/__tests__/lib/telemetry/debugSink.test.ts
git commit -m "feat(studio/observability): console debug sink"
```

---

## Task 6: Identity resolver (`identity.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/identity.ts`
- Test: `studio/__tests__/lib/telemetry/identity.test.ts`

Identity is server-side. It resolves a `distinct_id` and persists it into `settings.json` under `telemetry.distinctId` using the existing settings read/merge helpers. DevRev email is the preferred id; falls back to a generated UUID.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveDistinctId } from "../../../src/lib/telemetry/identity";

describe("resolveDistinctId", () => {
  it("returns persisted id when already set", async () => {
    const id = await resolveDistinctId({
      readSettings: async () => ({ telemetry: { distinctId: "alice@devrev.ai" } }),
      writeDistinctId: async () => {},
      resolveEmail: async () => null,
      genUuid: () => "uuid-x",
    });
    expect(id).toBe("alice@devrev.ai");
  });

  it("uses DevRev email when no persisted id", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}),
      writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => "bob@devrev.ai",
      genUuid: () => "uuid-x",
    });
    expect(id).toBe("bob@devrev.ai");
    expect(writes).toEqual(["bob@devrev.ai"]);
  });

  it("falls back to anonymous uuid when no email", async () => {
    const writes: string[] = [];
    const id = await resolveDistinctId({
      readSettings: async () => ({}),
      writeDistinctId: async (v) => { writes.push(v); },
      resolveEmail: async () => null,
      genUuid: () => "anon-uuid-1",
    });
    expect(id).toBe("anon-uuid-1");
    expect(writes).toEqual(["anon-uuid-1"]);
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/identity.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `identity.ts`**

```ts
/**
 * Resolves the telemetry distinct_id. Dependency-injected so it's pure-testable
 * (no real keychain/network in unit tests). The server wires the real adapters.
 *
 * Order: persisted settings.telemetry.distinctId → DevRev email → anon UUID.
 * Whatever is resolved (email or uuid) is persisted so renderer + server agree.
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

  const email = await deps.resolveEmail();
  const id = email ?? deps.genUuid();
  await deps.writeDistinctId(id);
  return id;
}
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/identity.ts studio/__tests__/lib/telemetry/identity.test.ts
git commit -m "feat(studio/observability): distinct_id resolver"
```

---

## Task 7: Extend DevRev resolver to return email

**Files:**
- Modify: `studio/server/relay/auth.ts`
- Test: `studio/__tests__/server/relay/auth-email.test.ts`

`resolveDevuFromPat` currently returns `{id, displayName}`. The `dev-users.self` response includes `email`. Add it to the returned shape (optional, backward compatible).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/relay/auth";

describe("resolveDevuFromPat email", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns email when present in dev-users.self", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ dev_user: { id: "devu/1", display_name: "Al", email: "al@devrev.ai" } }),
    })) as any);
    const id = await resolveDevuFromPat("pat");
    expect(id?.email).toBe("al@devrev.ai");
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/server/relay/auth-email.test.ts`
Expected: FAIL — `email` not on returned type / undefined.

- [ ] **Step 3: Modify `auth.ts`**

In `studio/server/relay/auth.ts`, extend the interface and parse:
```ts
export interface DevuIdentity {
  id: string;
  displayName: string;
  email?: string;
}
```
And in the parse block, change the data type + return:
```ts
    const data = (await res.json()) as {
      dev_user?: { id?: string; display_name?: string; email?: string };
    };
    if (data.dev_user?.id && data.dev_user?.display_name) {
      return {
        id: data.dev_user.id,
        displayName: data.dev_user.display_name,
        email: data.dev_user.email,
      };
    }
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/server/relay/auth-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/auth.ts studio/__tests__/server/relay/auth-email.test.ts
git commit -m "feat(studio/observability): resolveDevuFromPat returns email"
```

---

## Task 8: Server telemetry module (`server.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/server.ts`
- Test: `studio/__tests__/lib/telemetry/server.test.ts`

The server module holds module-scoped state (resolved config, distinct_id, PostHog client). `track()` and `captureError()` are no-ops until `initServerTelemetry()` runs. When config is disabled-but-debug or simply not-enabled, events go to the debug sink; when enabled, to PostHog/Sentry.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as server from "../../../src/lib/telemetry/server";

describe("server telemetry", () => {
  beforeEach(() => server.__resetForTest());

  it("track is a no-op before init", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    server.track({ name: "settings_opened", props: { tab: "x" } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("routes to debug sink when debug=true, enabled=false", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await server.initServerTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1",
      sessionId: "s1",
      version: "0.29.0",
      os: "darwin-arm64",
    });
    server.track({ name: "frame_generated", props: { project_slug_hash: "h", turn_type: "build" } });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry:server] frame_generated"),
      expect.objectContaining({ distinct_id: "u1", session_id: "s1", version: "0.29.0" }),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run + verify FAIL**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/server.test.ts`
Expected: FAIL — cannot find module / `__resetForTest` undefined.

- [ ] **Step 3: Write `server.ts`**

```ts
import type { TelemetryEvent } from "./events";
import type { ResolvedTelemetryConfig } from "./config";
import { debugTrack, debugError } from "./debugSink";
import { sentryBeforeSend } from "./redact";

interface InitArgs {
  config: Pick<ResolvedTelemetryConfig, "enabled" | "debug" | "posthogHost"> & { sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

let state: {
  config: InitArgs["config"];
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
  posthog: any | null;
} | null = null;

export async function initServerTelemetry(args: InitArgs): Promise<void> {
  let posthog: any | null = null;
  try {
    if (args.config.enabled && args.config.sentryDsn) {
      const Sentry = await import("@sentry/node");
      Sentry.init({
        dsn: args.config.sentryDsn,
        release: `arcade-studio@${args.version}`,
        beforeSend: (e: any) => sentryBeforeSend(e),
      });
      Sentry.setTag("process", "server");
    }
    if (args.config.enabled && args.config.posthogKey) {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(args.config.posthogKey, { host: args.config.posthogHost });
    }
  } catch (err) {
    console.warn("[telemetry] server init failed:", err instanceof Error ? err.message : err);
  }
  state = { config: args.config, distinctId: args.distinctId, sessionId: args.sessionId, version: args.version, os: args.os, posthog };
}

function superProps() {
  return { distinct_id: state!.distinctId, session_id: state!.sessionId, version: state!.version, os: state!.os, process: "server" as const };
}

export function track(event: TelemetryEvent): void {
  if (!state) return; // not initialized → no-op
  const props = { ...event.props, ...superProps() };
  if (state.config.enabled && state.posthog) {
    try {
      state.posthog.capture({ distinctId: state.distinctId, event: event.name, properties: props });
    } catch (err) {
      console.warn("[telemetry] capture failed:", err instanceof Error ? err.message : err);
    }
    return;
  }
  if (state.config.debug) debugTrack("server", event, state.distinctId);
}

export async function captureError(err: unknown): Promise<void> {
  if (!state) return;
  if (state.config.enabled && state.config.sentryDsn) {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.captureException(err);
    } catch {}
    return;
  }
  if (state.config.debug) debugError("server", err);
}

export async function shutdownServerTelemetry(): Promise<void> {
  try {
    await state?.posthog?.shutdown?.();
  } catch {}
}

/** Test-only: clears module state between tests. */
export function __resetForTest(): void {
  state = null;
}
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/server.ts studio/__tests__/lib/telemetry/server.test.ts
git commit -m "feat(studio/observability): server telemetry module"
```

---

## Task 9: Renderer telemetry module (`renderer.ts`)

**Files:**
- Create: `studio/src/lib/telemetry/renderer.ts`
- Test: `studio/__tests__/lib/telemetry/renderer.test.ts`

Mirror of `server.ts` for the browser: `@sentry/browser` + `posthog-js`. No `node:crypto` import. Config + distinct_id come from `/api/telemetry/identity` (fetched in `main.tsx`, passed to init).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as renderer from "../../../src/lib/telemetry/renderer";

describe("renderer telemetry", () => {
  beforeEach(() => renderer.__resetForTest());

  it("track no-op before init", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderer.track({ name: "share_url_copied", props: {} });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("debug sink when debug=true enabled=false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    renderer.initRendererTelemetry({
      config: { enabled: false, debug: true, posthogHost: "h" },
      distinctId: "u1",
      sessionId: "s1",
      version: "0.29.0",
      os: "darwin-arm64",
    });
    renderer.track({ name: "settings_opened", props: { tab: "general" } });
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
import type { TelemetryEvent } from "./events";
import { debugTrack, debugError } from "./debugSink";

interface InitArgs {
  config: { enabled: boolean; debug: boolean; posthogHost: string; sentryDsn?: string; posthogKey?: string };
  distinctId: string;
  sessionId: string;
  version: string;
  os: string;
}

let state: (InitArgs & { posthog: any | null }) | null = null;

export function initRendererTelemetry(args: InitArgs): void {
  let posthog: any | null = null;
  try {
    if (args.config.enabled && args.config.sentryDsn) {
      // dynamic import keeps Sentry out of the bundle when disabled
      void import("@sentry/browser").then((Sentry) => {
        Sentry.init({ dsn: args.config.sentryDsn!, release: `arcade-studio@${args.version}` });
        Sentry.setTag("process", "renderer");
      });
    }
    if (args.config.enabled && args.config.posthogKey) {
      void import("posthog-js").then(({ default: ph }) => {
        ph.init(args.config.posthogKey!, { api_host: args.config.posthogHost, autocapture: false, capture_pageview: false, disable_session_recording: true });
        ph.identify(args.distinctId);
        posthog = ph;
      });
    }
  } catch (err) {
    console.warn("[telemetry] renderer init failed:", err);
  }
  state = { ...args, posthog };
}

function superProps() {
  return { distinct_id: state!.distinctId, session_id: state!.sessionId, version: state!.version, os: state!.os, process: "renderer" as const };
}

export function track(event: TelemetryEvent): void {
  if (!state) return;
  const props = { ...event.props, ...superProps() };
  if (state.config.enabled && state.posthog) {
    try { state.posthog.capture(event.name, props); } catch {}
    return;
  }
  if (state.config.debug) debugTrack("renderer", event, state.distinctId);
}

export function captureError(err: unknown): void {
  if (!state) return;
  if (state.config.enabled && state.config.sentryDsn) {
    void import("@sentry/browser").then((Sentry) => Sentry.captureException(err)).catch(() => {});
    return;
  }
  if (state.config.debug) debugError("renderer", err);
}

export function __resetForTest(): void {
  state = null;
}
```

> Disable PostHog session recording explicitly (`disable_session_recording: true`) — spec decided replay OFF.

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/telemetry/renderer.ts studio/__tests__/lib/telemetry/renderer.test.ts
git commit -m "feat(studio/observability): renderer telemetry module"
```

---

## Task 10: Public index + test mocks

**Files:**
- Create: `studio/src/lib/telemetry/index.ts`
- Create: `studio/src/lib/telemetry/__mocks__/index.ts`

- [ ] **Step 1: Write `index.ts`**

`index.ts` is environment-aware via explicit named exports — call sites import from the specific module (`./server` or `./renderer`) to avoid bundling node code into the browser. `index.ts` re-exports only the shared, safe pieces:

```ts
export type { TelemetryEvent, TelemetryEventName, GenerationErrorKind, FrameErrorKind, ShareErrorKind } from "./events";
export { EVENT_NAMES } from "./events";
export { hashSlug, truncate, stripPaths } from "./redact";
```

> Server call sites import `{ track, captureError }` from `studio/src/lib/telemetry/server`. Renderer call sites import from `studio/src/lib/telemetry/renderer`. This keeps `@sentry/node`/`posthog-node` out of the browser bundle and `@sentry/browser` out of node.

- [ ] **Step 2: Write `__mocks__/index.ts`**

```ts
export const EVENT_NAMES = [] as const;
export const hashSlug = (s: string) => s;
export const truncate = (s: string) => s;
export const stripPaths = (s: string) => s;
```

- [ ] **Step 3: Run the full telemetry suite to confirm nothing broke**

Run: `pnpm run studio:test studio/__tests__/lib/telemetry/`
Expected: PASS (all telemetry tests).

- [ ] **Step 4: Commit**

```bash
git add studio/src/lib/telemetry/index.ts studio/src/lib/telemetry/__mocks__/index.ts
git commit -m "feat(studio/observability): public index + test mocks"
```

---

## Task 11: Identity endpoint middleware

**Files:**
- Create: `studio/server/middleware/telemetryIdentity.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/middleware/telemetry-identity.test.ts`

Endpoint `GET /api/telemetry/identity` returns `{ distinctId, sessionId, version, os, config: { enabled, debug, posthogHost, posthogKey, sentryDsn } }` so the renderer can init with the same identity + keys the server uses. Server resolves identity once at boot and caches it (see Task 14); this endpoint reads that cache.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { telemetryIdentityMiddleware, __setIdentitySnapshot } from "../../../server/middleware/telemetryIdentity";
import type { IncomingMessage, ServerResponse } from "node:http";

function mockRes() {
  const chunks: string[] = [];
  let status = 0;
  return {
    writeHead(s: number) { status = s; },
    end(b?: string) { if (b) chunks.push(b); },
    get status() { return status; },
    get body() { return chunks.join(""); },
  } as unknown as ServerResponse & { status: number; body: string };
}

describe("telemetry identity endpoint", () => {
  it("returns the cached identity snapshot", async () => {
    __setIdentitySnapshot({
      distinctId: "u1", sessionId: "s1", version: "0.29.0", os: "darwin-arm64",
      config: { enabled: false, debug: true, posthogHost: "h" },
    });
    const res = mockRes() as any;
    let nextCalled = false;
    await telemetryIdentityMiddleware()(
      { url: "/api/telemetry/identity", method: "GET" } as IncomingMessage,
      res,
      () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(false);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).distinctId).toBe("u1");
  });

  it("passes through unrelated urls", async () => {
    const res = mockRes() as any;
    let nextCalled = false;
    await telemetryIdentityMiddleware()(
      { url: "/api/other", method: "GET" } as IncomingMessage,
      res,
      () => { nextCalled = true; },
    );
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

/** Called once at server boot (vite.config) after identity is resolved. */
export function setIdentitySnapshot(s: IdentitySnapshot): void {
  snapshot = s;
}

/** Test seam. */
export function __setIdentitySnapshot(s: IdentitySnapshot): void {
  snapshot = s;
}

export function telemetryIdentityMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    if (req.url !== "/api/telemetry/identity" || req.method !== "GET") return next?.();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(snapshot ?? { distinctId: "", sessionId: "", version: "", os: "", config: { enabled: false, debug: false, posthogHost: "" } }));
  };
}
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/server/middleware/telemetry-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Register middleware in `vite.config.ts`**

Add import near the other middleware imports (after line 37):
```ts
import { telemetryIdentityMiddleware } from "./server/middleware/telemetryIdentity";
```
Add registration inside `configureServer`, right after `server.middlewares.use(versionMiddleware());`:
```ts
      server.middlewares.use(telemetryIdentityMiddleware());
```

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/telemetryIdentity.ts studio/vite.config.ts studio/__tests__/server/middleware/telemetry-identity.test.ts
git commit -m "feat(studio/observability): /api/telemetry/identity endpoint"
```

---

## Task 12: Server boot — init telemetry + resolve identity

**Files:**
- Modify: `studio/vite.config.ts`
- Modify: `studio/server/middleware/settings.ts` (add a `writeTelemetryDistinctId` helper)

This is the wiring task: at server boot, read the injected config, resolve distinct_id, init server telemetry, and publish the identity snapshot. Uses env vars forwarded by `viteRunner.ts` (Task 17): `ARCADE_RESOURCES_PATH`, `ARCADE_IS_PACKAGED`. `session_id` is generated here (a UUID per Vite-child launch). The server does NOT emit `app_launched` — the main process owns lifecycle (Task 16).

- [ ] **Step 1: Add a distinct_id writer to `settings.ts`**

In `studio/server/middleware/settings.ts`, after `readGlobalSettings`, add (uses existing `mergeSettings` + the file write pattern already in the file — find the existing `writeSettings`/save path and mirror it):
```ts
/** Persist the resolved telemetry distinct_id under settings.telemetry.distinctId. */
export async function writeTelemetryDistinctId(id: string): Promise<void> {
  const current = await readSettings();
  const next = mergeSettings(current as Record<string, unknown>, { telemetry: { distinctId: id } });
  const file = path.join(studioRoot(), SETTINGS_FILE);
  await fs.writeFile(file, JSON.stringify(next, null, 2));
}
```
> If `settings.ts` already has a private `writeSettings(next)`, call that instead of re-implementing the write.

- [ ] **Step 2: Add the boot block to `vite.config.ts`**

Add imports near the top with the other server imports:
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
Add this near the other boot calls (right before `void logVersionOnBoot();` at line ~134):
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

          const version = process.env.npm_package_version || "0.0.0";
          const os = `${process.platform}-${process.arch}`;
          const sessionId = randomUUID();

          await initServerTelemetry({ config, distinctId, sessionId, version, os });
          setIdentitySnapshot({ distinctId, sessionId, version, os, config });
          if (config.debug || config.enabled) {
            console.log(`[telemetry] server ready (enabled=${config.enabled} debug=${config.debug})`);
          }
        } catch (err) {
          console.warn("[telemetry] server boot block failed:", err instanceof Error ? err.message : err);
        }
      })();
```

> `version`: in the packaged app `main.ts` should forward the real version (Task 17 sets `ARCADE_APP_VERSION`); prefer that over `npm_package_version`. Use `process.env.ARCADE_APP_VERSION || process.env.npm_package_version || "0.0.0"`.

- [ ] **Step 3: Verify dev boot prints debug-ready when forced**

Run:
```bash
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio
```
Expected: console shows `[telemetry] server ready (enabled=false debug=true)` shortly after boot. Quit with Ctrl-C.

- [ ] **Step 4: Run the full suite (no regressions)**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts studio/server/middleware/settings.ts
git commit -m "feat(studio/observability): server boot resolves identity + inits telemetry"
```

---

## Task 13: Wire generation events (chat.ts)

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Test: `studio/__tests__/server/chat-telemetry.test.ts`

Three insert points in `chat.ts`:
1. `handleStart` (~line 142, after `const { slug, prompt, images } = body;` and after `project` is fetched) → `prompt_submitted`.
2. The `recordTurnMetric` callsite (~line 673) → `frame_generated` (ok) or `generation_failed` (not ok), with `error_kind` derived.
3. Add a small pure helper `classifyGenerationError()` (exported for unit test).

- [ ] **Step 1: Write the failing test for the classifier**

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
Expected: FAIL — `classifyGenerationError` not exported.

- [ ] **Step 3: Add the classifier + imports to `chat.ts`**

Add imports near the top of `chat.ts` (with the other server imports):
```ts
import { track } from "../../src/lib/telemetry/server";
import { hashSlug } from "../../src/lib/telemetry/redact";
import type { GenerationErrorKind } from "../../src/lib/telemetry/events";
```
Add the exported classifier near the top-level helpers (e.g. after the `recordTurnMetric` import block):
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

- [ ] **Step 4: Emit `prompt_submitted` in `handleStart`**

In `handleStart`, after `project` is confirmed (just before launching the turn — after the running-turn 409 guard), add:
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
> If `model` is resolvable here, include it; otherwise omit (it's optional in the payload). The deep turn function later resolves model from settings.

- [ ] **Step 5: Emit generation outcome at the `recordTurnMetric` callsite**

Right AFTER the `void recordTurnMetric({...});` block (line ~692), add:
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
        error_kind: classifyGenerationError({
          error: endResult.error,
          timedOut: false, // onCrash sets retries/didStall; timeout reflected via error text
          exitCode: null,
        }),
        model: lastMetrics?.model,
      },
    });
  }
```
> `generation_cancelled`: in `handleCancel`, emit `track({ name: "generation_cancelled", props: { project_slug_hash: hashSlug(slug) } })`. Confirm the cancel handler has `slug` in scope (it takes the slug match group).

- [ ] **Step 6: Run + verify classifier PASS + full suite**

Run: `pnpm run studio:test studio/__tests__/server/chat-telemetry.test.ts`
Expected: PASS.
Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/chat.ts studio/__tests__/server/chat-telemetry.test.ts
git commit -m "feat(studio/observability): generation events (prompt/generated/failed/cancelled)"
```

---

## Task 14: Wire frame_runtime_error (runtimeError.ts)

**Files:**
- Modify: `studio/server/middleware/runtimeError.ts`
- Test: `studio/__tests__/server/runtime-error-telemetry.test.ts`

Add a pure `classifyFrameError(message)` and emit `frame_runtime_error` inside the existing `/api/runtime-error` handler (alongside the existing auto-fix dispatch). Also forward to Sentry via `captureError`.

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
Add the classifier (top-level, exported):
```ts
export function classifyFrameError(message: string): FrameErrorKind {
  if (/does not provide an export|Failed to (resolve|fetch|load).*module|Cannot find module/i.test(message)) return "module_not_found";
  if (/SyntaxError|Unexpected token/i.test(message)) return "syntax_error";
  if (/\[hmr\]|hot update|hmr/i.test(message)) return "hmr_failure";
  return "runtime_exception";
}
```
Inside the handler, after the validation guard and before/after the `handleRuntimeError` dispatch, add:
```ts
    track({
      name: "frame_runtime_error",
      props: {
        project_slug_hash: hashSlug(slug),
        error_kind: classifyFrameError(message),
        error_message: truncate(stripPaths(message), 200),
        frame_hash: hashSlug(frame),
      },
    });
    void captureError(new Error(`frame_runtime_error: ${classifyFrameError(message)}`));
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

## Task 15: Wire share events (server + UI)

**Files:**
- Modify: `studio/server/middleware/cloudflare.ts`
- Modify: `studio/src/components/shell/ShareModal.tsx`
- Test: `studio/__tests__/server/cloudflare-telemetry.test.ts`

Server emits deploy outcome (`share_succeeded`/`share_failed`); renderer emits UI clicks (`share_opened`/`share_started`/`share_url_copied`).

- [ ] **Step 1: Write the failing test for share error classification**

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
import { hashSlug } from "../../src/lib/telemetry/redact";
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
Wrap the deploy with timing. Before `let deployment;` capture a start stamp:
```ts
        const shareStart = Date.now();
```
After the success `send(res, 200, {...})` (line 129), before `return`, change to emit then return:
```ts
        track({
          name: "share_succeeded",
          props: { duration_ms: Date.now() - shareStart, frame_count: projectJson.frames?.length ?? 0 },
        });
        return send(res, 200, { url: deployment.url, deployId: deployment.deployId });
```
In the `catch (err)` at line ~130, before the 500 send:
```ts
        track({
          name: "share_failed",
          props: { duration_ms: Date.now() - shareStart, error_kind: classifyShareError({ code: err?.code, status: 500 }) },
        });
```
And in the inner `invalid_key`/`missing_key` 401 branch (line ~111), before its `send(res, 401, ...)`:
```ts
          track({ name: "share_failed", props: { duration_ms: Date.now() - shareStart, error_kind: "auth" } });
```
> `Date.now()` is fine in app runtime code (the no-`Date.now` restriction is for Workflow scripts only, not app source).

- [ ] **Step 4: Modify `ShareModal.tsx`**

Add import:
```ts
import { track } from "../../lib/telemetry/renderer";
```
- On open: in the existing `useEffect(() => { ... }, [open])` (line ~56) that fetches the lift, add at the top of the effect body when `open` is true:
```ts
    if (open) track({ name: "share_opened", props: { frame_count: frameCount } });
```
> Use the prop/state that holds the frame count; if not present, pass the length of the frames array the modal already has (e.g. `frames?.length ?? 0`).
- On deploy click: in the handler that does `setPhase("deploying")` (line ~84), right before the fetch:
```ts
    track({ name: "share_started", props: { frame_count: frameCount, project_slug_hash: "" } });
```
> `project_slug_hash` is hashed server-side for the outcome events; the renderer doesn't import `node:crypto`. Send `""` here (the renderer event is a UI funnel signal; correlation uses distinct_id + session_id). Alternatively omit by widening the payload — keep `""` for simplicity.
- On copy: in the copy-URL click handler, add:
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

## Task 16: Wire settings_opened + renderer init (main.tsx, AppSettingsModal.tsx)

**Files:**
- Modify: `studio/src/main.tsx`
- Modify: `studio/src/components/shell/AppSettingsModal.tsx`

- [ ] **Step 1: Init renderer telemetry in `main.tsx`**

Replace the body of `main.tsx` with a version that fetches identity then inits before rendering:
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
      initRendererTelemetry({
        config: id.config,
        distinctId: id.distinctId,
        sessionId: id.sessionId,
        version: id.version,
        os: id.os,
      });
    }
  } catch {
    // telemetry must never block boot
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
```

- [ ] **Step 2: Emit `settings_opened` in `AppSettingsModal.tsx`**

Add import:
```ts
import { track } from "../../lib/telemetry/renderer";
```
In the existing `useEffect(() => { if (open) void fetchSettings(); }, [open, fetchSettings]);` (line ~119), add the track call:
```ts
  useEffect(() => {
    if (open) {
      void fetchSettings();
      track({ name: "settings_opened", props: { tab: "general" } });
    }
  }, [open, fetchSettings]);
```
> If the modal tracks an active tab in state, pass that instead of the `"general"` literal. Check for an `activeTab`/`tab` state var; use it if present.

- [ ] **Step 3: Smoke-test in dev**

Run:
```bash
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio
```
Then in the browser: open Settings, watch the terminal (server) — note: renderer debug events print to the **browser console**, not the terminal. Open DevTools console in the Studio window and confirm `[telemetry:renderer] settings_opened {...}` appears. Generate a frame and confirm `[telemetry:server] frame_generated {...}` in the terminal. Quit.

- [ ] **Step 4: Run full suite**

Run: `pnpm run studio:test`
Expected: PASS (AppSettingsModal tests still pass; mock for `@xorkavi/arcade-gen` unaffected — telemetry renderer import resolves to real module which no-ops without init).

> If AppSettingsModal component tests fail because `./lib/telemetry/renderer` triggers a dynamic import, add a vitest alias mock: in the test file, `vi.mock("../../src/lib/telemetry/renderer", () => ({ track: () => {} }))`.

- [ ] **Step 5: Commit**

```bash
git add studio/src/main.tsx studio/src/components/shell/AppSettingsModal.tsx
git commit -m "feat(studio/observability): renderer init + settings_opened event"
```

---

## Task 17: Main process telemetry + lifecycle (electron/)

**Files:**
- Create: `electron/telemetry.ts`
- Modify: `electron/main.ts`
- Modify: `electron/viteRunner.ts`

Self-contained because `electron/tsconfig.json` can't reach `studio/src`. Inits `@sentry/electron` in main, emits `app_launched`/`app_shutdown` via its own `posthog-node` client, and — critically — forwards `ARCADE_RESOURCES_PATH`, `ARCADE_IS_PACKAGED`, `ARCADE_APP_VERSION`, and (when set) `ARCADE_TELEMETRY_DEBUG` into the Vite child env.

- [ ] **Step 1: Write `electron/telemetry.ts`**

```ts
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface FileConfig { sentryDsn?: string; posthogKey?: string; posthogHost?: string }

function readConfig(): FileConfig {
  try {
    const p = path.join(process.resourcesPath, "telemetry.config.json");
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
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
    } catch (err) {
      console.error("[telemetry] main sentry init failed:", err);
    }
  }
  if (enabled && cfg.posthogKey) {
    try {
      const { PostHog } = await import("posthog-node");
      posthog = new PostHog(cfg.posthogKey, { host: cfg.posthogHost ?? DEFAULT_HOST });
    } catch (err) {
      console.error("[telemetry] main posthog init failed:", err);
    }
  }
}

function emit(event: string, props: Record<string, unknown>): void {
  const full = { ...props, distinct_id: distinctId, process: "main", version: app.getVersion() };
  if (enabled && posthog) {
    try { posthog.capture({ distinctId, event, properties: full }); } catch {}
  } else if (debug) {
    console.log(`[telemetry:main] ${event}`, full);
  }
}

export function setMainDistinctId(id: string): void {
  if (id) distinctId = id;
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

> The main process doesn't resolve the DevRev email itself (no keychain access mirror). It starts `distinctId="anonymous"`; the Vite child resolves the real id and persists it. For v1, main-process events use `anonymous` unless we later read the persisted `settings.json` id. Acceptable: lifecycle events still count launches/sessions; the bulk of value events come from the server with the correct id. (Optional enhancement noted in "Future".)

- [ ] **Step 2: Wire into `electron/main.ts`**

Add import at top:
```ts
import { initMainTelemetry, emitAppLaunched, emitAppShutdown } from "./telemetry.js";
```
In `app.whenReady().then(...)` (line ~192), make it async and init first:
```ts
app.whenReady().then(async () => {
  await initMainTelemetry();
  emitAppLaunched(false); // is_first_launch refinement optional for v1
  void createWindow();
  initUpdater();
});
```
In the `before-quit` handler (line ~204), flush telemetry before exit:
```ts
app.on("before-quit", async (event) => {
  event.preventDefault();
  await emitAppShutdown();
  await stopVite();
  app.exit(0);
});
```

- [ ] **Step 3: Forward env to the Vite child in `viteRunner.ts`**

In `startVite`, the `spawn(... { env: {...} })` block (line ~26), add the telemetry env vars:
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
And in `electron/main.ts`, set the packaged flag + version into the process env BEFORE `createWindow` (e.g. near `patchPath()` call, line ~51):
```ts
process.env.ARCADE_IS_PACKAGED = app.isPackaged ? "1" : "0";
process.env.ARCADE_APP_VERSION = app.getVersion();
```

- [ ] **Step 4: Compile electron + smoke-test packaged-path locally (dev)**

Run:
```bash
pnpm exec tsc -p electron/tsconfig.json
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio:electron
```
Expected: terminal shows `[telemetry:main] app_launched {...}` on launch; on quit shows `[telemetry:main] app_shutdown {...}`. (Server events route through the Vite child as before.)

- [ ] **Step 5: Commit**

```bash
git add electron/telemetry.ts electron/main.ts electron/viteRunner.ts
git commit -m "feat(studio/observability): main-process sentry + app lifecycle events"
```

---

## Task 18: Build-time config injection

**Files:**
- Create: `studio/packaging/scripts/gen-telemetry-config.mjs`
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Test: `studio/__tests__/packaging/gen-telemetry-config.test.ts`

The pack step reads `.env.production` (or env vars) and writes `studio/packaging/telemetry.config.json`; electron-builder copies it into `<Resources>/telemetry.config.json`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildConfigObject } from "../../packaging/scripts/gen-telemetry-config.mjs";

describe("buildConfigObject", () => {
  it("maps env names to config keys", () => {
    const c = buildConfigObject({
      SENTRY_DSN_STUDIO: "https://x@sentry.io/1",
      POSTHOG_KEY_STUDIO: "phc_abc",
      POSTHOG_HOST: "https://eu.i.posthog.com",
    });
    expect(c).toEqual({ sentryDsn: "https://x@sentry.io/1", posthogKey: "phc_abc", posthogHost: "https://eu.i.posthog.com" });
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

/** Pure: map raw env (.env.production parsed) to the telemetry.config.json shape.
 *  Only emits keys that are present, so a missing key → silent telemetry. */
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

// Run as a script (not under import in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", "..");
  const envPath = join(repoRoot, ".env.production");
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, "utf-8")) : {};
  const env = { ...fileEnv, ...process.env }; // real env overrides file
  const config = buildConfigObject(env);
  const outPath = join(here, "..", "telemetry.config.json");
  writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`[gen-telemetry-config] wrote ${outPath} (${Object.keys(config).length} keys)`);
}
```

- [ ] **Step 4: Run + verify PASS**

Run: `pnpm run studio:test studio/__tests__/packaging/gen-telemetry-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Add to `electron-builder.yml` extraResources**

In the `extraResources:` list, add:
```yaml
  - from: "studio/packaging/telemetry.config.json"
    to: "telemetry.config.json"
```
> If the file may be absent at build time, generate an empty `{}` first (Step 6 runs the gen script which always writes the file). With the gen script wired into the pack command, the file always exists.

- [ ] **Step 6: Run the gen script before electron-builder in `package.json`**

Update the `studio:pack` and `studio:release` scripts to run the gen step first. Current:
```
"studio:pack": "pnpm run kit:build && bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && pnpm exec electron-builder --mac --config electron-builder.yml --publish never",
```
Insert `node studio/packaging/scripts/gen-telemetry-config.mjs &&` right before `pnpm exec electron-builder`:
```
"studio:pack": "pnpm run kit:build && bash studio/packaging/scripts/fetch-cli-deps.sh && pnpm exec tsc -p electron/tsconfig.json && node studio/packaging/scripts/gen-telemetry-config.mjs && pnpm exec electron-builder --mac --config electron-builder.yml --publish never",
```
Do the same for `studio:release`.

- [ ] **Step 7: Verify the gen script writes a file**

Run:
```bash
node studio/packaging/scripts/gen-telemetry-config.mjs && cat studio/packaging/telemetry.config.json
```
Expected: prints `{}` (no `.env.production` yet) and logs `wrote … (0 keys)`. File is gitignored (Task 1).

- [ ] **Step 8: Commit**

```bash
git add studio/packaging/scripts/gen-telemetry-config.mjs electron-builder.yml package.json studio/__tests__/packaging/gen-telemetry-config.test.ts
git commit -m "build(studio/observability): inject telemetry.config.json at pack time"
```

---

## Task 19: CHANGELOG + version bump

**Files:**
- Modify: `studio/CHANGELOG.md`
- Modify: `package.json` (version)

- [ ] **Step 1: Bump version**

In `package.json`, bump `"version": "0.29.0"` → `"0.30.0"` (meaningful batch).

- [ ] **Step 2: Add CHANGELOG entry**

At the top under `## [Unreleased]`, add:
```markdown
## [0.30.0] — 2026-06-08

### Added
- **The app now reports crashes and basic usage (internal beta).** Studio now sends crash reports and a small set of usage events — app launches, frame generations and their outcomes, frames that fail to render, share attempts, and settings opens — so the team can see whether the beta is working and being used. No prompt text, file contents, or project names ever leave your machine; events are tagged with your DevRev email so we know who to follow up with. Telemetry only runs in the installed app, never in local dev.
```

- [ ] **Step 3: Run full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/CHANGELOG.md package.json
git commit -m "chore(studio): bump 0.30.0 + changelog for observability"
```

---

## Task 20: Final verification

- [ ] **Step 1: Full test suite green**

Run: `pnpm run studio:test`
Expected: PASS (all telemetry tests + no regressions).

- [ ] **Step 2: Dev smoke test (debug sink)**

Run:
```bash
ARCADE_TELEMETRY_DEBUG=1 pnpm run studio:electron
```
Verify in order:
- Terminal: `[telemetry:main] app_launched`
- Browser DevTools console: `[telemetry:renderer] settings_opened` after opening Settings
- Terminal: `[telemetry:server] prompt_submitted` then `frame_generated` after generating a frame
- Trigger a broken frame (prompt for a nonexistent icon) → terminal `[telemetry:server] frame_runtime_error`
- Open share modal → DevTools `[telemetry:renderer] share_opened`
- Quit → terminal `[telemetry:main] app_shutdown`

- [ ] **Step 3: Confirm disabled path is truly silent**

Run (no debug flag, dev):
```bash
pnpm run studio
```
Expected: NO `[telemetry:*]` lines anywhere. Generate a frame to confirm silence.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/studio-observability
```

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** every event in the catalog (lifecycle, generation, frame-runtime-error, share, settings) maps to Tasks 13–17; Sentry init across all three processes maps to Tasks 8/9/17; identity to Tasks 6/7/12; packaged gate to Task 4; debug-sink to Task 5; env injection to Task 18; privacy/redaction to Task 3.
- **Type consistency:** `track(event: TelemetryEvent)` signature identical in `server.ts`/`renderer.ts`; `classifyGenerationError`/`classifyFrameError`/`classifyShareError` return the matching `*ErrorKind` union from `events.ts`; `IdentitySnapshot.config` shape matches `resolveConfig` output consumed in `main.tsx`.
- **Known follow-ups (not v1):** main-process events use `distinct_id="anonymous"` (server has the resolved id); `is_first_launch` always false. Both acceptable for v1, flagged inline in Task 17.

## Future (post-v1)

- Real Sentry/PostHog signups → fill `.env.production`; zero code change.
- Main process reads persisted `settings.json` distinct_id so lifecycle events attribute to the right user.
- Add `share_*` to Sentry breadcrumbs; add `whats_new_viewed` if desired later.
- Optional consent toggle if any external testers are added (currently internal-only, always-on).
