# Studio Multiplayer — Relay Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the in-process WebSocket relay — session registry, driver-lock arbitration, command/event protocol, auth via DevRev PAT, and JSON persistence — with no UI and no tunneling. Plan 1 of 5 for Studio multiplayer.

**Architecture:** A new `studio/server/relay/` module is mounted as Vite middleware. It speaks WebSockets on `/api/multiplayer/ws` and HTTP on `/api/multiplayer/sessions`. Session metadata persists to a JSON file at `{studioRoot}/multiplayer/sessions.json`. Live state (connections, driver, event ring buffer, cursor map) is in-memory. Auth resolves by POSTing to `https://api.devrev.ai/dev-users.self` with the client-provided PAT. Tested via programmatic WebSocket clients from inside Node — no UI work in this plan.

**Tech Stack:** Node.js 20+, TypeScript 5.9, `ws` (new dep) for WebSockets, Zod for wire-message validation, Vitest for tests. No SQLite, no external services.

**Spec reference:** [docs/superpowers/specs/2026-05-08-studio-multiplayer-design.md](../specs/2026-05-08-studio-multiplayer-design.md) — Section 3 (Relay protocol & data model) is the source of truth for wire shapes.

---

## File Structure

After this plan, these files will exist:

**New files (relay module):**
- `studio/server/relay/types.ts` — Zod schemas + TypeScript types for commands, events, session state. Pure types, no runtime behavior.
- `studio/server/relay/auth.ts` — `resolveDevuFromPat(pat)` calling `dev-users.self`; returns `{ id, displayName } | null`.
- `studio/server/relay/persistence.ts` — Read/write session metadata to a JSON file. Atomic write (write-temp-rename).
- `studio/server/relay/sessionRegistry.ts` — In-memory live state + persistence bridge. Mirrors `turnRegistry.ts` shape. Single source of truth for "does session X exist, who's driving, who's connected."
- `studio/server/relay/protocol.ts` — Pure command → event logic (validate command, mutate session state, produce fan-out events). No I/O. This is the testable heart of the relay.
- `studio/server/relay/wsServer.ts` — WebSocket glue. Owns `ws.Server`, parses messages, hands them to `protocol.ts`, fans events out to connections. Thin layer.
- `studio/server/middleware/multiplayer.ts` — HTTP middleware for `/api/multiplayer/sessions*` (create, invite, list).

**New test files:**
- `studio/__tests__/server/relay/auth.test.ts`
- `studio/__tests__/server/relay/persistence.test.ts`
- `studio/__tests__/server/relay/sessionRegistry.test.ts`
- `studio/__tests__/server/relay/protocol.test.ts`
- `studio/__tests__/server/relay/wsServer.integration.test.ts` — spins up a real `ws` server on an ephemeral port and drives it with real WebSocket clients.
- `studio/__tests__/server/middleware/multiplayer.test.ts`

**Modified:**
- `package.json` — add `ws` dep + `@types/ws` devDep.
- `studio/vite.config.ts` — register `multiplayerMiddleware()` + attach WebSocket server to the Vite dev server's HTTP server in `configureServer`.
- `studio/server/paths.ts` — add `multiplayerRoot()` and `sessionsJsonPath()` helpers.

**Why this split:**
- `protocol.ts` is pure logic, unit-testable without sockets — the correctness-critical piece (especially driver-lock serialization and concurrent-turn rejection from the spec).
- `wsServer.ts` handles only transport concerns (framing, heartbeat, disconnect detection).
- `sessionRegistry.ts` is the in-memory state and mirrors the established `turnRegistry.ts` pattern reviewers already know.
- `persistence.ts` is isolated so if we later swap JSON for SQLite it's a single-file change.

---

## Task 1: Install `ws` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run from the repo root:

```bash
pnpm add ws
pnpm add -D @types/ws
```

Expected `package.json` additions:
```json
  "dependencies": {
    ...
    "ws": "^8.18.0"
  },
  "devDependencies": {
    ...
    "@types/ws": "^8.5.14"
  }
```

- [ ] **Step 2: Verify it installs cleanly**

Run: `pnpm install`

Expected: no errors. `node_modules/ws` and `node_modules/@types/ws` exist.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(studio/multiplayer): add ws dependency for relay"
```

---

## Task 2: Path helpers for multiplayer storage

**Files:**
- Modify: `studio/server/paths.ts`
- Test: `studio/__tests__/server/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `studio/__tests__/server/paths.test.ts`:

```ts
import { multiplayerRoot, sessionsJsonPath } from "../../server/paths";

describe("multiplayer paths", () => {
  it("multiplayerRoot sits inside studioRoot", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-test";
    expect(multiplayerRoot()).toBe("/tmp/studio-test/multiplayer");
    delete process.env.ARCADE_STUDIO_ROOT;
  });

  it("sessionsJsonPath lives under multiplayerRoot", () => {
    process.env.ARCADE_STUDIO_ROOT = "/tmp/studio-test";
    expect(sessionsJsonPath()).toBe("/tmp/studio-test/multiplayer/sessions.json");
    delete process.env.ARCADE_STUDIO_ROOT;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: FAIL with "multiplayerRoot is not defined" or similar.

- [ ] **Step 3: Add the helpers**

Append to `studio/server/paths.ts` (after `stagingSessionDir`):

```ts
/**
 * Root folder for Studio multiplayer session state. Sibling of `projects/`.
 * Holds `sessions.json` (persisted session metadata) plus any future
 * per-session artifacts.
 */
export function multiplayerRoot(): string {
  return path.join(studioRoot(), "multiplayer");
}

/**
 * Single JSON file holding all known multiplayer session metadata. Read at
 * startup, rewritten atomically on every change. SQLite is overkill for the
 * expected session count in v1.
 */
export function sessionsJsonPath(): string {
  return path.join(multiplayerRoot(), "sessions.json");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/paths.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/paths.ts studio/__tests__/server/paths.test.ts
git commit -m "feat(studio/multiplayer): add path helpers for session storage"
```

---

## Task 3: Zod schemas for commands + events

**Files:**
- Create: `studio/server/relay/types.ts`
- Test: `studio/__tests__/server/relay/types.test.ts`

- [ ] **Step 1: Create the test directory and write failing tests**

```bash
mkdir -p studio/__tests__/server/relay
```

Create `studio/__tests__/server/relay/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clientCommandSchema,
  relayEventSchema,
  sessionStateSchema,
} from "../../../server/relay/types";

