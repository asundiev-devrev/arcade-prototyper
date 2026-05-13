# Studio Multiplayer — Invite Flow (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the invite half of multiplayer: host `@`-mentions a DevRev user in Studio chat, guest receives a real DM in Computer, clicks the deep link, lands in their Studio app connected to the host's relay session. Live event streaming comes in Plan 2b.

**Architecture:** Builds on Plan 1's relay. Studio parses `@<user>` mentions at send time, resolves them to devu DONs, opens a `cloudflared` tunnel, creates a relay session, then delivers the invite via DevRev DM (caller + recipient both in `users` — the participant-membership pattern we verified in Spike 2). Guest Studio registers a `arcade-studio://` URL scheme and routes deep links into a join-session flow.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, WebSocket (`ws`) client on guest side, `cloudflared` binary (bundled or system-installed), existing DevRev API proxy, Vitest for tests.

**Branch:** `feat/multiplayer-invite-flow` off `feat/multiplayer-relay-foundations`. Plan 2a depends on Plan 1's relay middleware + session registry, which live on that branch and are NOT yet on `main`.

**Spec reference:** [docs/superpowers/specs/2026-05-08-studio-multiplayer-design.md](../specs/2026-05-08-studio-multiplayer-design.md) — Plan 2a implements the "Section 2: Session lifecycle" invite side (host creates session, guest joins) without the "Section 3: live event forwarding" part.

---

## File Structure

**New server files:**
- `studio/server/relay/tunnel.ts` — spawn / stop `cloudflared`, capture public URL.
- `studio/server/devrev/dm.ts` — create/reuse DM, post message via timeline entry.
- `studio/server/middleware/multiplayerInvite.ts` — `POST /api/multiplayer/invite` (one-shot: create tunnel, create session, create DM, return session id).

**New client files:**
- `studio/src/lib/multiplayer.ts` — typed client calls (start session, join session, fetch user list).
- `studio/src/components/chat/UserMentionList.ts` — pull DevRev user list for mention popover.
- `studio/src/components/multiplayer/InvitePreviewModal.tsx` — "You're about to invite Konstantin to this session — confirm?" step.
- `studio/src/components/multiplayer/JoinSessionGate.tsx` — guest-side "You've been invited" screen with a Join button.
- `studio/src/hooks/useDeepLinkRoute.ts` — parses deep-link params from URL hash on boot.

**New test files:**
- `studio/__tests__/server/relay/tunnel.test.ts`
- `studio/__tests__/server/devrev/dm.test.ts`
- `studio/__tests__/server/middleware/multiplayerInvite.test.ts`
- `studio/__tests__/components/multiplayer/InvitePreviewModal.test.tsx`
- `studio/__tests__/components/multiplayer/JoinSessionGate.test.tsx`
- `studio/__tests__/hooks/useDeepLinkRoute.test.ts`

**Modified files:**
- `studio/src/components/chat/MentionPopover.tsx` — extend `MentionOption` to include user mentions (not just `@Computer`).
- `studio/src/components/chat/PromptInput.tsx` — on send, if the prompt has user mentions, call `/api/multiplayer/invite` before proceeding with normal chat.
- `studio/src/App.tsx` — on boot, check for deep-link hash and mount `JoinSessionGate` if present.
- `studio/vite.config.ts` — wire `multiplayerInviteMiddleware()`.
- `studio/packaging/Info.plist` — add `CFBundleURLTypes` for `arcade-studio://`.
- `studio/packaging/launcher.sh` — handle the URL scheme argument and forward to the running Vite instance via hash update.

**Why this split:**
- `tunnel.ts` and `dm.ts` are pure integrations — testable with mocked fetch/spawn.
- `multiplayerInvite.ts` is orchestration-only (calls the two integrations + Plan 1's session registry) — the thin layer where failures compose.
- UI concerns (`InvitePreviewModal`, `JoinSessionGate`) are separate from the mention-popover extension so the mention UX keeps working for `@Computer` without regression.
- Deep-link handling is isolated to `useDeepLinkRoute` so it's trivially unit-testable without mounting the full app.

---

## Prerequisites

Before starting Task 1, verify Plan 1's relay is on your branch:

```bash
git log --oneline main..feat/multiplayer-relay-foundations | head -20
```

Expected: you should see commits for `wire types`, `atomic JSON persistence`, `session registry`, `pure protocol engine`, `WebSocket relay`, `HTTP middleware`, etc. If not, Plan 1 hasn't landed — do not proceed.

Create the branch for this plan:

```bash
git checkout feat/multiplayer-relay-foundations
git checkout -b feat/multiplayer-invite-flow
```

Run the baseline test suite:

```bash
pnpm run studio:test
```

Expected: 501 + 1 skipped passing. This is Plan 1's baseline.

---

## Task 1: Cloudflare tunnel manager

The tunnel exposes `localhost:5556` to the internet with an ephemeral `*.trycloudflare.com` URL. We parse the URL from cloudflared's stdout.

**Files:**
- Create: `studio/server/relay/tunnel.ts`
- Test: `studio/__tests__/server/relay/tunnel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/tunnel.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

const { startTunnel, stopTunnel, __resetTunnelForTests } = await import(
  "../../../server/relay/tunnel"
);

type FakeProc = ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

function makeFakeProc(): FakeProc {
  const emitter = new EventEmitter() as unknown as FakeProc;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = vi.fn();
  return emitter;
}

beforeEach(() => {
  mockSpawn.mockReset();
  __resetTunnelForTests();
});
afterEach(() => { __resetTunnelForTests(); });

describe("tunnel", () => {
  it("spawns cloudflared and parses the trycloudflare URL from stdout", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF +--------------------------------------------------------------------------------------------+\n",
    );
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n",
    );
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF |  https://brave-squirrel-42.trycloudflare.com                                              |\n",
    );
    const url = await promise;
    expect(url).toBe("https://brave-squirrel-42.trycloudflare.com");
    expect(mockSpawn).toHaveBeenCalledWith(
      "cloudflared",
      ["tunnel", "--url", "http://localhost:5556"],
      expect.any(Object),
    );
  });

  it("rejects if cloudflared exits before emitting a URL", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    setTimeout(() => (proc as unknown as EventEmitter).emit("exit", 1), 0);
    await expect(promise).rejects.toThrow(/cloudflared exited/);
  });

  it("rejects with a clear message if spawn throws ENOENT", async () => {
    mockSpawn.mockImplementation(() => {
      const err: NodeJS.ErrnoException = new Error("spawn cloudflared ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    await expect(startTunnel({ port: 5556 })).rejects.toThrow(
      /cloudflared not found/,
    );
  });

  it("stopTunnel SIGTERMs the running proc and is idempotent", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    proc.stderr.write("https://bar.trycloudflare.com\n");
    await promise;
    stopTunnel();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    // A second call should not throw.
    stopTunnel();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/tunnel.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tunnel.ts`**

Create `studio/server/relay/tunnel.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";

/**
 * Spawn `cloudflared tunnel --url http://localhost:<port>` and resolve with
 * the ephemeral `*.trycloudflare.com` URL when it appears in cloudflared's
 * stderr output. Cloudflared writes logs to stderr, not stdout.
 *
 * Only one tunnel is supported at a time. Call stopTunnel() to terminate.
 * A second startTunnel() call without stopping first will reject.
 */

const TRYCLOUDFLARE_URL_RE = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;
const START_TIMEOUT_MS = 30_000;

let currentProc: ChildProcess | null = null;
let currentUrl: string | null = null;

export interface StartTunnelOptions {
  port: number;
}

export async function startTunnel(opts: StartTunnelOptions): Promise<string> {
  if (currentProc) {
    throw new Error("Tunnel already running — stopTunnel() first");
  }

  let proc: ChildProcess;
  try {
    proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${opts.port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        "cloudflared not found. Install with `brew install cloudflared` or bundle with the DMG.",
      );
    }
    throw err;
  }

  currentProc = proc;

  return new Promise<string>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      stopTunnel();
      reject(new Error("cloudflared did not emit a URL within 30s"));
    }, START_TIMEOUT_MS);

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(TRYCLOUDFLARE_URL_RE);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        currentUrl = match[1];
        resolve(match[1]);
      }
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        currentProc = null;
        reject(new Error(`cloudflared exited with code ${code} before emitting a URL`));
      }
    });
  });
}