describe("relay wire types", () => {
  it("parses a valid prompt command", () => {
    const cmd = clientCommandSchema.parse({
      type: "prompt",
      text: "make it blue",
      turnId: "abc-123",
    });
    expect(cmd.type).toBe("prompt");
  });

  it("rejects a prompt command missing turnId", () => {
    expect(() =>
      clientCommandSchema.parse({ type: "prompt", text: "hi" }),
    ).toThrow();
  });

  it("parses a cursor command with optional frameId", () => {
    const cmd = clientCommandSchema.parse({
      type: "cursor",
      x: 100,
      y: 200,
    });
    expect(cmd.type).toBe("cursor");
    const cmd2 = clientCommandSchema.parse({
      type: "cursor",
      x: 0,
      y: 0,
      frameId: "01-home",
    });
    expect(cmd2.type).toBe("cursor");
  });

  it("parses a session_state event", () => {
    const ev = relayEventSchema.parse({
      type: "session_state",
      driverDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      connections: [{ devu: "don:identity:dvrv-us-1:devo/0:devu/1", displayName: "A" }],
      sessionObject: "relay-session-abc",
    });
    expect(ev.type).toBe("session_state");
  });

  it("rejects an unknown command type", () => {
    expect(() =>
      clientCommandSchema.parse({ type: "hack_the_relay" }),
    ).toThrow();
  });

  it("sessionStateSchema captures the persisted session shape", () => {
    const state = sessionStateSchema.parse({
      id: "abc",
      sessionObject: "relay-abc",
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "my-project",
      linkedWorkId: null,
      createdAt: new Date().toISOString(),
      endedAt: null,
      invites: [
        { devu: "don:identity:dvrv-us-1:devo/0:devu/2", invitedByDevu: "don:identity:dvrv-us-1:devo/0:devu/1", invitedAt: new Date().toISOString() },
      ],
    });
    expect(state.id).toBe("abc");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `studio/server/relay/types.ts`**

```ts
import { z } from "zod";

/**
 * Wire types for the multiplayer relay.
 *
 * Two categories:
 *   - clientCommand: client → relay. What a Studio instance can request.
 *   - relayEvent: relay → client. What any session participant observes.
 *
 * All messages are validated at the WebSocket boundary with Zod. Invalid
 * messages produce an `error` event but never crash the relay.
 *
 * See docs/superpowers/specs/2026-05-08-studio-multiplayer-design.md §3.
 */

// ── Commands (client → relay) ─────────────────────────────────────────

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), sessionId: z.string().min(1) }),
  z.object({ type: z.literal("request_control") }),
  z.object({ type: z.literal("grant_control"), targetDevu: z.string().min(1) }),
  z.object({ type: z.literal("release_control") }),
  z.object({ type: z.literal("claim_control") }),
  z.object({
    type: z.literal("prompt"),
    text: z.string().min(1),
    turnId: z.string().min(1),
  }),
  z.object({
    type: z.literal("frame_write"),
    path: z.string().min(1),
    content: z.string(),
    turnId: z.string().min(1),
  }),
  z.object({ type: z.literal("frame_delete"), path: z.string().min(1) }),
  z.object({ type: z.literal("cancel_turn"), turnId: z.string().min(1) }),
  z.object({
    type: z.literal("cursor"),
    x: z.number(),
    y: z.number(),
    frameId: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent_event"),
    turnId: z.string().min(1),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("turn_ended"),
    turnId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

// ── Events (relay → client) ───────────────────────────────────────────

export const connectionInfoSchema = z.object({
  devu: z.string(),
  displayName: z.string(),
});
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>;

export const relayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_state"),
    driverDevu: z.string().nullable(),
    connections: z.array(connectionInfoSchema),
    sessionObject: z.string(),
  }),
  z.object({
    type: z.literal("user_joined"),
    devu: z.string(),
    displayName: z.string(),
  }),
  z.object({ type: z.literal("user_left"), devu: z.string() }),
  z.object({
    type: z.literal("control_requested"),
    byDevu: z.string(),
    expiresAt: z.number(),
  }),
  z.object({
    type: z.literal("control_changed"),
    driverDevu: z.string().nullable(),
    reason: z.enum(["granted", "claimed", "released"]),
  }),
  z.object({
    type: z.literal("prompt_started"),
    turnId: z.string(),
    byDevu: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("agent_event"),
    turnId: z.string(),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("frame_written"),
    path: z.string(),
    content: z.string(),
    turnId: z.string(),
  }),
  z.object({ type: z.literal("frame_deleted"), path: z.string() }),
  z.object({
    type: z.literal("turn_ended"),
    turnId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("cursors"),
    cursors: z.record(
      z.string(),
      z.object({
        x: z.number(),
        y: z.number(),
        frameId: z.string().optional(),
        ts: z.number(),
      }),
    ),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type RelayEvent = z.infer<typeof relayEventSchema>;

// ── Persisted session state ───────────────────────────────────────────

export const sessionInviteSchema = z.object({
  devu: z.string().min(1),
  invitedByDevu: z.string().min(1),
  invitedAt: z.string(),
});
export type SessionInvite = z.infer<typeof sessionInviteSchema>;

export const sessionStateSchema = z.object({
  id: z.string().min(1),
  sessionObject: z.string().min(1),
  hostDevu: z.string().min(1),
  projectSlug: z.string().min(1),
  linkedWorkId: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  invites: z.array(sessionInviteSchema),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export const sessionsFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(sessionStateSchema),
});
export type SessionsFile = z.infer<typeof sessionsFileSchema>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm run studio:test __tests__/server/relay/types.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/types.ts studio/__tests__/server/relay/types.test.ts
git commit -m "feat(studio/multiplayer): wire types for relay commands, events, session state"
```

---

## Task 4: DevRev PAT → devu resolution

**Files:**
- Create: `studio/server/relay/auth.ts`
- Test: `studio/__tests__/server/relay/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveDevuFromPat } from "../../../server/relay/auth";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());
afterEach(() => mockFetch.mockReset());

describe("resolveDevuFromPat", () => {
  it("returns devu info for a valid PAT", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        dev_user: {
          id: "don:identity:dvrv-us-1:devo/0:devu/6654",
          display_name: "Andrey",
        },
      }),
    });
    const result = await resolveDevuFromPat("valid-pat");
    expect(result).toEqual({
      id: "don:identity:dvrv-us-1:devo/0:devu/6654",
      displayName: "Andrey",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/dev-users.self",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "valid-pat" }),
      }),
    );
  });

  it("returns null when the API rejects the PAT", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const result = await resolveDevuFromPat("bad-pat");
    expect(result).toBeNull();
  });

  it("returns null when dev_user is missing from the response", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await resolveDevuFromPat("weird-pat");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const result = await resolveDevuFromPat("any");
    expect(result).toBeNull();
  });

  it("returns null for an empty PAT without hitting the network", async () => {
    const result = await resolveDevuFromPat("");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `auth.ts`**

Create `studio/server/relay/auth.ts`:

```ts
/**
 * Resolve a DevRev PAT to a devu identity by calling `dev-users.self`.
 *
 * Used at WebSocket connect time (relay/wsServer.ts) and at session-create
 * time (middleware/multiplayer.ts). Returns null for any failure path —
 * callers distinguish "not authenticated" from "other error" based on
 * context, not this function's return value.
 */

export interface DevuIdentity {
  id: string;           // e.g. "don:identity:dvrv-us-1:devo/0:devu/6654"
  displayName: string;  // e.g. "Andrey Sundiev"
}

export async function resolveDevuFromPat(pat: string): Promise<DevuIdentity | null> {
  if (!pat) return null;
  try {
    const res = await fetch("https://api.devrev.ai/dev-users.self", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pat },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      dev_user?: { id?: string; display_name?: string };
    };
    if (data.dev_user?.id && data.dev_user?.display_name) {
      return { id: data.dev_user.id, displayName: data.dev_user.display_name };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/auth.test.ts`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/auth.ts studio/__tests__/server/relay/auth.test.ts
git commit -m "feat(studio/multiplayer): resolve DevRev PAT to devu identity"
```

---

## Task 5: JSON persistence for session metadata

**Files:**
- Create: `studio/server/relay/persistence.ts`
- Test: `studio/__tests__/server/relay/persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadSessions,
  saveSessions,
} from "../../../server/relay/persistence";
import type { SessionState } from "../../../server/relay/types";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-studio-relay-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeSession(id: string): SessionState {
  return {
    id,
    sessionObject: `relay-${id}`,
    hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
    projectSlug: "demo",
    linkedWorkId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    invites: [],
  };
}

describe("relay persistence", () => {
  it("loadSessions returns an empty array when the file does not exist", async () => {
    const sessions = await loadSessions();
    expect(sessions).toEqual([]);
  });

  it("saveSessions creates the multiplayer dir and writes the file", async () => {
    await saveSessions([makeSession("abc")]);
    const file = path.join(tmp, "multiplayer", "sessions.json");
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.sessions).toHaveLength(1);
    expect(raw.sessions[0].id).toBe("abc");
  });

  it("round-trips sessions via save + load", async () => {
    const before = [makeSession("a"), makeSession("b")];
    await saveSessions(before);
    const after = await loadSessions();
    expect(after).toEqual(before);
  });

  it("ignores a corrupted file and returns empty instead of throwing", async () => {
    const file = path.join(tmp, "multiplayer", "sessions.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{{{not valid json");
    const result = await loadSessions();
    expect(result).toEqual([]);
  });

  it("rejects a file with a future version it doesn't understand", async () => {
    const file = path.join(tmp, "multiplayer", "sessions.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, sessions: [] }));
    const result = await loadSessions();
    expect(result).toEqual([]);
  });

  it("writes atomically (tmp file is removed on success)", async () => {
    await saveSessions([makeSession("x")]);
    const dir = path.join(tmp, "multiplayer");
    const tmpFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/persistence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `persistence.ts`**

Create `studio/server/relay/persistence.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { multiplayerRoot, sessionsJsonPath } from "../paths";
import { sessionsFileSchema, type SessionState } from "./types";

/**
 * Load all persisted sessions. Returns [] for any failure mode (missing file,
 * unparseable JSON, unknown schema version). The relay treats persistence as
 * best-effort hydration — a corrupted file does not crash the session.
 */
export async function loadSessions(): Promise<SessionState[]> {
  try {
    const raw = await fs.readFile(sessionsJsonPath(), "utf-8");
    const parsed = JSON.parse(raw);
    const result = sessionsFileSchema.safeParse(parsed);
    if (!result.success) return [];
    return result.data.sessions;
  } catch {
    return [];
  }
}

/**
 * Persist all sessions. Writes to a sibling `.tmp` file then renames into
 * place so a crashed write cannot leave a partial file on disk.
 */
export async function saveSessions(sessions: SessionState[]): Promise<void> {
  const file = sessionsJsonPath();
  const tmpFile = `${file}.tmp`;
  await fs.mkdir(multiplayerRoot(), { recursive: true });
  const body = JSON.stringify({ version: 1, sessions }, null, 2);
  await fs.writeFile(tmpFile, body, "utf-8");
  await fs.rename(tmpFile, file);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/persistence.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/persistence.ts studio/__tests__/server/relay/persistence.test.ts
git commit -m "feat(studio/multiplayer): atomic JSON persistence for session metadata"
```

---

## Task 6: Session registry — in-memory state + persistence bridge

This module owns both the durable metadata and the ephemeral live state. It mirrors the established `turnRegistry.ts` shape.

**Files:**
- Create: `studio/server/relay/sessionRegistry.ts`
- Test: `studio/__tests__/server/relay/sessionRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/sessionRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSession,
  getSession,
  listSessions,
  endSession,
  addInvite,
  __resetSessionRegistryForTests,
  hydrateSessionRegistry,
} from "../../../server/relay/sessionRegistry";

let tmp: string;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-relay-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("sessionRegistry", () => {
  it("creates a session with a unique session_object and returns the state", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    expect(s.id).toBeTruthy();
    expect(s.sessionObject).toMatch(/^relay-session-/);
    expect(s.hostDevu).toBe("don:identity:dvrv-us-1:devo/0:devu/1");
    expect(s.endedAt).toBeNull();
    expect(s.invites).toEqual([]);
  });

  it("persists the session so it survives a registry reset", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    __resetSessionRegistryForTests();
    await hydrateSessionRegistry();
    expect(getSession(s.id)?.id).toBe(s.id);
  });

  it("listSessions excludes ended sessions by default", async () => {
    const a = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "a",
    });
    const b = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "b",
    });
    await endSession(a.id);
    const active = listSessions();
    expect(active.map((s) => s.id)).toEqual([b.id]);
  });

  it("addInvite appends to the invite list and persists", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    await addInvite(s.id, {
      devu: "don:identity:dvrv-us-1:devo/0:devu/2",
      invitedByDevu: s.hostDevu,
    });
    expect(getSession(s.id)?.invites).toHaveLength(1);
  });

  it("addInvite is idempotent for the same devu", async () => {
    const s = await createSession({
      hostDevu: "don:identity:dvrv-us-1:devo/0:devu/1",
      projectSlug: "demo",
    });
    await addInvite(s.id, { devu: "x", invitedByDevu: s.hostDevu });
    await addInvite(s.id, { devu: "x", invitedByDevu: s.hostDevu });
    expect(getSession(s.id)?.invites).toHaveLength(1);
  });

  it("endSession is a no-op for an unknown id", async () => {
    await expect(endSession("nonexistent")).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/sessionRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sessionRegistry.ts`**

Create `studio/server/relay/sessionRegistry.ts`:

```ts
import { randomUUID } from "node:crypto";
import { loadSessions, saveSessions } from "./persistence";
import type { SessionInvite, SessionState } from "./types";

/**
 * Session registry — in-memory index over persisted session metadata.
 *
 * Responsibilities:
 *   - Create / end sessions; maintain invite lists.
 *   - Re-hydrate from disk on boot.
 *   - Provide O(1) lookup by id for the WebSocket layer.
 *
 * This file does NOT hold live WebSocket connections or the event ring
 * buffer. That lives on the WsServer (see relay/wsServer.ts). Splitting is
 * intentional: persistence concerns stay isolated from transport concerns.
 */

const sessions = new Map<string, SessionState>();

export interface CreateSessionInput {
  hostDevu: string;
  projectSlug: string;
  linkedWorkId?: string | null;
}

export async function createSession(input: CreateSessionInput): Promise<SessionState> {
  const id = randomUUID();
  const session: SessionState = {
    id,
    sessionObject: `relay-session-${id}`,
    hostDevu: input.hostDevu,
    projectSlug: input.projectSlug,
    linkedWorkId: input.linkedWorkId ?? null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    invites: [],
  };
  sessions.set(id, session);
  await flush();
  return session;
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function listSessions(opts?: { includeEnded?: boolean }): SessionState[] {
  const out: SessionState[] = [];
  for (const s of sessions.values()) {
    if (!opts?.includeEnded && s.endedAt) continue;
    out.push(s);
  }
  return out;
}

export async function endSession(id: string): Promise<void> {
  const existing = sessions.get(id);
  if (!existing || existing.endedAt) return;
  existing.endedAt = new Date().toISOString();
  await flush();
}

export async function addInvite(
  sessionId: string,
  invite: Omit<SessionInvite, "invitedAt">,
): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Session ${sessionId} not found`);
  if (s.invites.some((i) => i.devu === invite.devu)) return;
  s.invites.push({ ...invite, invitedAt: new Date().toISOString() });
  await flush();
}

/**
 * Read persisted sessions into memory. Call once at Vite boot before the
 * WebSocket server starts accepting connections.
 */
export async function hydrateSessionRegistry(): Promise<void> {
  const persisted = await loadSessions();
  sessions.clear();
  for (const s of persisted) sessions.set(s.id, s);
}

async function flush(): Promise<void> {
  await saveSessions(Array.from(sessions.values()));
}

/** Test-only: wipe in-memory state. Does NOT delete the on-disk file. */
export function __resetSessionRegistryForTests(): void {
  sessions.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/sessionRegistry.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/sessionRegistry.ts studio/__tests__/server/relay/sessionRegistry.test.ts
git commit -m "feat(studio/multiplayer): session registry with persistence"
```

---

## Task 7: Protocol layer — driver-lock & command validation (pure, no I/O)

This is the correctness-critical heart of the relay. It takes (current live-state, command, connection identity) → (new live-state, events to fan out). Pure function. Zero I/O.

**Files:**
- Create: `studio/server/relay/protocol.ts`
- Test: `studio/__tests__/server/relay/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/protocol.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createLiveState,
  applyCommand,
  applyDisconnect,
} from "../../../server/relay/protocol";
import type { LiveState } from "../../../server/relay/protocol";

const HOST = "don:identity:dvrv-us-1:devo/0:devu/1";
const GUEST = "don:identity:dvrv-us-1:devo/0:devu/2";
const STRANGER = "don:identity:dvrv-us-1:devo/0:devu/99";

function withHostConnected(): LiveState {
  const s = createLiveState({
    sessionId: "sess-1",
    sessionObject: "relay-session-1",
    hostDevu: HOST,
    inviteList: [HOST, GUEST],
  });
  return applyCommand(s, {
    type: "join",
    sessionId: "sess-1",
    connDevu: HOST,
    connDisplayName: "Host",
    connId: "c1",
  }).nextState;
}

describe("protocol.applyCommand", () => {
  it("grants driver role to the host on first join", () => {
    const s = withHostConnected();
    expect(s.driverDevu).toBe(HOST);
    expect(s.connections.size).toBe(1);
  });

  it("allows an invited guest to join and emits user_joined", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    });
    expect(nextState.connections.size).toBe(2);
    expect(events.find((e) => e.type === "user_joined")).toBeTruthy();
    expect(nextState.driverDevu).toBe(HOST); // unchanged by guest join
  });

  it("rejects a join from a non-invited devu with error event targeted at that connection", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "join",
      sessionId: "sess-1",
      connDevu: STRANGER,
      connDisplayName: "Stranger",
      connId: "c3",
    });
    expect(nextState.connections.size).toBe(1); // stranger not added
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv).toBeTruthy();
    expect(errEv?.recipient).toBe("c3");
  });

  it("rejects a prompt from a non-driver", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "prompt",
      connDevu: GUEST,
      connId: "c2",
      text: "hi",
      turnId: "t-1",
    });
    expect(nextState.currentTurn).toBeNull();
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv).toBeTruthy();
    expect(errEv?.event.type === "error" && errEv.event.code).toBe("not_driver");
  });

  it("accepts a prompt from the driver, emits prompt_started to all connections", () => {
    const s0 = withHostConnected();
    const { nextState, events } = applyCommand(s0, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "build a login",
      turnId: "t-1",
    });
    expect(nextState.currentTurn?.turnId).toBe("t-1");
    const started = events.find((e) => e.event.type === "prompt_started");
    expect(started).toBeTruthy();
    expect(started?.recipient).toBe("broadcast");
  });

  it("rejects a prompt with code turn_in_flight when a turn is already running", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;
    const { events } = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "b",
      turnId: "t-2",
    });
    const errEv = events.find((e) => e.event.type === "error");
    expect(errEv?.event.type === "error" && errEv.event.code).toBe("turn_in_flight");
  });

  it("request_control emits a control_requested event that expires in 30s", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const now = Date.now();
    const { events } = applyCommand(s, {
      type: "request_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now });
    const req = events.find((e) => e.event.type === "control_requested");
    expect(req).toBeTruthy();
    if (req?.event.type === "control_requested") {
      expect(req.event.expiresAt).toBeGreaterThan(now + 29_000);
      expect(req.event.expiresAt).toBeLessThan(now + 31_000);
    }
  });

  it("grant_control by the driver transfers the lock", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "grant_control",
      connDevu: HOST,
      connId: "c1",
      targetDevu: GUEST,
    });
    expect(nextState.driverDevu).toBe(GUEST);
    const changed = events.find((e) => e.event.type === "control_changed");
    expect(changed?.event.type === "control_changed" && changed.event.reason).toBe("granted");
  });

  it("grant_control by non-driver is rejected", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyCommand(s, {
      type: "grant_control",
      connDevu: GUEST,
      connId: "c2",
      targetDevu: GUEST,
    });
    expect(nextState.driverDevu).toBe(HOST);
    expect(events.find((e) => e.event.type === "error")).toBeTruthy();
  });

  it("claim_control only succeeds when the driver has been offline > 60s", () => {
    // Host joins, then disconnects.
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    s = applyDisconnect(s, "c1").nextState; // host drops

    // Too soon — claim should be rejected.
    const too_soon = applyCommand(s, {
      type: "claim_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now: s.driverDisconnectedAt! + 10_000 });
    expect(too_soon.nextState.driverDevu).toBe(HOST);
    expect(too_soon.events.find((e) => e.event.type === "error")).toBeTruthy();

    // After 60s — claim succeeds.
    const ok = applyCommand(s, {
      type: "claim_control",
      connDevu: GUEST,
      connId: "c2",
    }, { now: s.driverDisconnectedAt! + 61_000 });
    expect(ok.nextState.driverDevu).toBe(GUEST);
    const changed = ok.events.find((e) => e.event.type === "control_changed");
    expect(changed?.event.type === "control_changed" && changed.event.reason).toBe("claimed");
  });

  it("release_control by the driver clears driverDevu", () => {
    const s0 = withHostConnected();
    const { nextState } = applyCommand(s0, {
      type: "release_control",
      connDevu: HOST,
      connId: "c1",
    });
    expect(nextState.driverDevu).toBeNull();
  });

  it("agent_event from driver fans out to broadcast; from non-driver is rejected", () => {
    let s = withHostConnected();
    // Start a turn first.
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;

    const ok = applyCommand(s, {
      type: "agent_event",
      connDevu: HOST,
      connId: "c1",
      turnId: "t-1",
      event: { kind: "narration", text: "working" },
    });
    const fan = ok.events.find((e) => e.event.type === "agent_event");
    expect(fan?.recipient).toBe("broadcast");

    // Add guest, then guest tries to forge an agent_event.
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const bad = applyCommand(s, {
      type: "agent_event",
      connDevu: GUEST,
      connId: "c2",
      turnId: "t-1",
      event: { kind: "narration", text: "evil" },
    });
    expect(bad.events.find((e) => e.event.type === "error")).toBeTruthy();
  });

  it("cursor events from any participant broadcast a snapshot containing all cursors", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const a = applyCommand(s, {
      type: "cursor",
      connDevu: HOST,
      connId: "c1",
      x: 10,
      y: 20,
    });
    const snap = a.events.find((e) => e.event.type === "cursors");
    expect(snap?.event.type === "cursors" && Object.keys(snap.event.cursors)).toContain(HOST);
  });

  it("turn_ended from driver clears currentTurn", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "prompt",
      connDevu: HOST,
      connId: "c1",
      text: "a",
      turnId: "t-1",
    }).nextState;
    const { nextState } = applyCommand(s, {
      type: "turn_ended",
      connDevu: HOST,
      connId: "c1",
      turnId: "t-1",
      ok: true,
    });
    expect(nextState.currentTurn).toBeNull();
  });
});

describe("protocol.applyDisconnect", () => {
  it("removes the connection and emits user_left", () => {
    let s = withHostConnected();
    s = applyCommand(s, {
      type: "join",
      sessionId: "sess-1",
      connDevu: GUEST,
      connDisplayName: "Guest",
      connId: "c2",
    }).nextState;
    const { nextState, events } = applyDisconnect(s, "c2");
    expect(nextState.connections.size).toBe(1);
    const left = events.find((e) => e.event.type === "user_left");
    expect(left).toBeTruthy();
  });

  it("records driverDisconnectedAt when the driver leaves", () => {
    const s0 = withHostConnected();
    const { nextState } = applyDisconnect(s0, "c1");
    expect(nextState.driverDisconnectedAt).toBeGreaterThan(0);
    // driver devu stays set so a returning host can reclaim without "claim".
    expect(nextState.driverDevu).toBe(HOST);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `protocol.ts`**

Create `studio/server/relay/protocol.ts`:

```ts
import type { RelayEvent } from "./types";

/**
 * Pure protocol engine. Zero I/O. Zero WebSocket. Zero time-sources except
 * the `now` option on applyCommand (enables deterministic tests).
 *
 * The WebSocket layer (relay/wsServer.ts) is responsible for:
 *   - receiving raw frames
 *   - Zod-validating them into ClientCommands
 *   - calling applyCommand(liveState, commandWithConnContext)
 *   - writing the returned events onto the appropriate connections
 *   - applying the returned nextState back to its own mutable reference
 *
 * Keeping this pure is what makes the correctness-critical bits (driver-lock,
 * turn serialization) trivially testable.
 */

const CONTROL_REQUEST_TTL_MS = 30_000;
const DORMANT_TAKEOVER_MS = 60_000;

export interface ConnectionRef {
  connId: string;
  devu: string;
  displayName: string;
}

export interface CursorEntry {
  x: number;
  y: number;
  frameId?: string;
  ts: number;
}

export interface LiveState {
  sessionId: string;
  sessionObject: string;
  hostDevu: string;
  inviteList: string[];            // devu ids allowed to join
  connections: Map<string, ConnectionRef>;   // connId → ref
  driverDevu: string | null;
  /** When the current driver dropped connection, or null if connected. */
  driverDisconnectedAt: number | null;
  currentTurn: { turnId: string; byDevu: string; startedAt: number } | null;
  cursors: Map<string, CursorEntry>; // devu → latest cursor
  controlRequest: { byDevu: string; expiresAt: number } | null;
}

export interface CreateLiveStateInput {
  sessionId: string;
  sessionObject: string;
  hostDevu: string;
  inviteList: string[];
}

export function createLiveState(input: CreateLiveStateInput): LiveState {
  return {
    sessionId: input.sessionId,
    sessionObject: input.sessionObject,
    hostDevu: input.hostDevu,
    inviteList: input.inviteList,
    connections: new Map(),
    driverDevu: null,
    driverDisconnectedAt: null,
    currentTurn: null,
    cursors: new Map(),
    controlRequest: null,
  };
}

/**
 * Command envelope used by applyCommand. Adds connection context to the raw
 * ClientCommand. The WebSocket layer builds this by looking up the socket's
 * authenticated identity.
 */
export type InboundCommand =
  | { type: "join"; sessionId: string; connDevu: string; connDisplayName: string; connId: string }
  | { type: "request_control"; connDevu: string; connId: string }
  | { type: "grant_control"; connDevu: string; connId: string; targetDevu: string }
  | { type: "release_control"; connDevu: string; connId: string }
  | { type: "claim_control"; connDevu: string; connId: string }
  | { type: "prompt"; connDevu: string; connId: string; text: string; turnId: string }
  | { type: "frame_write"; connDevu: string; connId: string; path: string; content: string; turnId: string }
  | { type: "frame_delete"; connDevu: string; connId: string; path: string }
  | { type: "cancel_turn"; connDevu: string; connId: string; turnId: string }
  | { type: "cursor"; connDevu: string; connId: string; x: number; y: number; frameId?: string }
  | { type: "agent_event"; connDevu: string; connId: string; turnId: string; event: unknown }
  | { type: "turn_ended"; connDevu: string; connId: string; turnId: string; ok: boolean; error?: string };

export type EventRecipient = "broadcast" | string; // connId, or "broadcast"

export interface EmittedEvent {
  recipient: EventRecipient;
  event: RelayEvent;
}

export interface ApplyResult {
  nextState: LiveState;
  events: EmittedEvent[];
}

export interface ApplyOptions {
  now?: number;
}

/**
 * Apply a command to live state. Returns the new state plus any events to
 * emit. Mutates nothing in place — returns a new LiveState.
 *
 * Events with recipient="broadcast" go to every connection in the session.
 * Events with recipient=<connId> go to that connection only (e.g. errors).
 */
export function applyCommand(
  state: LiveState,
  cmd: InboundCommand,
  opts: ApplyOptions = {},
): ApplyResult {
  const now = opts.now ?? Date.now();
  const s = cloneState(state);
  const events: EmittedEvent[] = [];

  switch (cmd.type) {
    case "join": {
      const allowed = s.inviteList.includes(cmd.connDevu);
      if (!allowed) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "You are not invited to this session." },
        });
        return { nextState: s, events };
      }
      s.connections.set(cmd.connId, {
        connId: cmd.connId,
        devu: cmd.connDevu,
        displayName: cmd.connDisplayName,
      });
      // Host's first join claims the driver lock.
      if (!s.driverDevu && cmd.connDevu === s.hostDevu) {
        s.driverDevu = s.hostDevu;
      }
      // If this is the current driver returning after a disconnect, clear the timestamp.
      if (s.driverDevu === cmd.connDevu) {
        s.driverDisconnectedAt = null;
      }
      events.push({
        recipient: "broadcast",
        event: { type: "user_joined", devu: cmd.connDevu, displayName: cmd.connDisplayName },
      });
      events.push({
        recipient: "broadcast",
        event: {
          type: "session_state",
          driverDevu: s.driverDevu,
          connections: Array.from(s.connections.values()).map((c) => ({
            devu: c.devu,
            displayName: c.displayName,
          })),
          sessionObject: s.sessionObject,
        },
      });
      return { nextState: s, events };
    }

    case "request_control": {
      if (s.driverDevu === cmd.connDevu) {
        // Already driving — no-op.
        return { nextState: s, events };
      }
      s.controlRequest = {
        byDevu: cmd.connDevu,
        expiresAt: now + CONTROL_REQUEST_TTL_MS,
      };
      events.push({
        recipient: "broadcast",
        event: {
          type: "control_requested",
          byDevu: cmd.connDevu,
          expiresAt: s.controlRequest.expiresAt,
        },
      });
      return { nextState: s, events };
    }

    case "grant_control": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can grant control." },
        });
        return { nextState: s, events };
      }
      if (!s.inviteList.includes(cmd.targetDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "Target is not in the invite list." },
        });
        return { nextState: s, events };
      }
      s.driverDevu = cmd.targetDevu;
      s.driverDisconnectedAt = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: cmd.targetDevu, reason: "granted" },
      });
      return { nextState: s, events };
    }

    case "release_control": {
      if (s.driverDevu !== cmd.connDevu) {
        return { nextState: s, events };
      }
      s.driverDevu = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: null, reason: "released" },
      });
      return { nextState: s, events };
    }

    case "claim_control": {
      if (!s.inviteList.includes(cmd.connDevu)) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_invited", message: "You are not invited." },
        });
        return { nextState: s, events };
      }
      const driverOffline =
        s.driverDevu !== null &&
        s.driverDisconnectedAt !== null &&
        now - s.driverDisconnectedAt >= DORMANT_TAKEOVER_MS;
      if (!driverOffline) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "driver_present", message: "Driver is still connected. Use request_control." },
        });
        return { nextState: s, events };
      }
      s.driverDevu = cmd.connDevu;
      s.driverDisconnectedAt = null;
      s.controlRequest = null;
      events.push({
        recipient: "broadcast",
        event: { type: "control_changed", driverDevu: cmd.connDevu, reason: "claimed" },
      });
      return { nextState: s, events };
    }

    case "prompt": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can prompt." },
        });
        return { nextState: s, events };
      }
      if (s.currentTurn) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "turn_in_flight", message: "A turn is already running." },
        });
        return { nextState: s, events };
      }
      s.currentTurn = { turnId: cmd.turnId, byDevu: cmd.connDevu, startedAt: now };
      events.push({
        recipient: "broadcast",
        event: {
          type: "prompt_started",
          turnId: cmd.turnId,
          byDevu: cmd.connDevu,
          text: cmd.text,
        },
      });
      return { nextState: s, events };
    }

    case "agent_event":
    case "frame_write":
    case "frame_delete":
    case "cancel_turn":
    case "turn_ended": {
      if (s.driverDevu !== cmd.connDevu) {
        events.push({
          recipient: cmd.connId,
          event: { type: "error", code: "not_driver", message: "Only the driver can send this event." },
        });
        return { nextState: s, events };
      }
      if (cmd.type === "turn_ended") {
        s.currentTurn = null;
        events.push({
          recipient: "broadcast",
          event: { type: "turn_ended", turnId: cmd.turnId, ok: cmd.ok, error: cmd.error },
        });
      } else if (cmd.type === "agent_event") {
        events.push({
          recipient: "broadcast",
          event: { type: "agent_event", turnId: cmd.turnId, event: cmd.event },
        });
      } else if (cmd.type === "frame_write") {
        events.push({
          recipient: "broadcast",
          event: {
            type: "frame_written",
            path: cmd.path,
            content: cmd.content,
            turnId: cmd.turnId,
          },
        });
      } else if (cmd.type === "frame_delete") {
        events.push({
          recipient: "broadcast",
          event: { type: "frame_deleted", path: cmd.path },
        });
      } else if (cmd.type === "cancel_turn") {
        if (s.currentTurn?.turnId === cmd.turnId) s.currentTurn = null;
        events.push({
          recipient: "broadcast",
          event: { type: "turn_ended", turnId: cmd.turnId, ok: false, error: "cancelled" },
        });
      }
      return { nextState: s, events };
    }

    case "cursor": {
      if (!s.connections.has(cmd.connId)) {
        return { nextState: s, events };
      }
      s.cursors.set(cmd.connDevu, {
        x: cmd.x,
        y: cmd.y,
        frameId: cmd.frameId,
        ts: now,
      });
      // Emit a snapshot. The wsServer may coalesce these further.
      events.push({
        recipient: "broadcast",
        event: {
          type: "cursors",
          cursors: Object.fromEntries(s.cursors),
        },
      });
      return { nextState: s, events };
    }
  }
}

/**
 * Apply a WebSocket disconnect. Removes the connection from the live state
 * and, if the disconnecting user was the driver, records the time so a
 * dormant takeover can be granted after the grace period.
 */
export function applyDisconnect(state: LiveState, connId: string): ApplyResult {
  const s = cloneState(state);
  const conn = s.connections.get(connId);
  if (!conn) return { nextState: s, events: [] };
  s.connections.delete(connId);
  const events: EmittedEvent[] = [
    { recipient: "broadcast", event: { type: "user_left", devu: conn.devu } },
  ];
  const stillConnected = Array.from(s.connections.values()).some(
    (c) => c.devu === conn.devu,
  );
  if (!stillConnected && s.driverDevu === conn.devu) {
    s.driverDisconnectedAt = Date.now();
  }
  return { nextState: s, events };
}

function cloneState(s: LiveState): LiveState {
  return {
    ...s,
    inviteList: s.inviteList.slice(),
    connections: new Map(s.connections),
    currentTurn: s.currentTurn ? { ...s.currentTurn } : null,
    cursors: new Map(s.cursors),
    controlRequest: s.controlRequest ? { ...s.controlRequest } : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/protocol.test.ts`
Expected: all tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/protocol.ts studio/__tests__/server/relay/protocol.test.ts
git commit -m "feat(studio/multiplayer): pure protocol engine for driver lock + command validation"
```

---

## Task 8: WebSocket server — attach to Vite, parse frames, apply protocol

**Files:**
- Create: `studio/server/relay/wsServer.ts`
- Test: `studio/__tests__/server/relay/wsServer.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `studio/__tests__/server/relay/wsServer.integration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachRelayToHttpServer,
  __resetWsServerForTests,
} from "../../../server/relay/wsServer";
import {
  createSession,
  addInvite,
  __resetSessionRegistryForTests,
} from "../../../server/relay/sessionRegistry";

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "pat-a") return { id: "devu/A", displayName: "Alice" };
    if (pat === "pat-b") return { id: "devu/B", displayName: "Bob" };
    return null;
  },
}));