export function stopTunnel(): void {
  if (!currentProc) return;
  try { currentProc.kill("SIGTERM"); } catch {}
  currentProc = null;
  currentUrl = null;
}

export function currentTunnelUrl(): string | null {
  return currentUrl;
}

/** Test-only: reset module state. Does NOT kill any real process. */
export function __resetTunnelForTests(): void {
  currentProc = null;
  currentUrl = null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/tunnel.test.ts`

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/tunnel.ts studio/__tests__/server/relay/tunnel.test.ts
git commit -m "feat(studio/multiplayer): cloudflared tunnel spawn + URL parse"
```

---

## Task 2: DevRev DM helper

Verified in Spike 2: `chats.create` works when the caller is included in `users`. Subsequent calls return 409 if the DM already exists — we handle that by falling back to `chats.get`.

**Files:**
- Create: `studio/server/devrev/dm.ts`
- Test: `studio/__tests__/server/devrev/dm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/devrev/dm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOrFetchDm, postToDm } from "../../../server/devrev/dm";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());
afterEach(() => mockFetch.mockReset());

const PAT = "test-pat";
const ME = "don:identity:dvrv-us-1:devo/0:devu/111";
const THEM = "don:identity:dvrv-us-1:devo/0:devu/222";

describe("createOrFetchDm", () => {
  it("creates a new DM when chats.create returns 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ chat: { id: "don:core:dvrv-us-1:devo/0:dm/ABC" } }),
    });
    const id = await createOrFetchDm(PAT, ME, THEM);
    expect(id).toBe("don:core:dvrv-us-1:devo/0:dm/ABC");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/chats.create",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: PAT }),
        body: JSON.stringify({ type: "dm", users: [ME, THEM] }),
      }),
    );
  });

  it("falls back to chats.get on 409 conflict", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: "Conflict", type: "conflict" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ chat: { id: "don:core:dvrv-us-1:devo/0:dm/XYZ" } }),
      });
    const id = await createOrFetchDm(PAT, ME, THEM);
    expect(id).toBe("don:core:dvrv-us-1:devo/0:dm/XYZ");
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.devrev.ai/chats.get",
      expect.objectContaining({
        body: JSON.stringify({ type: "dm", users: [ME, THEM] }),
      }),
    );
  });

  it("throws a descriptive error on 403", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: "Forbidden" }),
    });
    await expect(createOrFetchDm(PAT, ME, THEM)).rejects.toThrow(
      /DevRev rejected DM creation/i,
    );
  });
});

describe("postToDm", () => {
  it("posts a timeline_comment to the DM object", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ timeline_entry: { id: "comment/abc" } }),
    });
    await postToDm(PAT, "don:core:dvrv-us-1:devo/0:dm/ABC", "hello");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.devrev.ai/timeline-entries.create",
      expect.objectContaining({
        body: JSON.stringify({
          type: "timeline_comment",
          object: "don:core:dvrv-us-1:devo/0:dm/ABC",
          body: "hello",
        }),
      }),
    );
  });

  it("throws when timeline-entries.create fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad body",
    });
    await expect(
      postToDm(PAT, "don:core:dvrv-us-1:devo/0:dm/ABC", "hi"),
    ).rejects.toThrow(/Failed to post to DM/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/devrev/dm.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dm.ts`**

Create `studio/server/devrev/dm.ts`:

```ts
/**
 * DevRev DM helpers.
 *
 * Spike 2 findings (2026-05-09):
 *   - `chats.create` with `type: "dm"` and `users: [caller, recipient]`
 *     works with a PAT — BUT the caller MUST be included in `users`.
 *     A recipient-only users array returns 403.
 *   - If the DM already exists, `chats.create` returns 409 Conflict. Use
 *     `chats.get` with the same users to retrieve the existing DM id.
 *   - `timeline-entries.create` with `object: <dm DON>` posts a visible
 *     message into the recipient's Computer inbox. Sender appears as the
 *     PAT's human user, not a bot.
 *
 * This module does the minimum to deliver an invite: create/reuse the DM,
 * post the invite text. Callers handle higher-level concerns (what text
 * to post, when to post it).
 */

const BASE = "https://api.devrev.ai";

export async function createOrFetchDm(
  pat: string,
  callerDevu: string,
  recipientDevu: string,
): Promise<string> {
  const body = JSON.stringify({
    type: "dm",
    users: [callerDevu, recipientDevu],
  });
  const headers = { Authorization: pat, "Content-Type": "application/json" };

  const createRes = await fetch(`${BASE}/chats.create`, { method: "POST", headers, body });
  if (createRes.ok) {
    const data = (await createRes.json()) as { chat?: { id?: string } };
    const id = data.chat?.id;
    if (!id) throw new Error("DM created but response lacked chat.id");
    return id;
  }

  if (createRes.status === 409) {
    const getRes = await fetch(`${BASE}/chats.get`, { method: "POST", headers, body });
    if (!getRes.ok) {
      throw new Error(`DM exists but chats.get failed: ${getRes.status}`);
    }
    const data = (await getRes.json()) as { chat?: { id?: string } };
    const id = data.chat?.id;
    if (!id) throw new Error("chats.get returned no chat.id");
    return id;
  }

  if (createRes.status === 403) {
    throw new Error(
      "DevRev rejected DM creation (403). Check that the PAT is valid and both devu DONs are correct.",
    );
  }

  const text = await createRes.text().catch(() => "");
  throw new Error(`DM creation failed: ${createRes.status} ${text.slice(0, 200)}`);
}

export async function postToDm(
  pat: string,
  dmId: string,
  body: string,
): Promise<void> {
  const res = await fetch(`${BASE}/timeline-entries.create`, {
    method: "POST",
    headers: { Authorization: pat, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "timeline_comment",
      object: dmId,
      body,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to post to DM: ${res.status} ${text.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/devrev/dm.test.ts`

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/devrev/dm.ts studio/__tests__/server/devrev/dm.test.ts
git commit -m "feat(studio/multiplayer): DevRev DM create+post helpers"
```

---

## Task 3: Invite middleware (orchestrates tunnel + session + DM)

This is the one-shot endpoint Studio's chat input calls when it detects a user mention. It starts the tunnel if needed, creates the session, creates the DM, and returns the session id + invite URL.

**Files:**
- Create: `studio/server/middleware/multiplayerInvite.ts`
- Test: `studio/__tests__/server/middleware/multiplayerInvite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/middleware/multiplayerInvite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const getDevRevPatMock = vi.fn<() => Promise<string | null>>();
const resolveDevuMock = vi.fn();
const createOrFetchDmMock = vi.fn();
const postToDmMock = vi.fn();
const startTunnelMock = vi.fn();

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: () => getDevRevPatMock(),
}));
vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: resolveDevuMock,
}));
vi.mock("../../../server/devrev/dm", () => ({
  createOrFetchDm: createOrFetchDmMock,
  postToDm: postToDmMock,
}));
vi.mock("../../../server/relay/tunnel", () => ({
  startTunnel: startTunnelMock,
  currentTunnelUrl: () => null,
  stopTunnel: vi.fn(),
}));