let tmp: string;
let server: http.Server;
let port: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-relay-ws-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
  __resetWsServerForTests();
  server = http.createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function connect(pat: string, sessionId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?sessionId=${sessionId}`,
      { headers: { Authorization: pat } },
    );
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function receiveUntil(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

describe("wsServer integration", () => {
  it("authenticates the PAT and allows an invited user to join + receive session_state", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

    const ws = await connect("pat-a", s.id);
    const state = await receiveUntil(ws, (m) => m.type === "session_state");
    expect(state.driverDevu).toBe("devu/A");
    ws.close();
  });

  it("rejects a connection with an invalid PAT at the WebSocket handshake", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?sessionId=${s.id}`,
      { headers: { Authorization: "bogus" } },
    );
    // A rejected upgrade never transitions to "open", so we observe it via the
    // "unexpected-response" event — ws exposes the HTTP status it got back.
    const status = await new Promise<number>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => reject(new Error("should not have opened")));
      ws.on("error", () => {}); // swallow — unexpected-response is the real signal
      setTimeout(() => reject(new Error("timed out")), 2000);
    });
    expect(status).toBe(401);
  });

  it("fans a prompt_started event from the driver out to all connected participants", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    alice.send(
      JSON.stringify({ type: "prompt", text: "hello", turnId: "t-1" }),
    );

    const aliceSaw = await receiveUntil(alice, (m) => m.type === "prompt_started");
    const bobSaw = await receiveUntil(bob, (m) => m.type === "prompt_started");
    expect(aliceSaw.text).toBe("hello");
    expect(bobSaw.byDevu).toBe("devu/A");

    alice.close();
    bob.close();
  });

  it("rejects a prompt from a non-driver with an error event", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    bob.send(JSON.stringify({ type: "prompt", text: "hi", turnId: "t-2" }));
    const err = await receiveUntil(bob, (m) => m.type === "error");
    expect(err.code).toBe("not_driver");

    alice.close();
    bob.close();
  });

  it("emits user_left when a connection drops", async () => {
    const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
    await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
    await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

    const alice = await connect("pat-a", s.id);
    await receiveUntil(alice, (m) => m.type === "session_state");
    const bob = await connect("pat-b", s.id);
    await receiveUntil(bob, (m) => m.type === "session_state");

    bob.close();
    const left = await receiveUntil(alice, (m) => m.type === "user_left");
    expect(left.devu).toBe("devu/B");

    alice.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/wsServer.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wsServer.ts`**

Create `studio/server/relay/wsServer.ts`:

```ts
import type http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { resolveDevuFromPat } from "./auth";
import { getSession } from "./sessionRegistry";
import {
  applyCommand,
  applyDisconnect,
  createLiveState,
  type ConnectionRef,
  type InboundCommand,
  type LiveState,
} from "./protocol";
import { clientCommandSchema, type RelayEvent } from "./types";

/**
 * WebSocket layer for the multiplayer relay.
 *
 * Responsibilities:
 *   - HTTP upgrade handshake under /api/multiplayer/ws
 *   - Authenticate the PAT on upgrade (reject with close code 4401 on failure)
 *   - Per-session live state (driver lock, connections, cursor snapshots)
 *   - Route validated commands through relay/protocol.ts
 *   - Fan events out with broadcast or per-connId addressing
 *   - Heartbeat + disconnect detection
 */

interface LiveSession {
  state: LiveState;
  sockets: Map<string, WebSocket>; // connId → socket
}

const liveSessions = new Map<string, LiveSession>(); // sessionId → LiveSession

const HEARTBEAT_MS = 15_000;
const PING_TIMEOUT_MS = 40_000;

/**
 * Attach the relay WebSocket handler to an HTTP server. Called from
 * vite.config.ts during `configureServer`.
 */
export function attachRelayToHttpServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      if (!req.url?.startsWith("/api/multiplayer/ws")) return;
      const url = new URL(req.url, "http://localhost");
      const sessionId = url.searchParams.get("sessionId");
      const pat = req.headers.authorization ?? "";

      if (!sessionId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const session = getSession(sessionId);
      if (!session || session.endedAt) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      const identity = await resolveDevuFromPat(pat);
      if (!identity) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        onConnection(ws, sessionId, identity.id, identity.displayName);
      });
    } catch (err) {
      console.error("[relay] upgrade failed:", err);
      try { socket.destroy(); } catch {}
    }
  });
}