const { multiplayerInviteMiddleware } = await import(
  "../../../server/middleware/multiplayerInvite"
);
const { __resetSessionRegistryForTests } = await import(
  "../../../server/relay/sessionRegistry"
);

function req(url: string, method: string, body?: any, headers: Record<string, string> = {}): IncomingMessage {
  const payload = body ? JSON.stringify(body) : "";
  return {
    url, method, headers,
    [Symbol.asyncIterator]: async function* () { if (payload) yield payload; },
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

beforeEach(() => {
  getDevRevPatMock.mockReset();
  resolveDevuMock.mockReset();
  createOrFetchDmMock.mockReset();
  postToDmMock.mockReset();
  startTunnelMock.mockReset();
  __resetSessionRegistryForTests();
  getDevRevPatMock.mockResolvedValue("host-pat");
  resolveDevuMock.mockResolvedValue({
    id: "don:identity:dvrv-us-1:devo/0:devu/HOST",
    displayName: "Host",
  });
  startTunnelMock.mockResolvedValue("https://brave-squirrel-42.trycloudflare.com");
  createOrFetchDmMock.mockResolvedValue("don:core:dvrv-us-1:devo/0:dm/ABC");
  postToDmMock.mockResolvedValue(undefined);
});
afterEach(() => __resetSessionRegistryForTests());

describe("multiplayerInviteMiddleware", () => {
  it("POST /api/multiplayer/invite creates session, tunnel, DM and returns the link", async () => {
    const mw = multiplayerInviteMiddleware();
    const response = res();
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "Konstantin",
        promptPreview: "add a sidebar",
      }),
      response,
    );
    expect(response._status).toBe(201);
    const body = JSON.parse(response._body!);
    expect(body.sessionId).toBeTruthy();
    expect(body.inviteUrl).toMatch(/^arcade-studio:\/\/session\//);
    expect(body.inviteUrl).toContain("relay=https%3A%2F%2Fbrave-squirrel-42.trycloudflare.com");
    expect(createOrFetchDmMock).toHaveBeenCalledWith(
      "host-pat",
      "don:identity:dvrv-us-1:devo/0:devu/HOST",
      "don:identity:dvrv-us-1:devo/0:devu/GUEST",
    );
    const postedBody = postToDmMock.mock.calls[0][2];
    expect(postedBody).toContain("invited you");
    expect(postedBody).toContain("arcade-studio://session/");
    expect(postedBody).toContain("add a sidebar");
  });

  it("returns 401 when no PAT is configured", async () => {
    getDevRevPatMock.mockResolvedValue(null);
    const response = res();
    await multiplayerInviteMiddleware()(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "Konstantin",
      }),
      response,
    );
    expect(response._status).toBe(401);
  });

  it("returns 502 with the DM error when posting to DM fails", async () => {
    postToDmMock.mockRejectedValue(new Error("Failed to post to DM: 400 bad body"));
    const response = res();
    await multiplayerInviteMiddleware()(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/GUEST",
        guestDisplayName: "K",
      }),
      response,
    );
    expect(response._status).toBe(502);
    expect(JSON.parse(response._body!).error).toMatch(/Failed to post to DM/);
  });

  it("reuses an existing tunnel instead of starting a second one", async () => {
    const mw = multiplayerInviteMiddleware();
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/A",
        guestDisplayName: "A",
      }),
      res(),
    );
    await mw(
      req("/api/multiplayer/invite", "POST", {
        projectSlug: "demo2",
        guestDevu: "don:identity:dvrv-us-1:devo/0:devu/B",
        guestDisplayName: "B",
      }),
      res(),
    );
    expect(startTunnelMock).toHaveBeenCalledTimes(1);
  });

  it("calls next() for unrelated URLs", async () => {
    const next = vi.fn();
    await multiplayerInviteMiddleware()(req("/api/chat", "POST"), res(), next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/multiplayerInvite.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `multiplayerInvite.ts`**

Create `studio/server/middleware/multiplayerInvite.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import { createSession, addInvite } from "../relay/sessionRegistry";
import { createOrFetchDm, postToDm } from "../devrev/dm";
import { startTunnel, currentTunnelUrl } from "../relay/tunnel";

/**
 * One-shot HTTP endpoint for starting a multiplayer invite. Composes:
 *
 *   1. Resolve the host's devu from the keychain PAT.
 *   2. Ensure a cloudflared tunnel is running (start it if not).
 *   3. Create a relay session, add the guest to its invite list.
 *   4. Create/reuse a DevRev DM between host and guest.
 *   5. Post an invite message with the arcade-studio:// deep link into the DM.
 *
 * Returns 201 with { sessionId, inviteUrl } on success. The client uses
 * sessionId to wait for the guest to connect via WebSocket.
 */

const INVITE_URL = /^\/api\/multiplayer\/invite\/?$/;
const STUDIO_PORT = 5556;

export function multiplayerInviteMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (req.method !== "POST" || !INVITE_URL.test(url)) return next?.();

    let body: any;
    try {
      let buf = "";
      for await (const chunk of req) buf += chunk;
      body = buf ? JSON.parse(buf) : {};
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }

    const projectSlug = typeof body.projectSlug === "string" ? body.projectSlug : "";
    const guestDevu = typeof body.guestDevu === "string" ? body.guestDevu : "";
    const guestDisplayName =
      typeof body.guestDisplayName === "string" ? body.guestDisplayName : "your teammate";
    const promptPreview = typeof body.promptPreview === "string" ? body.promptPreview : "";

    if (!projectSlug || !guestDevu) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "projectSlug and guestDevu required" }));
      return;
    }

    const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
    if (!pat) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DevRev PAT not configured" }));
      return;
    }

    const host = await resolveDevuFromPat(pat);
    if (!host) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "DevRev PAT invalid" }));
      return;
    }

    let tunnelUrl = currentTunnelUrl();
    if (!tunnelUrl) {
      try {
        tunnelUrl = await startTunnel({ port: STUDIO_PORT });
      } catch (err: any) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Tunnel failed: ${err?.message ?? err}` }));
        return;
      }
    }

    const session = await createSession({ hostDevu: host.id, projectSlug });
    await addInvite(session.id, { devu: guestDevu, invitedByDevu: host.id });

    const inviteUrl = `arcade-studio://session/${session.id}?relay=${encodeURIComponent(tunnelUrl)}`;

    const messageLines = [
      `${host.displayName} invited you to a prototype session in Arcade Studio.`,
      "",
      promptPreview ? `Starting prompt: "${promptPreview}"` : "",
      "",
      `Open: ${inviteUrl}`,
      "",
      "(Requires Arcade Studio 0.15+. https://github.com/asundiev-devrev/arcade-studio-releases)",
    ].filter(Boolean).join("\n");

    const dmId = await createOrFetchDm(pat, host.id, guestDevu);

    try {
      await postToDm(pat, dmId, messageLines);
    } catch (err: any) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message ?? "DM delivery failed" }));
      return;
    }

    void guestDisplayName; // reserved for future "invited Konstantin" toast content; not used in response body today

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      sessionId: session.id,
      inviteUrl,
      tunnelUrl,
      dmId,
    }));
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/multiplayerInvite.test.ts`

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/multiplayerInvite.ts studio/__tests__/server/middleware/multiplayerInvite.test.ts
git commit -m "feat(studio/multiplayer): invite endpoint composes tunnel+session+DM"
```