function getOrCreateLiveSession(sessionId: string): LiveSession | null {
  const existing = liveSessions.get(sessionId);
  if (existing) return existing;
  const persisted = getSession(sessionId);
  if (!persisted || persisted.endedAt) return null;
  const state = createLiveState({
    sessionId: persisted.id,
    sessionObject: persisted.sessionObject,
    hostDevu: persisted.hostDevu,
    inviteList: persisted.invites.map((i) => i.devu).concat(persisted.hostDevu),
  });
  const live: LiveSession = { state, sockets: new Map() };
  liveSessions.set(sessionId, live);
  return live;
}

function onConnection(
  ws: WebSocket,
  sessionId: string,
  devu: string,
  displayName: string,
): void {
  const live = getOrCreateLiveSession(sessionId);
  if (!live) {
    sendEvent(ws, {
      type: "error",
      code: "session_gone",
      message: "Session no longer exists.",
    });
    ws.close(4404, "session_gone");
    return;
  }

  const connId = randomUUID();
  live.sockets.set(connId, ws);

  // Feed an implicit "join" command through the protocol so driver lock +
  // fan-out happen consistently with every other command type.
  dispatch(live, {
    type: "join",
    sessionId,
    connDevu: devu,
    connDisplayName: displayName,
    connId,
  });

  let alive = true;
  const heartbeat = setInterval(() => {
    if (!alive) {
      try { ws.terminate(); } catch {}
      return;
    }
    alive = false;
    try { ws.ping(); } catch {}
  }, HEARTBEAT_MS);
  const pingTimeout = setTimeout(() => {
    try { ws.terminate(); } catch {}
  }, PING_TIMEOUT_MS);
  ws.on("pong", () => {
    alive = true;
    pingTimeout.refresh();
  });

  ws.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      sendEvent(ws, { type: "error", code: "bad_json", message: "Invalid JSON frame." });
      return;
    }
    const result = clientCommandSchema.safeParse(parsed);
    if (!result.success) {
      sendEvent(ws, {
        type: "error",
        code: "bad_command",
        message: result.error.errors[0]?.message ?? "Invalid command shape.",
      });
      return;
    }
    const cmd = result.data;
    // "join" commands over a live socket are ignored — the upgrade handshake
    // already joined us.
    if (cmd.type === "join") return;

    // Narrow each validated cmd to an InboundCommand with connection context.
    // TypeScript can't infer this from a discriminated union of Zod outputs
    // without a little manual dispatch.
    const inbound = attachConnContext(cmd, devu, connId);
    dispatch(live, inbound);
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(pingTimeout);
    live.sockets.delete(connId);
    const { nextState, events } = applyDisconnect(live.state, connId);
    live.state = nextState;
    emitAll(live, events);
  });

  ws.on("error", (err) => {
    console.warn("[relay] ws error:", err);
  });
}

function attachConnContext(
  cmd: ReturnType<typeof clientCommandSchema.parse>,
  connDevu: string,
  connId: string,
): InboundCommand {
  // Re-narrow a validated ClientCommand (which does NOT carry connDevu/connId)
  // into an InboundCommand by injecting the connection-scoped fields.
  switch (cmd.type) {
    case "join":
      // Unreachable — filtered before this call.
      return { type: "join", sessionId: cmd.sessionId, connDevu, connDisplayName: "", connId };
    case "request_control":
    case "release_control":
    case "claim_control":
      return { ...cmd, connDevu, connId };
    case "grant_control":
      return { ...cmd, connDevu, connId };
    case "prompt":
      return { ...cmd, connDevu, connId };
    case "frame_write":
      return { ...cmd, connDevu, connId };
    case "frame_delete":
      return { ...cmd, connDevu, connId };
    case "cancel_turn":
      return { ...cmd, connDevu, connId };
    case "cursor":
      return { ...cmd, connDevu, connId };
    case "agent_event":
      return { ...cmd, connDevu, connId };
    case "turn_ended":
      return { ...cmd, connDevu, connId };
  }
}

function dispatch(live: LiveSession, cmd: InboundCommand): void {
  const { nextState, events } = applyCommand(live.state, cmd);
  live.state = nextState;
  emitAll(live, events);
}

function emitAll(
  live: LiveSession,
  events: { recipient: string; event: RelayEvent }[],
): void {
  for (const ev of events) {
    if (ev.recipient === "broadcast") {
      for (const socket of live.sockets.values()) sendEvent(socket, ev.event);
    } else {
      const socket = live.sockets.get(ev.recipient);
      if (socket) sendEvent(socket, ev.event);
    }
  }
}

function sendEvent(ws: WebSocket, ev: RelayEvent): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(ev));
  } catch (err) {
    console.warn("[relay] send failed:", err);
  }
}