---

## Task 4: Wire invite middleware into Vite

**Files:**
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Add the middleware registration**

Open `studio/vite.config.ts`. Near the top with the other middleware imports, add:

```ts
import { multiplayerInviteMiddleware } from "./server/middleware/multiplayerInvite";
```

Inside `apiPlugin`'s `configureServer(server)`, add the middleware line directly after `server.middlewares.use(multiplayerMiddleware());`:

```ts
server.middlewares.use(multiplayerInviteMiddleware());
```

- [ ] **Step 2: Run the full suite to confirm no regressions**

Run: `pnpm run studio:test`

Expected: full suite passes — Plan 1's 501 + Task 1+2+3's new tests (14 additions) = ~515 passing.

- [ ] **Step 3: Commit**

```bash
git add studio/vite.config.ts
git commit -m "feat(studio/multiplayer): wire invite middleware into Vite"
```

---

## Task 5: Client lib — typed multiplayer API calls

Small module so the UI doesn't scatter `fetch()` calls for multiplayer endpoints.

**Files:**
- Create: `studio/src/lib/multiplayer.ts`
- Test: `studio/__tests__/lib/multiplayer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/lib/multiplayer.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listDevUsers, sendInvite } from "../../src/lib/multiplayer";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => mockFetch.mockReset());
afterEach(() => mockFetch.mockReset());

describe("multiplayer client lib", () => {
  it("listDevUsers filters by query and excludes the current user", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        dev_users: [
          { id: "a", display_name: "Alice", email: "a@devrev.ai" },
          { id: "me", display_name: "Me", email: "me@devrev.ai" },
          { id: "b", display_name: "Bob", email: "b@devrev.ai" },
        ],
      }),
    });
    const users = await listDevUsers({ currentDevu: "me" });
    expect(users.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("sendInvite POSTs to /api/multiplayer/invite with the given payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        sessionId: "s1",
        inviteUrl: "arcade-studio://session/s1?relay=https%3A%2F%2Fx.trycloudflare.com",
        tunnelUrl: "https://x.trycloudflare.com",
      }),
    });
    const result = await sendInvite({
      projectSlug: "demo",
      guestDevu: "g",
      guestDisplayName: "G",
      promptPreview: "hello",
    });
    expect(result.sessionId).toBe("s1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/multiplayer/invite",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          projectSlug: "demo",
          guestDevu: "g",
          guestDisplayName: "G",
          promptPreview: "hello",
        }),
      }),
    );
  });

  it("sendInvite throws with the server's error message on non-2xx", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "Tunnel failed: cloudflared not found" }),
    });
    await expect(
      sendInvite({ projectSlug: "demo", guestDevu: "g", guestDisplayName: "G" }),
    ).rejects.toThrow(/cloudflared not found/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/lib/multiplayer.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `multiplayer.ts`**

Create `studio/src/lib/multiplayer.ts`:

```ts
export interface DevUser {
  id: string;           // devu DON
  displayName: string;
  email: string;
}

export async function listDevUsers(opts: { currentDevu?: string }): Promise<DevUser[]> {
  const res = await fetch("/api/devrev/dev-users.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 200 }),
  });
  if (!res.ok) throw new Error(`dev-users.list failed: ${res.status}`);
  const data = (await res.json()) as {
    dev_users?: { id: string; display_name: string; email: string }[];
  };
  const users = (data.dev_users ?? [])
    .filter((u) => !opts.currentDevu || u.id !== opts.currentDevu)
    .map((u) => ({
      id: u.id,
      displayName: u.display_name,
      email: u.email,
    }));
  return users;
}

export interface InviteRequest {
  projectSlug: string;
  guestDevu: string;
  guestDisplayName: string;
  promptPreview?: string;
}

export interface InviteResult {
  sessionId: string;
  inviteUrl: string;
  tunnelUrl: string;
  dmId: string;
}

export async function sendInvite(req: InviteRequest): Promise<InviteResult> {
  const res = await fetch("/api/multiplayer/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any)?.error ?? `Invite failed: ${res.status}`);
  }
  return (await res.json()) as InviteResult;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/lib/multiplayer.test.ts`

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/multiplayer.ts studio/__tests__/lib/multiplayer.test.ts
git commit -m "feat(studio/multiplayer): client lib for invite + dev-users list"
```

---

## Task 6: Extend mention popover with DevRev user options

The popover already exists for `@Computer`. We widen it so the same popover also suggests DevRev users when the query doesn't match "Computer".

**Files:**
- Modify: `studio/src/components/chat/MentionPopover.tsx`
- Test: `studio/__tests__/components/chat/MentionPopover.test.tsx` (new)

- [ ] **Step 1: Write a failing test**

Create `studio/__tests__/components/chat/MentionPopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { filterMentions } from "../../../src/components/chat/MentionPopover";

describe("filterMentions", () => {
  it("returns the Computer option when the query is empty", () => {
    const results = filterMentions("", []);
    expect(results.map((r) => r.id)).toContain("computer");
  });

  it("returns Computer and user matches for partial queries", () => {
    const users = [
      { id: "devu/1", displayName: "Alice", email: "alice@devrev.ai" },
      { id: "devu/2", displayName: "Konstantin", email: "k@devrev.ai" },
    ];
    const results = filterMentions("Ko", users);
    expect(results.map((r) => r.id)).toEqual(["devu/2"]);
  });

  it("matches by email prefix as well as display name", () => {
    const users = [
      { id: "devu/1", displayName: "Alice", email: "alice@devrev.ai" },
    ];
    const results = filterMentions("alic", users);
    expect(results.map((r) => r.id)).toEqual(["devu/1"]);
  });

  it("caps user results to 8 to keep the popover compact", () => {
    const users = Array.from({ length: 20 }, (_, i) => ({
      id: `devu/${i}`,
      displayName: `User ${i}`,
      email: `user${i}@devrev.ai`,
    }));
    const results = filterMentions("user", users);
    // Computer doesn't match "user", so just user results:
    expect(results).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run the test — expect failure on the new signature**

Run: `pnpm run studio:test __tests__/components/chat/MentionPopover.test.tsx`

Expected: FAIL — `filterMentions` currently takes one argument, test passes two.

- [ ] **Step 3: Update `MentionPopover.tsx`**

Replace `studio/src/components/chat/MentionPopover.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Computer } from "@xorkavi/arcade-gen";

export interface MentionOption {
  id: string;
  /** Token inserted into the textarea when selected (without leading @). */
  token: string;
  label: string;
  description?: string;
  icon?: "computer" | "user";
  /** Populated for user mentions. The devu DON. */
  devu?: string;
}