/** Test-only: wipe live session state. Does NOT touch disk. */
export function __resetWsServerForTests(): void {
  for (const live of liveSessions.values()) {
    for (const ws of live.sockets.values()) {
      try { ws.terminate(); } catch {}
    }
  }
  liveSessions.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/wsServer.integration.test.ts`
Expected: all 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/wsServer.ts studio/__tests__/server/relay/wsServer.integration.test.ts
git commit -m "feat(studio/multiplayer): WebSocket relay with PAT auth + protocol dispatch"
```

---

## Task 9: HTTP middleware — create session, invite, list

**Files:**
- Create: `studio/server/middleware/multiplayer.ts`
- Test: `studio/__tests__/server/middleware/multiplayer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/middleware/multiplayer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
}));

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "devu/HOST", displayName: "Host" };
    return null;
  },
}));

const {
  multiplayerMiddleware,
} = await import("../../../server/middleware/multiplayer");
const {
  __resetSessionRegistryForTests,
  listSessions,
  getSession,
} = await import("../../../server/relay/sessionRegistry");

function req(url: string, method: string, body?: any, headers: Record<string, string> = {}): IncomingMessage {
  const payload = body ? JSON.stringify(body) : "";
  return {
    url, method, headers,
    [Symbol.asyncIterator]: async function* () {
      if (payload) yield payload;
    },
  } as any;
}

function res(): ServerResponse & { _status?: number; _body?: string } {
  return {
    _status: undefined,
    _body: undefined,
    writeHead(status: number) { this._status = status; },
    end(b?: string) { this._body = b; },
  } as any;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-mp-mw-"));
  process.env.ARCADE_STUDIO_ROOT = tmp;
  __resetSessionRegistryForTests();
  getDevRevPatMock.mockResolvedValue("host-pat");
});
afterEach(() => {
  delete process.env.ARCADE_STUDIO_ROOT;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("multiplayer middleware", () => {
  it("POST /api/multiplayer/sessions creates a session with the host's devu", async () => {
    const mw = multiplayerMiddleware();
    const request = req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" });
    const response = res();
    await mw(request, response);
    expect(response._status).toBe(201);
    const body = JSON.parse(response._body!);
    expect(body.sessionId).toBeTruthy();
    expect(body.sessionObject).toMatch(/^relay-session-/);
    const s = getSession(body.sessionId);
    expect(s?.hostDevu).toBe("devu/HOST");
    expect(s?.projectSlug).toBe("demo");
  });

  it("POST /api/multiplayer/sessions rejects with 401 if no PAT is configured", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    const mw = multiplayerMiddleware();
    const response = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), response);
    expect(response._status).toBe(401);
  });

  it("POST /api/multiplayer/sessions/:id/invite adds a devu to the invite list", async () => {
    const mw = multiplayerMiddleware();
    const create = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), create);
    const { sessionId } = JSON.parse(create._body!);

    const invite = res();
    await mw(
      req(
        `/api/multiplayer/sessions/${sessionId}/invite`,
        "POST",
        { devu: "devu/GUEST" },
      ),
      invite,
    );
    expect(invite._status).toBe(200);
    expect(getSession(sessionId)?.invites.map((i) => i.devu)).toContain("devu/GUEST");
  });

  it("GET /api/multiplayer/sessions returns active sessions for this host", async () => {
    const mw = multiplayerMiddleware();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "a" }), res());
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "b" }), res());
    const list = res();
    await mw(req("/api/multiplayer/sessions", "GET"), list);
    expect(list._status).toBe(200);
    expect(JSON.parse(list._body!).sessions).toHaveLength(2);
  });

  it("POST to /api/multiplayer/sessions/:id/end marks the session ended", async () => {
    const mw = multiplayerMiddleware();
    const create = res();
    await mw(req("/api/multiplayer/sessions", "POST", { projectSlug: "demo" }), create);
    const { sessionId } = JSON.parse(create._body!);

    const end = res();
    await mw(req(`/api/multiplayer/sessions/${sessionId}/end`, "POST"), end);
    expect(end._status).toBe(200);
    expect(listSessions()).toHaveLength(0);
  });

  it("passes to next() for unrelated URLs", async () => {
    const mw = multiplayerMiddleware();
    const next = vi.fn();
    await mw(req("/api/frames/list", "GET"), res(), next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/multiplayer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `studio/server/middleware/multiplayer.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import {
  createSession,
  getSession,
  listSessions,
  endSession,
  addInvite,
} from "../relay/sessionRegistry";

/**
 * HTTP middleware for multiplayer session lifecycle.
 *
 *   POST   /api/multiplayer/sessions              → create a session (host's PAT from keychain)
 *   GET    /api/multiplayer/sessions              → list active sessions
 *   POST   /api/multiplayer/sessions/:id/invite   → add a devu to the invite list
 *   POST   /api/multiplayer/sessions/:id/end      → end the session
 *
 * Auth: the host's DevRev PAT is read from the keychain (same pattern as
 * middleware/devrev.ts). Guests do NOT authenticate via this middleware —
 * they authenticate on the WebSocket upgrade (see relay/wsServer.ts).
 */

const CREATE_URL = /^\/api\/multiplayer\/sessions\/?$/;
const INVITE_URL = /^\/api\/multiplayer\/sessions\/([a-f0-9-]+)\/invite\/?$/;
const END_URL    = /^\/api\/multiplayer\/sessions\/([a-f0-9-]+)\/end\/?$/;

export function multiplayerMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (!url.startsWith("/api/multiplayer/")) return next?.();

    if (req.method === "GET" && CREATE_URL.test(url)) return handleList(res);
    if (req.method === "POST" && CREATE_URL.test(url)) return handleCreate(req, res);

    const invite = url.match(INVITE_URL);
    if (req.method === "POST" && invite) return handleInvite(req, res, invite[1]);

    const end = url.match(END_URL);
    if (req.method === "POST" && end) return handleEnd(res, end[1]);

    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const chunk of req) buf += chunk;
  if (!buf) return {};
  try { return JSON.parse(buf); } catch { return {}; }
}

async function resolveHostDevu(): Promise<{ id: string; displayName: string } | null> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  if (!pat) return null;
  return resolveDevuFromPat(pat);
}

async function handleCreate(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
  const linkedWorkId = typeof body.linkedWorkId === "string" ? body.linkedWorkId : null;

  if (!projectSlug) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "projectSlug required" }));
    return;
  }

  const host = await resolveHostDevu();
  if (!host) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "DevRev PAT not configured or invalid" }));
    return;
  }

  const session = await createSession({
    hostDevu: host.id,
    projectSlug,
    linkedWorkId,
  });
  // Auto-invite the host so they can immediately join.
  await addInvite(session.id, { devu: host.id, invitedByDevu: host.id });

  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    sessionId: session.id,
    sessionObject: session.sessionObject,
    hostDevu: session.hostDevu,
  }));
}

function handleList(res: ServerResponse) {
  const sessions = listSessions().map((s) => ({
    id: s.id,
    projectSlug: s.projectSlug,
    sessionObject: s.sessionObject,
    createdAt: s.createdAt,
    invites: s.invites,
    linkedWorkId: s.linkedWorkId,
  }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ sessions }));
}

async function handleInvite(req: IncomingMessage, res: ServerResponse, id: string) {
  const host = await resolveHostDevu();
  if (!host) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "DevRev PAT not configured or invalid" }));
    return;
  }
  const session = getSession(id);
  if (!session || session.endedAt) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }
  if (session.hostDevu !== host.id) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only the host can invite" }));
    return;
  }

  const body = await readJson(req);
  const devu = typeof body.devu === "string" ? body.devu : "";
  if (!devu) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "devu required" }));
    return;
  }
  await addInvite(id, { devu, invitedByDevu: host.id });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

async function handleEnd(res: ServerResponse, id: string) {
  const session = getSession(id);
  if (!session) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return;
  }
  await endSession(id);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/multiplayer.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/multiplayer.ts studio/__tests__/server/middleware/multiplayer.test.ts