export const COMPUTER_OPTION: MentionOption = {
  id: "computer",
  token: "Computer",
  label: "Computer",
  description: "DevRev agent",
  icon: "computer",
};

export interface UserMentionInput {
  id: string;
  displayName: string;
  email: string;
}

const USER_RESULT_CAP = 8;

export function filterMentions(query: string, users: UserMentionInput[]): MentionOption[] {
  const q = query.toLowerCase();
  const out: MentionOption[] = [];

  if (!q || COMPUTER_OPTION.token.toLowerCase().startsWith(q) || COMPUTER_OPTION.label.toLowerCase().startsWith(q)) {
    out.push(COMPUTER_OPTION);
  }

  if (q) {
    const handle = (u: UserMentionInput) => u.email.split("@")[0];
    const matches = users.filter((u) =>
      u.displayName.toLowerCase().startsWith(q) ||
      handle(u).toLowerCase().startsWith(q),
    );
    for (const u of matches.slice(0, USER_RESULT_CAP)) {
      out.push({
        id: u.id,
        token: handle(u),
        label: u.displayName,
        description: u.email,
        icon: "user",
        devu: u.id,
      });
    }
  }

  return out;
}

interface MentionPopoverProps {
  query: string;
  anchor: { left: number; bottom: number } | null;
  users: UserMentionInput[];
  onSelect: (option: MentionOption) => void;
  onDismiss: () => void;
}

export function MentionPopover({ query, anchor, users, onSelect, onDismiss }: MentionPopoverProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const options = filterMentions(query, users);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!options.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onSelect(options[activeIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [options, activeIdx, onSelect, onDismiss]);

  if (!anchor || !options.length) return null;

  return (
    <div
      ref={rootRef}
      role="listbox"
      style={{
        position: "fixed",
        left: anchor.left,
        bottom: anchor.bottom,
        minWidth: 260,
        background: "var(--surface-overlay)",
        border: "1px solid var(--stroke-neutral-subtle)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        padding: 4,
        zIndex: 1000,
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="option"
          aria-selected={i === activeIdx}
          onMouseDown={(e) => { e.preventDefault(); onSelect(o); }}
          onMouseEnter={() => setActiveIdx(i)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 8px",
            border: "none",
            background: i === activeIdx ? "var(--bg-neutral-soft)" : "transparent",
            borderRadius: 6,
            cursor: "pointer",
            textAlign: "left",
            color: "var(--fg-neutral-prominent)",
          }}
        >
          <span style={{ display: "flex", width: 16, height: 16 }}>
            {o.icon === "computer" ? <Computer size={16} /> : (
              <span
                aria-hidden
                style={{
                  width: 16, height: 16, borderRadius: 8,
                  background: "var(--bg-neutral-soft)",
                  fontSize: 10, fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--fg-neutral-subtle)",
                }}
              >
                {(o.label[0] ?? "?").toUpperCase()}
              </span>
            )}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{o.label}</span>
          {o.description ? (
            <span style={{ fontSize: 12, color: "var(--fg-neutral-subtle)", marginLeft: "auto" }}>
              {o.description}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/components/chat/MentionPopover.test.tsx`

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/chat/MentionPopover.tsx studio/__tests__/components/chat/MentionPopover.test.tsx
git commit -m "feat(studio/multiplayer): extend mention popover with DevRev user suggestions"
```

---

## Task 7: Wire user mentions into PromptInput

The popover now accepts `users`; the prompt input needs to load them and pass them in, then detect on send whether the final text contains a user mention.

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`

- [ ] **Step 1: Find the existing mention integration and load the user list**

Open `studio/src/components/chat/PromptInput.tsx`. Near the top of the component, after the existing `const [mention, setMention] = useState(...)` state, add a state for the user list and an effect to load it:

```tsx
import { useEffect, useMemo, useState } from "react";
import { listDevUsers, sendInvite, type DevUser } from "../../lib/multiplayer";
import { MentionPopover, type MentionOption } from "./MentionPopover";

// ... inside the component body:

const [users, setUsers] = useState<DevUser[]>([]);
useEffect(() => {
  let cancelled = false;
  async function load() {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json().catch(() => ({}));
      const me = (data as any)?.devrev?.user?.id as string | undefined;
      const list = await listDevUsers({ currentDevu: me });
      if (!cancelled) setUsers(list);
    } catch {
      // ignore — users stays [], popover still shows Computer option only
    }
  }
  void load();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 2: Pass `users` to the popover**

Find the existing `<MentionPopover ... />` JSX and add the `users` prop. Before:

```tsx
{mention && (
  <MentionPopover
    query={mention.query}
    anchor={mention.anchor}
    onSelect={...}
    onDismiss={...}
  />
)}
```

After:

```tsx
{mention && (
  <MentionPopover
    query={mention.query}
    anchor={mention.anchor}
    users={users}
    onSelect={...}
    onDismiss={...}
  />
)}
```

- [ ] **Step 3: On send, detect user mentions and intercept**

Find the send-handler path. Where the code currently extracts mentions for Computer routing, add a user-mention detector. Near the top of the send handler (where `hasComputerMention` is computed), add:

```tsx
// Extract any user mentions by matching the text against known user handles.
// Tokens take the form @<handle> where handle is the user's email prefix.
const userMentionDevus: { devu: string; displayName: string }[] = [];
for (const u of users) {
  const handle = u.email.split("@")[0];
  const re = new RegExp(`@${handle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
  if (re.test(text)) userMentionDevus.push({ devu: u.id, displayName: u.displayName });
}
```

Then, BEFORE the existing Computer-routing logic fires, handle multiplayer invites. If there are any user mentions:

```tsx
if (userMentionDevus.length > 0) {
  // Invite first, then let the turn proceed as normal. We invite only the
  // first mentioned user in v1 — multi-invite is out of scope.
  const guest = userMentionDevus[0];
  try {
    await sendInvite({
      projectSlug: slug,
      guestDevu: guest.devu,
      guestDisplayName: guest.displayName,
      promptPreview: text.trim().slice(0, 120),
    });
    toast?.success?.(`Invited ${guest.displayName}`);
  } catch (err: any) {
    toast?.error?.(err?.message ?? "Invite failed");
    return; // do not fire the turn if invite failed
  }
}
```

Use whatever toast mechanism PromptInput already uses. If there is none, fall back to `console.warn` for the error path so the user still gets feedback.

- [ ] **Step 4: Update the `onSelect` for the popover to handle user options**

Find the `onSelect` for `<MentionPopover ... />`. Add a branch for user-icon options so the insertion still works consistently:

```tsx
onSelect={(option) => {
  // Existing insertion logic still applies — option.token is the handle,
  // whether it's "Computer" or a user's email prefix.
  const before = text.slice(0, mention.atIdx);
  const afterStart = mention.atIdx + 1 + mention.query.length;
  const after = text.slice(afterStart);
  const insertedToken = `@${option.token} `;
  setText(before + insertedToken + after);
  setMention(null);
  // ... existing caret repositioning logic stays as-is
}}
```

- [ ] **Step 5: Full suite regression check**

Run: `pnpm run studio:test`

Expected: full suite green. The new test from Task 6 is the only direct addition.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/chat/PromptInput.tsx
git commit -m "feat(studio/multiplayer): detect user @-mentions and invite on send"
```

---

## Task 8: Register `arcade-studio://` URL scheme

macOS needs `Info.plist` to register the scheme and the launcher to handle the URL passed as an argument when the user clicks a link.

**Files:**
- Modify: `studio/packaging/Info.plist`
- Modify: `studio/packaging/launcher.sh`

- [ ] **Step 1: Add `CFBundleURLTypes` to Info.plist**

Open `studio/packaging/Info.plist`. Inside the top-level `<dict>`, before the closing `</dict>`, add:

```xml
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>com.devrev.arcade-studio.session</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>arcade-studio</string>
      </array>
    </dict>
  </array>
```

- [ ] **Step 2: Update `launcher.sh` to accept a URL argument**

Open `studio/packaging/launcher.sh`. When macOS launches the app with a URL, it passes the URL as the first argument to the executable. Near the top of the script (after `set -euo pipefail` and the path exports), add:

```bash
# macOS passes deep-link URLs as the first argument when the app is
# launched via a registered scheme. If present, forward it to the running
# dev server by appending a hash fragment to the open URL.
DEEP_LINK=""
if [ $# -gt 0 ]; then
  case "$1" in
    arcade-studio://*) DEEP_LINK="$1" ;;
  esac
fi
```

Then, where the launcher currently does `open "http://localhost:5556"`, update it to append the deep-link as a hash if one was provided. Find both `open "http://localhost:5556"` lines in the launcher. Replace each with:

```bash
if [ -n "$DEEP_LINK" ]; then
  # URL-encode the deep link and pass as hash fragment. The front end's
  # useDeepLinkRoute hook reads the hash on boot.
  HASH=$(printf '%s' "$DEEP_LINK" | python3 -c 'import sys,urllib.parse; print("#join=" + urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
  open "http://localhost:5556/$HASH"
else
  open "http://localhost:5556"
fi
```

(Python3 is always available on macOS 12+; the `LSMinimumSystemVersion` in Info.plist is 12.0.)

- [ ] **Step 3: Smoke-test manually**

Build the DMG: `pnpm run studio:pack`

Install the resulting `.app` by dragging it to Applications. Then from Terminal:

```bash
open "arcade-studio://session/test-sess-id?relay=https%3A%2F%2Fbar.trycloudflare.com"
```

Expected: Arcade Studio launches (or focuses if already open), and the browser opens to `http://localhost:5556/#join=arcade-studio%3A%2F%2Fsession%2Ftest-sess-id%3Frelay%3Dhttps%253A%252F%252Fbar.trycloudflare.com`.

Verify the `#join=...` hash is in the URL bar. (The app will not do anything with it yet until Task 9 lands.)

- [ ] **Step 4: Commit**

```bash
git add studio/packaging/Info.plist studio/packaging/launcher.sh
git commit -m "feat(studio/multiplayer): register arcade-studio:// URL scheme"
```

---

## Task 9: Deep-link parser hook

React-side parser that reads the `#join=...` hash and decodes the arcade-studio:// deep link.

**Files:**
- Create: `studio/src/hooks/useDeepLinkRoute.ts`
- Test: `studio/__tests__/hooks/useDeepLinkRoute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/hooks/useDeepLinkRoute.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { parseDeepLink } from "../../src/hooks/useDeepLinkRoute";

describe("parseDeepLink", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("returns null when no #join= hash is present", () => {
    window.location.hash = "";
    expect(parseDeepLink()).toBeNull();
  });

  it("parses a valid arcade-studio://session deep link", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "arcade-studio://session/abc-123?relay=https%3A%2F%2Fbar.trycloudflare.com",
    );
    const result = parseDeepLink();
    expect(result).toEqual({
      sessionId: "abc-123",
      relayUrl: "https://bar.trycloudflare.com",
    });
  });

  it("returns null for a malformed deep link", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "arcade-studio://wrong-path/abc",
    );
    expect(parseDeepLink()).toBeNull();
  });

  it("returns null when the scheme is wrong", () => {
    window.location.hash = "#join=" + encodeURIComponent(
      "https://session/abc?relay=https://bar.trycloudflare.com",
    );
    expect(parseDeepLink()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/hooks/useDeepLinkRoute.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useDeepLinkRoute.ts`**

Create `studio/src/hooks/useDeepLinkRoute.ts`:

```ts
import { useEffect, useState } from "react";

export interface DeepLinkRoute {
  sessionId: string;
  relayUrl: string;
}

const DEEP_LINK_RE = /^arcade-studio:\/\/session\/([a-zA-Z0-9-]+)(\?.*)?$/;
const HASH_PREFIX = "#join=";

export function parseDeepLink(): DeepLinkRoute | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const decoded = decodeURIComponent(hash.slice(HASH_PREFIX.length));
  const match = decoded.match(DEEP_LINK_RE);
  if (!match) return null;
  const sessionId = match[1];
  const query = match[2] ?? "";
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const relayUrl = params.get("relay");
  if (!relayUrl) return null;
  return { sessionId, relayUrl };
}

export function clearDeepLink(): void {
  // Strip the hash so a second mount (e.g., refresh) does not re-trigger.
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", pathname + search);
}

export function useDeepLinkRoute(): DeepLinkRoute | null {
  const [route, setRoute] = useState<DeepLinkRoute | null>(() => parseDeepLink());

  useEffect(() => {
    function onHashChange() {
      setRoute(parseDeepLink());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run studio:test __tests__/hooks/useDeepLinkRoute.test.ts`

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add studio/src/hooks/useDeepLinkRoute.ts studio/__tests__/hooks/useDeepLinkRoute.test.ts
git commit -m "feat(studio/multiplayer): deep-link hash parser"
```

---

## Task 10a: Extend relay WebSocket auth to accept a query-param PAT

**Why this exists:** The browser `WebSocket` constructor cannot set custom HTTP headers. Plan 1's relay accepts the PAT via `Authorization` header only — which works fine from Node-side test clients, but browser guests cannot provide a header. To let a guest Studio join from the browser, the WS upgrade handler must also accept `?pat=<value>` as a query string alongside `?sessionId=<value>`.

This is a small, backward-compatible extension: the Authorization header still works (and is preferred when present); the query param is a fallback for browsers. It's NOT a regression of Plan 1 — we didn't have browser clients yet.

**Files:**
- Modify: `studio/server/relay/wsServer.ts`
- Modify: `studio/__tests__/server/relay/wsServer.integration.test.ts`

- [ ] **Step 1: Extend the upgrade handler to read `pat` from query when `Authorization` is absent**

In `studio/server/relay/wsServer.ts`, find the `upgrade` handler — specifically the line that reads `const pat = req.headers.authorization ?? "";`. Replace it with:

```ts
const headerPat = req.headers.authorization ?? "";
const queryPat = url.searchParams.get("pat") ?? "";
const pat = headerPat || queryPat;
```

No other changes to the file. The rest of the auth flow already uses `pat`.

- [ ] **Step 2: Add a test for query-param PAT in `wsServer.integration.test.ts`**

Inside the existing `describe("wsServer integration", ...)` block, add a new test:

```ts
it("accepts pat via ?pat= query when Authorization header is absent", async () => {
  const s = await createSession({ hostDevu: "devu/A", projectSlug: "demo" });
  await addInvite(s.id, { devu: "devu/A", invitedByDevu: "devu/A" });

  const pending = new Promise<ConnectedWs>((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/multiplayer/ws?sessionId=${s.id}&pat=pat-a`,
    );
    const pendingMsgs: any[] = [];
    const listeners = new Set<(msg: any) => void>();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (listeners.size === 0) pendingMsgs.push(msg);
      else for (const fn of listeners) fn(msg);
    });
    ws.once("open", () =>
      resolve({
        ws,
        pending: pendingMsgs,
        onMessage(cb) {
          for (const m of pendingMsgs.splice(0)) cb(m);
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      }),
    );
    ws.once("error", reject);
  });
  const alice = await pending;
  const state = await receiveUntil(alice, (m) => m.type === "session_state");
  expect(state.driverDevu).toBe("devu/A");
  alice.ws.close();
});
```

- [ ] **Step 3: Run the integration tests**

Run: `pnpm run studio:test __tests__/server/relay/wsServer.integration.test.ts`

Expected: 8 passing (7 existing + the new one).

- [ ] **Step 4: Commit**

```bash
git add studio/server/relay/wsServer.ts studio/__tests__/server/relay/wsServer.integration.test.ts
git commit -m "feat(studio/multiplayer): relay accepts PAT via ?pat= query (browser compat)"
```

---

## Task 10b: Guest-side JoinSessionGate component

When a deep link is detected, show the guest a "You've been invited" screen with a Join button. Clicking Join connects them to the host's relay and (once Plan 2b lands) starts streaming. For Plan 2a, we only need to reach the connected state.

**Files:**
- Create: `studio/src/components/multiplayer/JoinSessionGate.tsx`
- Test: `studio/__tests__/components/multiplayer/JoinSessionGate.test.tsx`

- [ ] **Step 1: Add the PAT-read endpoint first**

The JoinSessionGate component needs to read the guest's own DevRev PAT at Join time so it can include it as a `?pat=` query param on the WebSocket URL. Open `studio/server/middleware/settings.ts`. Find where the existing devrev-pat routes are handled (search for `devrev-pat/status`). After that handler, add:

```ts
if (req.method === "GET" && url === "/api/settings/devrev-pat/raw") {
  // Only expose the raw PAT to the local client. This endpoint is explicitly
  // NOT reachable over the multiplayer tunnel — the guest's Studio queries
  // its own local settings, never the host's. The check uses remoteAddress
  // to enforce this rather than relying on URL routing, since Vite's
  // middleware chain doesn't distinguish tunnel vs. localhost.
  const remote = req.socket?.remoteAddress ?? "";
  const isLocal = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!isLocal) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "raw PAT read is localhost-only" }));
    return;
  }
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ pat: pat || null }));
  return;
}
```

Commit this endpoint separately:

```bash
git add studio/server/middleware/settings.ts
git commit -m "feat(studio/multiplayer): localhost-gated endpoint for raw PAT read"
```

- [ ] **Step 2: Write the failing component test**

Create `studio/__tests__/components/multiplayer/JoinSessionGate.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JoinSessionGate } from "../../../src/components/multiplayer/JoinSessionGate";

// Minimal WebSocket stub
class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send = vi.fn();
  close = vi.fn();
  fakeOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  fakeMessage(data: any) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

function installFetchStub() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("devrev-pat/raw")) {
      return Promise.resolve({ ok: true, json: async () => ({ pat: "test-pat" }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }) as any;
}

beforeEach(() => {
  FakeWS.instances = [];
  (global as any).WebSocket = FakeWS;
  installFetchStub();
});
afterEach(() => { FakeWS.instances = []; });

describe("JoinSessionGate", () => {
  it("renders the invite card with relay host info", () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/You've been invited/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Join/i })).toBeInTheDocument();
  });

  it("opens a WebSocket to the relay with sessionId and pat query params when Join is clicked", async () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Join/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    const wsUrl = FakeWS.instances[0].url;
    expect(wsUrl).toContain("wss://bar.trycloudflare.com/api/multiplayer/ws");
    expect(wsUrl).toContain("sessionId=abc-123");
    expect(wsUrl).toContain("pat=test-pat");
  });

  it("calls onJoined once session_state is received", async () => {
    const onJoined = vi.fn();
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={onJoined}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Join/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    FakeWS.instances[0].fakeOpen();
    FakeWS.instances[0].fakeMessage({
      type: "session_state",
      driverDevu: "devu/HOST",
      connections: [{ devu: "devu/HOST", displayName: "Host" }],
      sessionObject: "relay-session-abc",
    });
    await waitFor(() => expect(onJoined).toHaveBeenCalledOnce());
  });

  it("shows an error if the WebSocket closes before session_state", async () => {
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Join/i }));
    await waitFor(() => expect(FakeWS.instances).toHaveLength(1));
    FakeWS.instances[0].onclose?.(new CloseEvent("close", { code: 4401 }));
    await waitFor(() =>
      expect(screen.getByText(/Could not connect/i)).toBeInTheDocument(),
    );
  });

  it("shows an error when the PAT is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pat: null }),
    }) as any;
    render(
      <JoinSessionGate
        sessionId="abc-123"
        relayUrl="https://bar.trycloudflare.com"
        onJoined={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Join/i }));
    await waitFor(() =>
      expect(screen.getByText(/PAT/i)).toBeInTheDocument(),
    );
    // No WebSocket should have been opened.
    expect(FakeWS.instances).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run studio:test __tests__/components/multiplayer/JoinSessionGate.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `JoinSessionGate.tsx`**

Create `studio/src/components/multiplayer/JoinSessionGate.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@xorkavi/arcade-gen";

type Status = "idle" | "connecting" | "joined" | "failed";

interface Props {
  sessionId: string;
  relayUrl: string;
  onJoined: (info: { sessionObject: string; driverDevu: string | null }) => void;
  onDismiss: () => void;
}

export function JoinSessionGate({ sessionId, relayUrl, onJoined, onDismiss }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try { ws.close(); } catch {}
    }
    wsRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleJoin = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    // Read the guest's own PAT from the local Studio's keychain. This call
    // hits the guest's OWN localhost server, NOT the tunneled host.
    const patRes = await fetch("/api/settings/devrev-pat/raw").catch(() => null);
    const patBody = await patRes?.json().catch(() => null);
    const rawPat = patBody?.pat as string | null;
    if (!rawPat) {
      setStatus("failed");
      setError("DevRev PAT is required. Open Settings, paste your PAT, then try again.");
      return;
    }

    const wsBase = relayUrl.replace(/^http/, "ws");
    const url = `${wsBase}/api/multiplayer/ws?sessionId=${encodeURIComponent(sessionId)}&pat=${encodeURIComponent(rawPat)}`;
    // Browser WebSocket cannot set Authorization header, so the PAT goes
    // on the query string. The relay accepts both forms (see Task 10a).
    const ws = new WebSocket(url);
    wsRef.current = ws;

    let joined = false;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "session_state" && !joined) {
          joined = true;
          setStatus("joined");
          onJoined({
            sessionObject: msg.sessionObject,
            driverDevu: msg.driverDevu,
          });
        }
      } catch {
        // ignore non-JSON frames
      }
    };
    ws.onclose = (e) => {
      if (!joined) {
        setStatus("failed");
        setError(`Could not connect to the session (code ${e.code}).`);
      }
    };
    ws.onerror = () => {
      if (!joined) {
        setStatus("failed");
        setError("Could not connect — the host may be offline.");
      }
    };
  }, [relayUrl, sessionId, onJoined]);

  return (
    <Modal open onClose={onDismiss} title="You've been invited">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
        <p style={{ fontSize: 14, color: "var(--fg-neutral-prominent)" }}>
          A teammate has invited you to a live prototype session. Click Join to connect.
        </p>
        <p style={{ fontSize: 12, color: "var(--fg-neutral-subtle)" }}>
          Session: <code>{sessionId}</code>
          <br />
          Host tunnel: <code>{relayUrl}</code>
        </p>
        {status === "failed" && error ? (
          <p style={{ fontSize: 13, color: "var(--fg-critical-prominent)" }}>{error}</p>
        ) : null}
        {status === "joined" ? (
          <p style={{ fontSize: 13, color: "var(--fg-success-prominent)" }}>
            Connected. Waiting for the host to drive…
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onDismiss} disabled={status === "connecting"}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={handleJoin}
            disabled={status === "connecting" || status === "joined"}
          >
            {status === "connecting" ? "Connecting…" : "Join"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Run the component tests**

Run: `pnpm run studio:test __tests__/components/multiplayer/JoinSessionGate.test.tsx`

Expected: 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/multiplayer/JoinSessionGate.tsx studio/__tests__/components/multiplayer/JoinSessionGate.test.tsx
git commit -m "feat(studio/multiplayer): guest-side join gate with ?pat= query auth"
```

---

## Task 11: Mount JoinSessionGate from App when deep link detected

**Files:**
- Modify: `studio/src/App.tsx`

- [ ] **Step 1: Import the hook + component**

At the top of `studio/src/App.tsx`, add:

```tsx
import { useDeepLinkRoute, clearDeepLink } from "./hooks/useDeepLinkRoute";
import { JoinSessionGate } from "./components/multiplayer/JoinSessionGate";
```

- [ ] **Step 2: Read the deep link and render the gate**

Inside the `App` component, near the top alongside the other `useState`/`useEffect` hooks, add:

```tsx
const deepLink = useDeepLinkRoute();
const [joinedSession, setJoinedSession] = useState<null | {
  sessionObject: string;
  driverDevu: string | null;
}>(null);
```

Then update the returned JSX. Wrap the existing `<DevRevThemeProvider>...</DevRevThemeProvider>` so that if `deepLink` is present and not yet joined, the gate renders over the normal UI. Specifically, inside `<StartupAuthGate>`, after `<Toaster />` but still within the theme provider, add:

```tsx
{deepLink && !joinedSession ? (
  <JoinSessionGate
    sessionId={deepLink.sessionId}
    relayUrl={deepLink.relayUrl}
    onJoined={(info) => {
      setJoinedSession(info);
      clearDeepLink();
    }}
    onDismiss={() => clearDeepLink()}
  />
) : null}
```

The important bit: `clearDeepLink()` removes the `#join=...` fragment from the URL so a refresh doesn't re-mount the gate.

- [ ] **Step 3: Run the full suite**

Run: `pnpm run studio:test`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add studio/src/App.tsx
git commit -m "feat(studio/multiplayer): mount JoinSessionGate on deep-link arrival"
```

---

## Task 12: Final verification — end-to-end manual test

Plan 2a's success criterion is a demoable invite flow. Two humans, two machines. If you're testing solo, you'll need a second DevRev account.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`

Expected: all tests pass. Count should be ~532 + 1 skipped (Plan 1 baseline 501 + 4 tunnel + 5 dm + 5 invite middleware + 3 multiplayer lib + 4 MentionPopover + 4 deep-link + 5 JoinSessionGate + 1 wsServer query-pat = ~532). Slight variance expected.

- [ ] **Step 2: TypeScript check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Build the DMG**

Run: `pnpm run studio:pack`

Expected: `studio/packaging/dist/Arcade Studio <version>.dmg` exists.

- [ ] **Step 4: Manual end-to-end invite flow**

On Machine A (host):
1. Install and open the new `.app`.
2. Open a project. In the chat input, type `@<teammate-handle>` — confirm the mention popover shows your teammate.
3. Press Enter or click their name to accept.
4. Add a short prompt after the mention, e.g. `@konstantin look at this — add a sidebar`.
5. Press Enter to send.

Expected on Machine A:
- A "Inviting <name>…" toast appears.
- Then a "Invited <name>" success toast.
- In DevRev.ai on Machine A's browser: a DM with the teammate should now contain the invite message with the `arcade-studio://` link visible.

On Machine B (guest):
6. Open DevRev → Computer → DMs → find the message from Machine A.
7. Click the `arcade-studio://session/...` link.

Expected on Machine B:
- macOS prompts to open Arcade Studio (first time only).
- Studio opens.
- A modal appears: "You've been invited" with a Join button.
- Click Join.
- The modal shows "Connected. Waiting for the host to drive…"

- [ ] **Step 5: Add an Unreleased CHANGELOG entry**

Open `studio/CHANGELOG.md`. Find the existing `## [Unreleased]` heading (added in Plan 1 Task 12). Append under `### Added`:

```md
- Multiplayer invite flow. `@`-mention a DevRev teammate in Studio chat and
  they receive a real Computer DM with a deep link. Clicking the link
  launches Studio and prompts them to join the session. Live viewing comes
  in a follow-up.
```

- [ ] **Step 6: Commit**

```bash
git add studio/CHANGELOG.md
git commit -m "docs(studio): note multiplayer invite flow in changelog"
```

---

## Plan complete

At this point on branch `feat/multiplayer-invite-flow`:

- `@`-mentions resolve DevRev teammates by email prefix.
- Sending a message with a user mention triggers a cloudflared tunnel, creates a relay session, and posts a real DM to the teammate via DevRev's chats/timeline-entries APIs.
- The DM contains a click-to-join `arcade-studio://` link.
- Guests who click the link get a macOS prompt to launch Studio; Studio mounts a JoinSessionGate; clicking Join establishes a WebSocket connection to the host's tunnel.
- Guests reach the "connected, waiting" state. Nothing streams yet — that's Plan 2b.

**Success criterion:** two humans on two machines can get from "I want to show you this prototype" to "Konstantin's Studio shows 'Connected, waiting for host'." In under 30 seconds.

---

## Notes for the implementer

- **Do not stream anything yet.** Plan 2b handles event forwarding on the host side and event rendering on the guest side. If you find yourself wanting to forward `prompt_started` events from `chat.ts` into the relay, stop — that's the next plan.
- **The tunnel stays up across multiple invites** in the same Studio session. We don't tear it down automatically; it dies when Studio quits. Plan 2b can add cleanup.
- **`dev-users.list` returns the full org** — up to 200 users per the default limit. For very large orgs (DevRev itself is ~400 people), you may need pagination. Defer until it's actually a problem.
- **Guest-side raw PAT endpoint** (`/api/settings/devrev-pat/raw`) is localhost-gated via `remoteAddress` check. The tunnel does NOT expose it — the guest talks to their own local Studio only for their own PAT.
- **Plan 1's relay doesn't know about tunnels.** The tunnel is orchestrated separately in `tunnel.ts`; the relay just listens on localhost:5556 like always. The tunnel gives external reachability; nothing in the protocol changes.
- **The `raw-pat` endpoint feels uncomfortable.** That's correct instinct — it's the weakest point of this plan. The mitigation (localhost-gated) is correct for v1. If security review objects, the follow-up is moving WebSocket auth to an HMAC-signed token minted at invite time, which avoids sending the PAT over the wire entirely. Noted as a Plan 3 concern, not a blocker today.