git commit -m "feat(studio/multiplayer): HTTP middleware for session create/invite/end/list"
```

---

## Task 10: Wire middleware + WebSocket into Vite

**Files:**
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Add imports and wire into `apiPlugin`**

Open `studio/vite.config.ts`. Near the top, add:

```ts
import { multiplayerMiddleware } from "./server/middleware/multiplayer";
import { attachRelayToHttpServer } from "./server/relay/wsServer";
import { hydrateSessionRegistry } from "./server/relay/sessionRegistry";
```

In the `apiPlugin` function, add the middleware line (placement: with the other `/api/*` middleware, near `devrevMiddleware`). For the WebSocket upgrade, attach to `server.httpServer` from `configureServer(server)`. Update the function to:

```ts
function apiPlugin(): import("vite").Plugin {
  return {
    name: "arcade-studio-api",
    configureServer(server) {
      server.middlewares.use(versionMiddleware());
      server.middlewares.use(awsLoginMiddleware());
      server.middlewares.use(devrevMiddleware());
      server.middlewares.use(multiplayerMiddleware());
      server.middlewares.use(settingsMiddleware());
      server.middlewares.use(vercelMiddleware());
      server.middlewares.use(projectsMiddleware());
      server.middlewares.use(framesMiddleware());
      server.middlewares.use(adoptUploadsMiddleware());
      server.middlewares.use(chatMiddleware());
      server.middlewares.use(figmaMiddleware());
      server.middlewares.use(uploadsMiddleware());
      server.middlewares.use(stagingUploadsMiddleware());
      server.middlewares.use(thumbnailsMiddleware());
      server.middlewares.use(liftMiddleware());
      server.middlewares.use(preflightMiddleware());
      server.middlewares.use(fontsMiddleware());
      server.middlewares.use(runtimeErrorMiddleware());
      attachBuildErrorReporter(server);
      // Attach the multiplayer WebSocket handler to Vite's HTTP server.
      // httpServer is null in middlewareMode; in dev-server mode (the only
      // way Studio runs) it resolves after `listening`.
      server.httpServer?.once("listening", () => {
        if (server.httpServer) attachRelayToHttpServer(server.httpServer);
      });
      void hydrateSessionRegistry().catch((err) => {
        console.warn("[studio/multiplayer] hydrate failed:", err);
      });
      void logVersionOnBoot();
      void cleanStaleStagingSessions();
      refreshStaleClaudeMd()
        .then((n) => { if (n > 0) console.log(`[studio] refreshed CLAUDE.md for ${n} project(s)`); })
        .catch((err) => console.warn("[studio] CLAUDE.md refresh failed:", err));
    },
  };
}
```

- [ ] **Step 2: Verify the full test suite still passes**

Run: `pnpm run studio:test`
Expected: full suite passes (including the new relay tests — ~200 tests total).

- [ ] **Step 3: Smoke-test the dev server manually**

Run: `pnpm run studio` in one terminal. In another:

```bash
# Use whatever valid PAT is in the keychain.
curl -X POST http://localhost:5556/api/multiplayer/sessions \
  -H "Content-Type: application/json" \
  -d '{"projectSlug":"demo"}'
```

Expected output: a JSON body containing `sessionId` and `sessionObject` (format: `relay-session-<uuid>`). No errors in the dev server log.

Then verify the WebSocket endpoint answers:

```bash
# Will fail auth (no PAT) but prove the route is registered.
curl -i --include \
  --no-buffer \
  --header "Connection: Upgrade" \
  --header "Upgrade: websocket" \
  --header "Sec-WebSocket-Version: 13" \
  --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  "http://localhost:5556/api/multiplayer/ws?sessionId=nonexistent" 2>&1 | head -5
```

Expected: `HTTP/1.1 404 Not Found` (the route is mounted; the session just doesn't exist).

Stop the dev server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add studio/vite.config.ts
git commit -m "feat(studio/multiplayer): wire relay middleware + WebSocket into Vite"
```

---

## Task 11: Two-client correctness test — concurrent-prompt rejection

Spike 1 proved concurrent turns on a shared Computer `session_object` clobber each other silently. The relay serializes these. This task codifies that behavior as a test so a future regression cannot re-introduce the race.

**Files:**
- Modify: `studio/__tests__/server/relay/wsServer.integration.test.ts`

- [ ] **Step 1: Add the test**

Append inside the `describe("wsServer integration", ...)` block:

```ts
it("serializes concurrent prompts — second one is rejected with turn_in_flight", async () => {
  const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
  await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });
  await addInvite(s.id, { devu: "devu/B", invitedByDevu: "devu/A" });

  const alice = await connect("pat-a", s.id);
  await receiveUntil(alice, (m) => m.type === "session_state");

  alice.send(JSON.stringify({ type: "prompt", text: "first", turnId: "t-1" }));
  await receiveUntil(alice, (m) => m.type === "prompt_started");

  // Fire a second prompt while the first is still open.
  alice.send(JSON.stringify({ type: "prompt", text: "second", turnId: "t-2" }));
  const err = await receiveUntil(alice, (m) => m.type === "error");
  expect(err.code).toBe("turn_in_flight");

  alice.close();
});

it("after turn_ended, a subsequent prompt is accepted", async () => {
  const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
  await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

  const alice = await connect("pat-a", s.id);
  await receiveUntil(alice, (m) => m.type === "session_state");

  alice.send(JSON.stringify({ type: "prompt", text: "a", turnId: "t-1" }));
  await receiveUntil(alice, (m) => m.type === "prompt_started");
  alice.send(JSON.stringify({ type: "turn_ended", turnId: "t-1", ok: true }));
  await receiveUntil(alice, (m) => m.type === "turn_ended");

  alice.send(JSON.stringify({ type: "prompt", text: "b", turnId: "t-2" }));
  const started2 = await receiveUntil(alice, (m) => m.type === "prompt_started");
  expect(started2.turnId).toBe("t-2");

  alice.close();
});
```

- [ ] **Step 2: Run the full relay test suite**

Run: `pnpm run studio:test __tests__/server/relay/`
Expected: all tests passing (including the 2 new ones).

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/server/relay/wsServer.integration.test.ts
git commit -m "test(studio/multiplayer): lock in turn serialization contract"
```

---

## Task 12: Final verification — full suite + manual smoke

- [ ] **Step 1: Run full Studio test suite**

Run: `pnpm run studio:test`
Expected: every test passes. Watch specifically for regressions in existing middleware tests (the new middleware shouldn't affect them, but this catches routing conflicts).

- [ ] **Step 2: Run TypeScript check across studio**

Run: `pnpm exec tsc --noEmit -p studio/tsconfig.json`
Expected: no errors.

If there's no tsconfig in studio/, use the repo default — run from repo root:
```
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Manual end-to-end smoke**

Start the dev server: `pnpm run studio`

In a second terminal, run a scripted two-client test (save as `/tmp/relay-smoke.mjs`):

```js
import WebSocket from "ws";

const PORT = 5556;

async function createSession() {
  const res = await fetch(`http://localhost:${PORT}/api/multiplayer/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectSlug: "relay-smoke" }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const { sessionId, sessionObject } = await createSession();
  console.log("created session:", sessionId, "session_object:", sessionObject);

  // Real PAT from keychain will be picked up by the middleware; but for the
  // WebSocket we read it from env for this smoke test.
  const pat = process.env.DEVREV_PAT;
  if (!pat) throw new Error("set DEVREV_PAT in your shell before running");

  const ws = new WebSocket(
    `ws://localhost:${PORT}/api/multiplayer/ws?sessionId=${sessionId}`,
    { headers: { Authorization: pat } },
  );
  ws.on("open", () => console.log("connected"));
  ws.on("message", (raw) => console.log("<-", raw.toString()));
  ws.on("close", (code) => console.log("closed:", code));
  ws.on("error", (e) => console.error("err:", e.message));

  setTimeout(() => {
    ws.send(JSON.stringify({ type: "prompt", text: "hello", turnId: "smoke-1" }));
  }, 500);
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "turn_ended", turnId: "smoke-1", ok: true }));
  }, 1500);
  setTimeout(() => ws.close(), 3000);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Export your real DevRev PAT in the shell (or `set -x DEVREV_PAT …` in fish) and run:

```bash
node /tmp/relay-smoke.mjs
```

Expected output includes:
- `connected`
- `<- {"type":"session_state",...}`
- `<- {"type":"prompt_started","turnId":"smoke-1","byDevu":"...","text":"hello"}`
- `<- {"type":"turn_ended","turnId":"smoke-1","ok":true}`
- `closed: 1000`

No stack traces or uncaught exceptions in the dev server's stdout.

Stop the dev server with Ctrl-C. Delete the smoke script: `rm /tmp/relay-smoke.mjs`.

- [ ] **Step 4: Update CHANGELOG**

Open `studio/CHANGELOG.md`. Do NOT bump the package version (multiplayer relay foundations are plumbing, not a user-visible release). Instead, add an `Unreleased` section at the top if one doesn't exist:

```md
## [Unreleased]

### Added

- Multiplayer relay foundations (internal). In-process WebSocket relay at
  `/api/multiplayer/ws` with PAT auth, driver-lock arbitration, and
  session-persistence. No user-visible UI yet; foundations for
  multi-user prototype sessions landing in subsequent plans.
```

- [ ] **Step 5: Final commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): note multiplayer relay foundations in changelog"
```

---

## Plan complete

At this point the repo contains:

- `studio/server/relay/{types,auth,persistence,sessionRegistry,protocol,wsServer}.ts` — relay module
- `studio/server/middleware/multiplayer.ts` — HTTP surface
- Hooked into `studio/vite.config.ts`
- Full test coverage (unit for each file + one integration test file)
- No UI, no tunneling

Two DevRev users can programmatically connect to a session via WebSocket and exchange messages through the relay. Driver-lock is enforced; turns are serialized. Ready for Plan 2 (tunneling + DevRev directory), which is the next step toward the feature being reachable across the public internet.

---

## Notes for the implementer

- **Don't "simplify" the `protocol.ts` → `wsServer.ts` split.** The separation exists so the driver-lock logic is unit-testable without sockets. Merging them will make tests brittle and slow.
- **Don't add SQLite in this plan.** JSON-file persistence is sufficient for v1 and keeps the dependency surface small. If a later plan needs query capabilities, swap then — not prematurely.
- **`@vitest-environment node`** is required at the top of any test that uses a real `http.Server`. Vitest's default `jsdom` breaks `server.listen`. The integration test file includes this directive; don't drop it.
- **If a WebSocket test hangs**, check that `ws.close()` is called on every connection — `afterEach`'s `server.close(cb)` waits for all clients to drop.
- **Don't add rate-limiting, presence fan-out coalescing, or any other optimization yet.** These are explicitly in Plan 5 (cursors) or later. This plan is *correctness*, not *performance*.
- **The event ring buffer for reconnect replay** (spec §3: "the last ~200 events") is NOT in Plan 1. It becomes user-visible only when guests can actually reconnect and lose progress — that's Plan 4 (guest UX + frame mirroring). Implementing it here would require maintenance without validation. If you spot a clean place for it while implementing Task 8, leave a `// TODO(plan-4): reconnect replay buffer` comment rather than building it.
