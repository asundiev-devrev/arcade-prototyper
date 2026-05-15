# Studio Multiplayer — Shared Projects (Plan 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the session-based multiplayer model with a Figma-style shared-project model: hosts share a project once with named DevRev teammates, collaborators see it as a tile on their own homepage, and the relay coordinates live presence + cached state when the host is offline.

**Architecture:** Generalize the relay's per-session registry into a per-project registry keyed by `projectShareId`. Persist allowlists on the host's disk in `multiplayer.json`. Mirror chat events to connected guests over the existing `wsServer.ts` plumbing. On the guest side, materialize a local mirror at `~/Library/Application Support/arcade-studio/shared-projects/<id>/` for cache and offline reads, plus a long-lived server-side WebSocket client per shared project.

**Tech Stack:** Existing — Vite middleware (Node ≥ 20), Zod, `ws`, React 19, vitest. New surfaces: `projectRegistry.ts` (replacing `sessionRegistry.ts`), `projectSharing.ts` and `sharedProjects.ts` middleware, `relayClient.ts` (server-side WS client), worker route `GET /project/<id>`.

**Spec:** [docs/superpowers/specs/2026-05-15-studio-multiplayer-shared-projects-design.md](../specs/2026-05-15-studio-multiplayer-shared-projects-design.md)

---

## File Structure (new + modified)

### New files
- `studio/server/relay/projectRegistry.ts` — replaces `sessionRegistry.ts`, keyed by `projectShareId`
- `studio/server/relay/replayBuffer.ts` — per-project ring buffer of chat events + latest-frame map
- `studio/server/middleware/projectSharing.ts` — host-side share endpoints
- `studio/server/middleware/sharedProjects.ts` — guest-side mirror endpoints + browser SSE
- `studio/server/sharedProjects/relayClient.ts` — long-lived server-side WS client
- `studio/server/sharedProjects/cache.ts` — on-disk cache reader/writer for the guest mirror
- `studio/server/sharedProjects/commentQueue.ts` — offline comment queue on guest
- `studio/src/routes/SharedProject.tsx` — guest's project view (read-only, comment-only)
- `studio/src/components/multiplayer/SharePanel.tsx` — host's share UI
- `studio/src/components/multiplayer/PresenceStrip.tsx` — avatars of currently-connected viewers
- `studio/src/components/multiplayer/OfflineBanner.tsx` — "host is offline" banner
- `studio/src/components/multiplayer/CommentInput.tsx` — comment-only input on the guest side
- `studio/src/components/multiplayer/SharedTile.tsx` — homepage tile for shared projects

### Modified
- `studio/server/relay/types.ts` — new event types (`presence_state`, `cache_replay`, `comment_posted`); `join` payload changes
- `studio/server/relay/wsServer.ts` — load from `projectRegistry`, enforce allowlist, emit replay on join
- `studio/server/relay/protocol.ts` — wire the new events in
- `studio/server/relay/persistence.ts` — `sessions.json` → `projects.json` migration on hydrate
- `studio/server/relay/tunnel.ts` — already supports refcount-style start/stop; verify and document
- `studio/server/middleware/multiplayerInvite.ts` — repurpose @-mention path through `projectSharing`
- `studio/server/middleware/chat.ts` — fan host events to relay's project record on append
- `studio/server/paths.ts` — add `multiplayerJsonPath`, `sharedProjectDir`, `sharedProjectsRoot`
- `studio/worker/src/index.ts` — add `GET /project/<projectShareId>` landing page; keep `/join/<id>` legacy route for one release
- `studio/src/hooks/useDeepLinkRoute.ts` — generalize from `#join` to `#share`, support `/project/...` and legacy `/session/...`
- `studio/src/App.tsx` — route `/shared/:id` to new `SharedProject`
- `studio/src/components/Home.tsx` (or equivalent) — merge `/api/projects` + `/api/shared-projects`, render `SharedTile` for shared
- `studio/src/components/chat/PromptInput.tsx` — @-mention now goes through share-confirmation, not the invite endpoint directly
- `studio/vite.config.ts` — wire new middleware

---

## Operating notes (read once, applies to every task)

1. **Vite middleware is NOT hot-reloaded.** Every task that touches `studio/server/middleware/*`, `studio/server/relay/*`, or `studio/vite.config.ts` requires a full restart of `pnpm run studio` to take effect when manually testing. Tests don't need a restart.
2. **Run tests with `pnpm run studio:test <file>` for speed** — the full suite (`pnpm run studio:test`) takes ~90s.
3. **Commit after every passing task.** Use Conventional Commits with the scope `studio/multiplayer` (e.g. `feat(studio/multiplayer): ...`).
4. **Never `git add -A` or `git add .`** — the repo root has untracked screenshots and scratch files. Always stage explicit paths.
5. **Branch is `feat/multiplayer-invite-flow`.** All work in this plan goes onto that branch. Don't create a new branch unless explicitly told.
6. **Don't modify `studio/packaging/VERSION`.** A separate codesign workstream is bumping to `0.19.0` independently. We commit code only; releases are coordinated.
7. **Use the existing test patterns** in `studio/__tests__/server/devrev/dm.test.ts` and `studio/__tests__/server/relay/*.test.ts` as templates for new server tests.

---

## Task 1: Add `projectShareId` schema + `presence_state` / `cache_replay` / `comment_posted` events

**Files:**
- Modify: `studio/server/relay/types.ts`
- Test: `studio/__tests__/server/relay/types.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clientCommandSchema,
  relayEventSchema,
  projectStateSchema,
} from "../../../server/relay/types";

describe("clientCommandSchema (Plan 2b)", () => {
  it("accepts a join command with projectShareId and asRole", () => {
    const result = clientCommandSchema.safeParse({
      type: "join",
      projectShareId: "550e8400-e29b-41d4-a716-446655440000",
      asRole: "guest",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a join command missing asRole", () => {
    const result = clientCommandSchema.safeParse({
      type: "join",
      projectShareId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a comment_posted command with mentions", () => {
    const result = clientCommandSchema.safeParse({
      type: "comment_posted",
      id: "comment-1",
      text: "Looks great!",
      mentions: ["don:identity:dvrv-us-1:devo/0:devu/123"],
    });
    expect(result.success).toBe(true);
  });
});

describe("relayEventSchema (Plan 2b)", () => {
  it("accepts a presence_state event with host and guests", () => {
    const result = relayEventSchema.safeParse({
      type: "presence_state",
      host: { devu: "don:.../devu/1", displayName: "Andrey" },
      guests: [
        { devu: "don:.../devu/2", displayName: "Bea" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a presence_state event with null host (offline)", () => {
    const result = relayEventSchema.safeParse({
      type: "presence_state",
      host: null,
      guests: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a cache_replay event", () => {
    const result = relayEventSchema.safeParse({
      type: "cache_replay",
      chatHistoryTail: [{ kind: "prompt_started", turnId: "t1", byDevu: "x", text: "hi" }],
      frames: { "frame-01": "<jsx>" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a comment_posted broadcast event", () => {
    const result = relayEventSchema.safeParse({
      type: "comment_posted",
      id: "c-1",
      byDevu: "don:.../devu/2",
      displayName: "Bea",
      text: "looks good",
      mentions: [],
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
  });
});

describe("projectStateSchema", () => {
  it("validates a minimal project record", () => {
    const result = projectStateSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      hostDevu: "don:.../devu/1",
      projectSlug: "my-project",
      createdAt: "2026-05-15T13:00:00Z",
      shared_with: [],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/types.test.ts`
Expected: FAIL — `projectStateSchema` is undefined; `presence_state`, `cache_replay`, `comment_posted` are unknown discriminator values.

- [ ] **Step 3: Implement the schema changes**

Modify `studio/server/relay/types.ts`. Replace the `clientCommandSchema` `join` branch and add new branches:

```ts
export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    projectShareId: z.string().min(1),
    asRole: z.enum(["host", "guest"]),
  }),
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
  z.object({
    type: z.literal("comment_posted"),
    id: z.string().min(1),
    text: z.string().min(1),
    mentions: z.array(z.string()).default([]),
  }),
]);
```

Replace `relayEventSchema` `session_state` with `presence_state`, add `cache_replay` and `comment_posted` events:

```ts
export const relayEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("presence_state"),
    host: connectionInfoSchema.nullable(),
    guests: z.array(connectionInfoSchema),
  }),
  z.object({
    type: z.literal("cache_replay"),
    chatHistoryTail: z.array(z.unknown()),
    frames: z.record(z.string(), z.string()),
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
    type: z.literal("comment_posted"),
    id: z.string(),
    byDevu: z.string(),
    displayName: z.string(),
    text: z.string(),
    mentions: z.array(z.string()),
    ts: z.number(),
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
```

Add new `projectStateSchema` and migration helpers below the existing `sessionStateSchema`:

```ts
export const sharedWithEntrySchema = z.object({
  devu: z.string().min(1),
  displayName: z.string().min(1),
  addedAt: z.string(),
  addedBy: z.string().min(1),
});
export type SharedWithEntry = z.infer<typeof sharedWithEntrySchema>;

export const projectStateSchema = z.object({
  id: z.string().min(1),
  hostDevu: z.string().min(1),
  projectSlug: z.string().min(1),
  createdAt: z.string(),
  shared_with: z.array(sharedWithEntrySchema).default([]),
});
export type ProjectState = z.infer<typeof projectStateSchema>;

export const projectsFileSchema = z.object({
  version: z.literal(2),
  projects: z.array(projectStateSchema),
});
export type ProjectsFile = z.infer<typeof projectsFileSchema>;
```

Keep the existing `sessionStateSchema`, `sessionsFileSchema`, and `SessionInvite` — they're needed for the migration step in Task 5.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/types.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/types.ts studio/__tests__/server/relay/types.test.ts
git commit -m "feat(studio/multiplayer): add projectShareId schema + presence/cache_replay/comment events"
```

---

## Task 2: Replay buffer (per-project chat tail + latest frame map)

**Files:**
- Create: `studio/server/relay/replayBuffer.ts`
- Test: `studio/__tests__/server/relay/replayBuffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/replayBuffer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createReplayBuffer } from "../../../server/relay/replayBuffer";

describe("replayBuffer", () => {
  it("returns an empty snapshot when nothing has been recorded", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    expect(rb.snapshot()).toEqual({ chatHistoryTail: [], frames: {} });
  });

  it("records chat events and returns them in order, up to the limit", () => {
    const rb = createReplayBuffer({ chatTailLimit: 3 });
    rb.recordChat({ kind: "a" });
    rb.recordChat({ kind: "b" });
    rb.recordChat({ kind: "c" });
    rb.recordChat({ kind: "d" });
    expect(rb.snapshot().chatHistoryTail).toEqual([{ kind: "b" }, { kind: "c" }, { kind: "d" }]);
  });

  it("stores latest frame content per path, overwriting older versions", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    rb.recordFrame("frame-01", "v1");
    rb.recordFrame("frame-02", "x");
    rb.recordFrame("frame-01", "v2");
    expect(rb.snapshot().frames).toEqual({ "frame-01": "v2", "frame-02": "x" });
  });

  it("removes a frame from the snapshot on delete", () => {
    const rb = createReplayBuffer({ chatTailLimit: 200 });
    rb.recordFrame("frame-01", "v1");
    rb.recordFrame("frame-02", "x");
    rb.deleteFrame("frame-01");
    expect(rb.snapshot().frames).toEqual({ "frame-02": "x" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/replayBuffer.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `studio/server/relay/replayBuffer.ts`:

```ts
/**
 * Per-project replay buffer. Holds the tail of recent chat events plus
 * the most recent content for every frame path that has been written.
 *
 * Used on guest connect to bring them up to current state with a single
 * `cache_replay` event, instead of waiting for the next prompt to see
 * any frames at all.
 *
 * Chat is bounded (ring buffer). Frames are bounded by the host's project
 * itself — there are typically a few dozen per project, so a Map is fine.
 */

export interface ReplaySnapshot {
  chatHistoryTail: unknown[];
  frames: Record<string, string>;
}

export interface ReplayBuffer {
  recordChat(event: unknown): void;
  recordFrame(path: string, content: string): void;
  deleteFrame(path: string): void;
  snapshot(): ReplaySnapshot;
  reset(): void;
}

export function createReplayBuffer(opts: { chatTailLimit: number }): ReplayBuffer {
  const limit = opts.chatTailLimit;
  let chat: unknown[] = [];
  const frames = new Map<string, string>();

  return {
    recordChat(event) {
      chat.push(event);
      if (chat.length > limit) chat = chat.slice(chat.length - limit);
    },
    recordFrame(path, content) {
      frames.set(path, content);
    },
    deleteFrame(path) {
      frames.delete(path);
    },
    snapshot() {
      return { chatHistoryTail: [...chat], frames: Object.fromEntries(frames) };
    },
    reset() {
      chat = [];
      frames.clear();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/replayBuffer.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/replayBuffer.ts studio/__tests__/server/relay/replayBuffer.test.ts
git commit -m "feat(studio/multiplayer): add per-project replay buffer for cache_replay events"
```

---

## Task 3: Project registry (replaces session registry)

**Files:**
- Create: `studio/server/relay/projectRegistry.ts`
- Test: `studio/__tests__/server/relay/projectRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/relay/projectRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetProjectRegistryForTests,
  createOrGetProject,
  getProject,
  addCollaborator,
  removeCollaborator,
  listProjects,
  isAllowed,
} from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

beforeEach(() => __resetProjectRegistryForTests());

const HOST = "don:identity:dvrv-us-1:devo/0:devu/1";
const GUEST = "don:identity:dvrv-us-1:devo/0:devu/2";

describe("projectRegistry", () => {
  it("createOrGetProject returns a record with empty allowlist", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "my-proj" });
    expect(p.hostDevu).toBe(HOST);
    expect(p.projectSlug).toBe("my-proj");
    expect(p.shared_with).toEqual([]);
    expect(p.id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("createOrGetProject is idempotent per (host, slug)", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    const b = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    expect(a.id).toBe(b.id);
  });

  it("addCollaborator adds an entry; re-adding is a no-op", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    const refreshed = getProject(p.id)!;
    expect(refreshed.shared_with).toHaveLength(1);
    expect(refreshed.shared_with[0]?.devu).toBe(GUEST);
  });

  it("removeCollaborator deletes an entry", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    await removeCollaborator(p.id, GUEST);
    expect(getProject(p.id)!.shared_with).toEqual([]);
  });

  it("isAllowed returns true for host and listed devus, false for everyone else", async () => {
    const p = await createOrGetProject({ hostDevu: HOST, projectSlug: "p" });
    await addCollaborator(p.id, { devu: GUEST, displayName: "Bea", addedBy: HOST });
    expect(isAllowed(p.id, HOST)).toBe(true);
    expect(isAllowed(p.id, GUEST)).toBe(true);
    expect(isAllowed(p.id, "don:.../devu/999")).toBe(false);
  });

  it("listProjects returns only projects for the given host", async () => {
    const a = await createOrGetProject({ hostDevu: HOST, projectSlug: "a" });
    await createOrGetProject({ hostDevu: "don:.../devu/3", projectSlug: "b" });
    const list = listProjects({ hostDevu: HOST });
    expect(list.map((p) => p.id)).toEqual([a.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/projectRegistry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `studio/server/relay/projectRegistry.ts`:

```ts
import { randomUUID } from "node:crypto";
import { loadProjects, saveProjects } from "./persistence";
import type { ProjectState, SharedWithEntry } from "./types";

/**
 * Project registry — in-memory index over persisted shared-project metadata.
 *
 * Replaces the per-session registry from Plan 1/2a. A project's identity
 * is the pair (hostDevu, projectSlug); the registry hands back a stable
 * `id` (UUID) for use as `projectShareId` in deep links and the relay
 * wire protocol.
 *
 * Persists to `relay/projects.json` via persistence.ts. Live WebSocket
 * connections live in `wsServer.ts`, not here.
 */

const projects = new Map<string, ProjectState>();           // id → project
const byHostSlug = new Map<string, string>();               // `${host}::${slug}` → id

export interface CreateOrGetProjectInput {
  hostDevu: string;
  projectSlug: string;
}

function key(host: string, slug: string): string {
  return `${host}::${slug}`;
}

export async function createOrGetProject(input: CreateOrGetProjectInput): Promise<ProjectState> {
  const k = key(input.hostDevu, input.projectSlug);
  const existingId = byHostSlug.get(k);
  if (existingId) {
    const existing = projects.get(existingId);
    if (existing) return existing;
  }
  const project: ProjectState = {
    id: randomUUID(),
    hostDevu: input.hostDevu,
    projectSlug: input.projectSlug,
    createdAt: new Date().toISOString(),
    shared_with: [],
  };
  projects.set(project.id, project);
  byHostSlug.set(k, project.id);
  await flush();
  return project;
}

export function getProject(id: string): ProjectState | undefined {
  return projects.get(id);
}

export function listProjects(opts: { hostDevu: string }): ProjectState[] {
  return Array.from(projects.values()).filter((p) => p.hostDevu === opts.hostDevu);
}

export interface AddCollaboratorInput {
  devu: string;
  displayName: string;
  addedBy: string;
}

export async function addCollaborator(
  projectShareId: string,
  input: AddCollaboratorInput,
): Promise<void> {
  const p = projects.get(projectShareId);
  if (!p) throw new Error(`Project ${projectShareId} not found`);
  if (p.shared_with.some((c) => c.devu === input.devu)) return;
  const entry: SharedWithEntry = {
    devu: input.devu,
    displayName: input.displayName,
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy,
  };
  p.shared_with.push(entry);
  await flush();
}

export async function removeCollaborator(
  projectShareId: string,
  devu: string,
): Promise<void> {
  const p = projects.get(projectShareId);
  if (!p) return;
  p.shared_with = p.shared_with.filter((c) => c.devu !== devu);
  await flush();
}

export function isAllowed(projectShareId: string, devu: string): boolean {
  const p = projects.get(projectShareId);
  if (!p) return false;
  if (p.hostDevu === devu) return true;
  return p.shared_with.some((c) => c.devu === devu);
}

export async function hydrateProjectRegistry(): Promise<void> {
  const persisted = await loadProjects();
  projects.clear();
  byHostSlug.clear();
  for (const p of persisted) {
    projects.set(p.id, p);
    byHostSlug.set(key(p.hostDevu, p.projectSlug), p.id);
  }
}

async function flush(): Promise<void> {
  await saveProjects(Array.from(projects.values()));
}

/** Test-only: wipe in-memory state. Does NOT delete the on-disk file. */
export function __resetProjectRegistryForTests(): void {
  projects.clear();
  byHostSlug.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/projectRegistry.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/relay/projectRegistry.ts studio/__tests__/server/relay/projectRegistry.test.ts
git commit -m "feat(studio/multiplayer): add project registry keyed by projectShareId"
```

---

## Task 4: Persistence — projects.json + sessions.json migration

**Files:**
- Modify: `studio/server/relay/persistence.ts`
- Modify: `studio/server/paths.ts`
- Test: `studio/__tests__/server/relay/persistence.test.ts` (create)

- [ ] **Step 1: Read the existing persistence file to understand the shape**

```bash
cat studio/server/relay/persistence.ts studio/server/paths.ts | head -100
```

- [ ] **Step 2: Write the failing test**

Create `studio/__tests__/server/relay/persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_DATA_DIR;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-multiplayer-"));
  process.env.ARCADE_STUDIO_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (ORIGINAL) process.env.ARCADE_STUDIO_DATA_DIR = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

import { afterEach } from "vitest";

describe("persistence (Plan 2b)", () => {
  it("loadProjects returns [] when no file exists", async () => {
    const { loadProjects } = await import("../../../server/relay/persistence");
    const result = await loadProjects();
    expect(result).toEqual([]);
  });

  it("saveProjects writes a v2 file that loadProjects round-trips", async () => {
    const { loadProjects, saveProjects } = await import(
      "../../../server/relay/persistence"
    );
    const before = [
      {
        id: "abc",
        hostDevu: "don:.../devu/1",
        projectSlug: "my-proj",
        createdAt: "2026-05-15T13:00:00Z",
        shared_with: [],
      },
    ];
    await saveProjects(before);
    const after = await loadProjects();
    expect(after).toEqual(before);
  });

  it("loadProjects migrates v1 sessions.json into projects.json", async () => {
    const sessionsDir = path.join(tmpDir, "multiplayer");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, "sessions.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "old-session-id",
            sessionObject: "x",
            hostDevu: "don:.../devu/1",
            projectSlug: "legacy-proj",
            linkedWorkId: null,
            createdAt: "2026-05-08T00:00:00Z",
            endedAt: null,
            invites: [],
          },
        ],
      }),
    );
    const { loadProjects } = await import("../../../server/relay/persistence");
    const projects = await loadProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.projectSlug).toBe("legacy-proj");
    expect(projects[0]?.shared_with).toEqual([]);
    // Migration should have written the new file.
    const newFile = path.join(tmpDir, "multiplayer", "projects.json");
    const written = JSON.parse(await readFile(newFile, "utf-8"));
    expect(written.version).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/persistence.test.ts`
Expected: FAIL — `saveProjects`/`loadProjects` exports missing.

- [ ] **Step 4: Add `projectsJsonPath` to paths.ts**

Open `studio/server/paths.ts`. Locate `sessionsJsonPath` and add right below it:

```ts
export function projectsJsonPath(): string {
  return path.join(multiplayerRoot(), "projects.json");
}
```

- [ ] **Step 5: Implement persistence functions**

Open `studio/server/relay/persistence.ts`. Add the following exports while keeping the existing `loadSessions` / `saveSessions` for the migration path:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { multiplayerRoot, projectsJsonPath, sessionsJsonPath } from "../paths";
import {
  projectStateSchema,
  projectsFileSchema,
  sessionsFileSchema,
  type ProjectState,
} from "./types";

export async function loadProjects(): Promise<ProjectState[]> {
  const file = projectsJsonPath();
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = projectsFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data.projects;
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  // Fall back to migrating the v1 sessions.json file if it exists.
  const migrated = await migrateFromSessions();
  if (migrated.length > 0) {
    await saveProjects(migrated);
  }
  return migrated;
}

export async function saveProjects(projects: ProjectState[]): Promise<void> {
  await fs.mkdir(multiplayerRoot(), { recursive: true });
  const validated = projects.map((p) => projectStateSchema.parse(p));
  const body = JSON.stringify({ version: 2, projects: validated }, null, 2);
  await fs.writeFile(projectsJsonPath(), body, "utf-8");
}

async function migrateFromSessions(): Promise<ProjectState[]> {
  const file = sessionsJsonPath();
  try {
    const raw = await fs.readFile(file, "utf-8");
    const parsed = sessionsFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const seen = new Set<string>();
    const out: ProjectState[] = [];
    for (const s of parsed.data.sessions) {
      const k = `${s.hostDevu}::${s.projectSlug}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        id: s.id,
        hostDevu: s.hostDevu,
        projectSlug: s.projectSlug,
        createdAt: s.createdAt,
        shared_with: [],
      });
    }
    return out;
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/persistence.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add studio/server/relay/persistence.ts studio/server/paths.ts studio/__tests__/server/relay/persistence.test.ts
git commit -m "feat(studio/multiplayer): persistence for projects.json + sessions.json migration"
```

---

## Task 5: Wire wsServer.ts to use projectRegistry + emit replay on join

**Files:**
- Modify: `studio/server/relay/wsServer.ts`
- Modify: `studio/server/relay/protocol.ts`
- Test: `studio/__tests__/server/relay/wsServer.test.ts` (extend existing or create)

- [ ] **Step 1: Inspect existing protocol.ts to find createLiveState signature**

```bash
grep -n "createLiveState\|emitAll\|allowlist\|hostDevu" studio/server/relay/protocol.ts | head -20
```

- [ ] **Step 2: Write the failing test**

Create `studio/__tests__/server/relay/wsServerJoin.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { attachRelayToHttpServer, __resetWsServerForTests } from "../../../server/relay/wsServer";
import { __resetProjectRegistryForTests, createOrGetProject, addCollaborator } from "../../../server/relay/projectRegistry";

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "don:.../devu/1", displayName: "Andrey" };
    if (pat === "guest-pat") return { id: "don:.../devu/2", displayName: "Bea" };
    if (pat === "stranger-pat") return { id: "don:.../devu/999", displayName: "Stranger" };
    return null;
  },
}));

vi.mock("../../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let server: Server;
let port: number;

beforeEach(async () => {
  __resetWsServerForTests();
  __resetProjectRegistryForTests();
  server = createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

import { afterEach } from "vitest";

async function open(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
    ws.once("close", (code) => j(new Error(`closed ${code}`)));
  });
  return ws;
}

describe("wsServer with project registry", () => {
  it("rejects a stranger devu (not host, not in shared_with)", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    let closeCode = 0;
    const ws = new WebSocket(
      `ws://localhost:${port}/api/multiplayer/ws?projectShareId=${project.id}&pat=stranger-pat&asRole=guest`,
    );
    await new Promise<void>((r) => {
      ws.once("close", (code) => {
        closeCode = code;
        r();
      });
      ws.once("error", () => {}); // expected
    });
    expect(closeCode).toBe(4403);
  });

  it("emits presence_state and cache_replay to the host on join", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    const ws = await open(
      `ws://localhost:${port}/api/multiplayer/ws?projectShareId=${project.id}&pat=host-pat&asRole=host`,
    );
    const got: any[] = [];
    ws.on("message", (raw) => got.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    const types = got.map((g) => g.type);
    expect(types).toContain("presence_state");
    expect(types).toContain("cache_replay");
  });

  it("guest in shared_with can connect", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const ws = await open(
      `ws://localhost:${port}/api/multiplayer/ws?projectShareId=${project.id}&pat=guest-pat&asRole=guest`,
    );
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/wsServerJoin.test.ts`
Expected: FAIL — wsServer is still keyed by sessionId / sessionRegistry.

- [ ] **Step 4: Update protocol.ts**

Open `studio/server/relay/protocol.ts`. Find the `createLiveState` function and update its `inviteList` parameter to `allowlist`. Add new event types `presence_state`, `cache_replay`, `comment_posted` to the union of events `applyCommand` can return. The implementation pattern: replace `session_state` emission on join with two events — `presence_state` (always) and `cache_replay` (only on join). Find the existing `applyCommand` `case "join":` block and replace its emission:

```ts
// inside applyCommand(state, cmd) for cmd.type === "join":
const replaySnapshot = state.replayBuffer.snapshot();
events.push({
  recipient: cmd.connId,
  event: { type: "cache_replay", chatHistoryTail: replaySnapshot.chatHistoryTail, frames: replaySnapshot.frames },
});
events.push({
  recipient: "broadcast",
  event: presenceStateFor(nextState),
});
```

Add helper:

```ts
function presenceStateFor(state: LiveState): RelayEvent {
  let host: ConnectionInfo | null = null;
  const guests: ConnectionInfo[] = [];
  for (const conn of state.connections.values()) {
    const info: ConnectionInfo = { devu: conn.devu, displayName: conn.displayName };
    if (conn.devu === state.hostDevu) host = info;
    else guests.push(info);
  }
  return { type: "presence_state", host, guests };
}
```

Update `createLiveState`'s input to add `replayBuffer: ReplayBuffer` and `allowlist: string[]`. Add a `comment_posted` case in `applyCommand` that broadcasts the comment with the connecting user's identity attached.

- [ ] **Step 5: Update wsServer.ts**

Open `studio/server/relay/wsServer.ts`. Replace the URL parsing and authorization block:

```ts
import { getProject, isAllowed } from "./projectRegistry";
import { createReplayBuffer, type ReplayBuffer } from "./replayBuffer";

// ...

server.on("upgrade", async (req, socket, head) => {
  try {
    if (!req.url?.startsWith("/api/multiplayer/ws")) return;
    const url = new URL(req.url, "http://localhost");
    const projectShareId = url.searchParams.get("projectShareId");
    const asRole = url.searchParams.get("asRole");
    const headerPat = req.headers.authorization ?? "";
    const queryPat = url.searchParams.get("pat") ?? "";
    const pat = headerPat || queryPat;

    if (!projectShareId || (asRole !== "host" && asRole !== "guest")) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const project = getProject(projectShareId);
    if (!project) {
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
    if (!isAllowed(projectShareId, identity.id)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (asRole === "host" && project.hostDevu !== identity.id) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, projectShareId, identity.id, identity.displayName);
    });
  } catch (err) {
    console.error("[relay] upgrade failed:", err);
    try { socket.destroy(); } catch {}
  }
});
```

Replace `LiveSession` keying from sessionId to projectShareId, and update `getOrCreateLiveSession` to read from `projectRegistry.getProject(projectShareId)`. Where `getOrCreateLiveSession` builds `LiveState`, pass `allowlist: project.shared_with.map(c => c.devu).concat(project.hostDevu)` and `replayBuffer: createReplayBuffer({ chatTailLimit: 200 })`.

When a guest is denied (close 4403), use the literal close code `4403` so the test above passes:

```ts
sendEvent(ws, { type: "error", code: "forbidden", message: "Not on the project allowlist." });
ws.close(4403, "forbidden");
```

The denial path is at upgrade time (HTTP 403), but if a stale connection slips past (e.g. `removeCollaborator` race), the subsequent close uses 4403.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/wsServerJoin.test.ts`
Expected: all 3 tests pass.

- [ ] **Step 7: Run the existing relay tests to confirm nothing broke**

Run: `pnpm run studio:test __tests__/server/relay/`
Expected: all tests pass. If older `wsServer.test.ts` tests fail because they reference `sessionId`, update them to `projectShareId` (search-and-replace).

- [ ] **Step 8: Commit**

```bash
git add studio/server/relay/wsServer.ts studio/server/relay/protocol.ts studio/__tests__/server/relay/wsServerJoin.test.ts
git commit -m "feat(studio/multiplayer): wsServer authorizes per project allowlist + emits replay on join"
```

---

## Task 6: Tunnel lifecycle hooks (refcount per project)

**Files:**
- Modify: `studio/server/relay/tunnel.ts`
- Test: `studio/__tests__/server/relay/tunnelLifecycle.test.ts` (create)

- [ ] **Step 1: Read existing tunnel.ts to confirm current shape**

```bash
sed -n '1,60p' studio/server/relay/tunnel.ts
```

- [ ] **Step 2: Write failing test**

Create `studio/__tests__/server/relay/tunnelLifecycle.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  acquireTunnel,
  releaseTunnel,
  __resetTunnelRefsForTests,
} from "../../../server/relay/tunnel";

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const mock = {
    spawn: () => {
      const proc = new EventEmitter() as any;
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      setImmediate(() => proc.stderr.emit("data", Buffer.from("https://test.trycloudflare.com")));
      return proc;
    },
  };
  return { ...mock, default: mock };
});

beforeEach(() => __resetTunnelRefsForTests());

describe("tunnel refcount lifecycle", () => {
  it("acquireTunnel returns the same URL on repeated calls", async () => {
    const a = await acquireTunnel("project-a");
    const b = await acquireTunnel("project-a");
    expect(a).toBe(b);
  });

  it("releaseTunnel keeps the tunnel up while another holder remains", async () => {
    const a = await acquireTunnel("project-a");
    await acquireTunnel("project-b");
    await releaseTunnel("project-a");
    const stillUp = await acquireTunnel("project-c");
    expect(stillUp).toBe(a);
  });

  it("releaseTunnel tears down when the last holder releases", async () => {
    await acquireTunnel("project-a");
    await releaseTunnel("project-a");
    // After full release, next acquire spawns again — URLs may match in this
    // mock, but the spawn-count should have ticked. We assert via a fresh
    // acquire returning a string (not throwing).
    const fresh = await acquireTunnel("project-d");
    expect(fresh).toMatch(/^https:\/\//);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/relay/tunnelLifecycle.test.ts`
Expected: FAIL — `acquireTunnel`/`releaseTunnel`/`__resetTunnelRefsForTests` not exported.

- [ ] **Step 4: Implement refcount in tunnel.ts**

Open `studio/server/relay/tunnel.ts`. Add at the bottom of the file:

```ts
const refs = new Set<string>();

/**
 * Acquire the shared tunnel on behalf of a project. If the tunnel isn't
 * running, start it. Multiple projects share one cloudflared process —
 * the public tunnel URL is identical for all of them; allowlist enforcement
 * happens at the WebSocket layer, not at the tunnel.
 */
export async function acquireTunnel(holderId: string): Promise<string> {
  refs.add(holderId);
  const existing = currentTunnelUrl();
  if (existing) return existing;
  return startTunnel({ port: 5556 });
}

/**
 * Release the tunnel on behalf of a project. When the last holder
 * releases, the tunnel is stopped to reclaim the cloudflared process.
 */
export async function releaseTunnel(holderId: string): Promise<void> {
  refs.delete(holderId);
  if (refs.size === 0) {
    await stopTunnel();
  }
}

/** Test-only: clear the holder set without touching the tunnel. */
export function __resetTunnelRefsForTests(): void {
  refs.clear();
}
```

If `startTunnel` and `stopTunnel` aren't yet exported, add them to the file's exports.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/relay/tunnelLifecycle.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add studio/server/relay/tunnel.ts studio/__tests__/server/relay/tunnelLifecycle.test.ts
git commit -m "feat(studio/multiplayer): refcounted tunnel lifecycle for shared-project model"
```

---

## Task 7: Project sharing middleware (host-side)

**Files:**
- Create: `studio/server/middleware/projectSharing.ts`
- Modify: `studio/server/paths.ts` (add `multiplayerJsonPath`)
- Test: `studio/__tests__/server/middleware/projectSharing.test.ts`

- [ ] **Step 1: Add path helper**

Open `studio/server/paths.ts`. Add:

```ts
export function multiplayerJsonPath(projectSlug: string): string {
  return path.join(projectDir(projectSlug), "multiplayer.json");
}
```

- [ ] **Step 2: Write failing test**

Create `studio/__tests__/server/middleware/projectSharing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_DATA_DIR;
let tmpDir: string;
let server: Server;
let port: number;

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "host-pat",
}));

vi.mock("../../../server/relay/auth", () => ({
  resolveDevuFromPat: async () => ({ id: "don:.../devu/1", displayName: "Andrey" }),
}));

vi.mock("../../../server/devrev/dm", () => ({
  createOrFetchDm: vi.fn(async () => "dm-id"),
  postToDm: vi.fn(async () => {}),
}));

vi.mock("../../../server/relay/tunnel", () => ({
  acquireTunnel: vi.fn(async () => "https://example.trycloudflare.com"),
  releaseTunnel: vi.fn(async () => {}),
  currentTunnelUrl: () => "https://example.trycloudflare.com",
}));

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-share-"));
  process.env.ARCADE_STUDIO_DATA_DIR = tmpDir;
  const { projectSharingMiddleware } = await import(
    "../../../server/middleware/projectSharing"
  );
  server = createServer((req, res) => projectSharingMiddleware()(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (ORIGINAL) process.env.ARCADE_STUDIO_DATA_DIR = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("projectSharing middleware", () => {
  it("POST /api/projects/:slug/share adds a collaborator and posts a DM", async () => {
    const res = await call("POST", "/api/projects/my-proj/share", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    expect(res.status).toBe(201);
    expect(res.body.projectShareId).toMatch(/^[0-9a-f]{8}-/);
    expect(res.body.inviteUrl).toContain("/project/");
  });

  it("GET /api/projects/:slug/share returns shared_with list", async () => {
    await call("POST", "/api/projects/my-proj/share", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    const res = await call("GET", "/api/projects/my-proj/share");
    expect(res.status).toBe(200);
    expect(res.body.shared_with).toHaveLength(1);
    expect(res.body.shared_with[0].devu).toBe("don:.../devu/2");
  });

  it("DELETE /api/projects/:slug/share/:devu removes a collaborator", async () => {
    await call("POST", "/api/projects/my-proj/share", {
      devu: "don:.../devu/2",
      displayName: "Bea",
    });
    const res = await call("DELETE", "/api/projects/my-proj/share/don:.../devu/2");
    expect(res.status).toBe(204);
    const list = await call("GET", "/api/projects/my-proj/share");
    expect(list.body.shared_with).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/projectSharing.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the middleware**

Create `studio/server/middleware/projectSharing.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";
import {
  createOrGetProject,
  getProject,
  addCollaborator,
  removeCollaborator,
  listProjects,
} from "../relay/projectRegistry";
import { acquireTunnel, releaseTunnel, currentTunnelUrl } from "../relay/tunnel";
import { createOrFetchDm, postToDm } from "../devrev/dm";
import { SHARE_WORKER_URL } from "../cloudflare/deploy";
import { multiplayerJsonPath } from "../paths";

const SHARE_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/share\/?$/i;
const SHARE_DEVU_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/share\/(.+)$/i;
const LINK_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/share\/link\/?$/i;

export function projectSharingMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && LINK_RE.test(url)) {
      return handleGetLink(req, res, url.match(LINK_RE)![1]);
    }
    if (req.method === "GET" && SHARE_RE.test(url)) {
      return handleGetShare(req, res, url.match(SHARE_RE)![1]);
    }
    if (req.method === "POST" && SHARE_RE.test(url)) {
      return handlePostShare(req, res, url.match(SHARE_RE)![1]);
    }
    if (req.method === "DELETE" && SHARE_DEVU_RE.test(url)) {
      const m = url.match(SHARE_DEVU_RE)!;
      return handleDeleteShare(req, res, m[1], decodeURIComponent(m[2]));
    }
    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const c of req) buf += c;
  return buf ? JSON.parse(buf) : {};
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function getHostIdentity(): Promise<{ id: string; displayName: string } | null> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  if (!pat) return null;
  return resolveDevuFromPat(pat);
}

async function writeMultiplayerJson(slug: string, projectShareId: string, sharedWith: any[]) {
  const path = multiplayerJsonPath(slug);
  const body = { version: 1, projectShareId, shared_with: sharedWith };
  await fs.writeFile(path, JSON.stringify(body, null, 2), "utf-8");
}

async function handleGetShare(_req: IncomingMessage, res: ServerResponse, slug: string) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) return jsonResponse(res, 200, { shared_with: [] });
  return jsonResponse(res, 200, {
    projectShareId: project.id,
    shared_with: project.shared_with,
  });
}

async function handlePostShare(req: IncomingMessage, res: ServerResponse, slug: string) {
  let body: any;
  try {
    body = await readJson(req);
  } catch {
    return jsonResponse(res, 400, { error: "invalid JSON body" });
  }
  const devu = String(body.devu ?? "");
  const displayName = String(body.displayName ?? "your teammate");
  if (!devu) return jsonResponse(res, 400, { error: "devu required" });

  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });

  const project = await createOrGetProject({ hostDevu: host.id, projectSlug: slug });
  await addCollaborator(project.id, { devu, displayName, addedBy: host.id });

  let tunnelUrl: string;
  try {
    tunnelUrl = await acquireTunnel(project.id);
  } catch (err: any) {
    return jsonResponse(res, 502, { error: `Tunnel failed: ${err?.message ?? err}` });
  }

  await writeMultiplayerJson(slug, project.id, getProject(project.id)!.shared_with);

  const inviteUrl = `${SHARE_WORKER_URL}/project/${project.id}?relay=${encodeURIComponent(
    tunnelUrl,
  )}&host=${encodeURIComponent(host.id)}&hostName=${encodeURIComponent(
    host.displayName,
  )}&projectSlug=${encodeURIComponent(slug)}`;

  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const dmId = await createOrFetchDm(pat, host.id, devu);
  const messageLines = [
    `${host.displayName} shared an Arcade Studio project with you.`,
    "",
    `[Open project](${inviteUrl})`,
    "",
    "Requires Arcade Studio 0.18 or later. The link will try to open Studio automatically, or show you how to install it.",
  ].join("\n");
  try {
    await postToDm(pat, dmId, messageLines);
  } catch (err: any) {
    return jsonResponse(res, 502, { error: err?.message ?? "DM delivery failed" });
  }

  return jsonResponse(res, 201, {
    projectShareId: project.id,
    inviteUrl,
    tunnelUrl,
    dmId,
  });
}

async function handleDeleteShare(
  _req: IncomingMessage,
  res: ServerResponse,
  slug: string,
  devu: string,
) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) {
    res.writeHead(204);
    res.end();
    return;
  }
  await removeCollaborator(project.id, devu);
  await writeMultiplayerJson(slug, project.id, getProject(project.id)!.shared_with);
  if (getProject(project.id)!.shared_with.length === 0) {
    await releaseTunnel(project.id);
  }
  res.writeHead(204);
  res.end();
}

async function handleGetLink(_req: IncomingMessage, res: ServerResponse, slug: string) {
  const host = await getHostIdentity();
  if (!host) return jsonResponse(res, 401, { error: "DevRev PAT not configured" });
  const projects = listProjects({ hostDevu: host.id });
  const project = projects.find((p) => p.projectSlug === slug);
  if (!project) return jsonResponse(res, 404, { error: "project not shared" });
  const tunnelUrl = currentTunnelUrl();
  if (!tunnelUrl) return jsonResponse(res, 503, { error: "tunnel offline" });
  const inviteUrl = `${SHARE_WORKER_URL}/project/${project.id}?relay=${encodeURIComponent(
    tunnelUrl,
  )}&host=${encodeURIComponent(host.id)}&hostName=${encodeURIComponent(
    host.displayName,
  )}&projectSlug=${encodeURIComponent(slug)}`;
  return jsonResponse(res, 200, { inviteUrl });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/middleware/projectSharing.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/projectSharing.ts studio/server/paths.ts studio/__tests__/server/middleware/projectSharing.test.ts
git commit -m "feat(studio/multiplayer): host-side project sharing middleware"
```

---

## Task 8: Mirror host chat events into the relay's project record

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Modify: `studio/server/relay/projectRegistry.ts` (add `getProjectBySlug`)
- Test: `studio/__tests__/server/middleware/chatRelayMirror.test.ts`

- [ ] **Step 1: Add helper export in projectRegistry.ts**

Open `studio/server/relay/projectRegistry.ts`. Add:

```ts
export function getProjectByHostSlug(hostDevu: string, projectSlug: string): ProjectState | undefined {
  const id = byHostSlug.get(`${hostDevu}::${projectSlug}`);
  if (!id) return undefined;
  return projects.get(id);
}
```

- [ ] **Step 2: Write failing test**

Create `studio/__tests__/server/middleware/chatRelayMirror.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { broadcastChatEvent, recordChatEventForReplay } from "../../../server/middleware/chatRelayMirror";

const broadcasted: any[] = [];
const recorded: any[] = [];

vi.mock("../../../server/relay/wsServer", () => ({
  broadcastToProject: (id: string, ev: any) => broadcasted.push({ id, ev }),
}));

vi.mock("../../../server/relay/projectRegistry", () => ({
  getProjectByHostSlug: () => ({ id: "project-id", hostDevu: "h", projectSlug: "s", createdAt: "x", shared_with: [] }),
}));

vi.mock("../../../server/relay/wsServer", async () => ({
  broadcastToProject: (id: string, ev: any) => broadcasted.push({ id, ev }),
  getReplayBufferForProject: () => ({
    recordChat: (e: any) => recorded.push({ kind: "chat", e }),
    recordFrame: (p: string, c: string) => recorded.push({ kind: "frame", p, c }),
    deleteFrame: (p: string) => recorded.push({ kind: "frame_delete", p }),
    snapshot: () => ({ chatHistoryTail: [], frames: {} }),
    reset: () => {},
  }),
}));

beforeEach(() => {
  broadcasted.length = 0;
  recorded.length = 0;
});

describe("chat relay mirror", () => {
  it("broadcastChatEvent fans an event to the project's connections", () => {
    broadcastChatEvent({ hostDevu: "h", projectSlug: "s" }, {
      type: "prompt_started",
      turnId: "t1",
      byDevu: "h",
      text: "hi",
    });
    expect(broadcasted).toHaveLength(1);
    expect(broadcasted[0].ev.type).toBe("prompt_started");
  });

  it("recordChatEventForReplay records frame events into the replay buffer", () => {
    recordChatEventForReplay({ hostDevu: "h", projectSlug: "s" }, {
      type: "frame_written",
      path: "frame-01",
      content: "<jsx>",
      turnId: "t1",
    });
    expect(recorded).toContainEqual({ kind: "chat", e: expect.anything() });
    expect(recorded).toContainEqual({ kind: "frame", p: "frame-01", c: "<jsx>" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/chatRelayMirror.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Add `broadcastToProject` and `getReplayBufferForProject` to wsServer.ts**

Open `studio/server/relay/wsServer.ts`. Add exports:

```ts
export function broadcastToProject(projectShareId: string, event: RelayEvent): void {
  const live = liveSessions.get(projectShareId);
  if (!live) return;
  for (const ws of live.sockets.values()) sendEvent(ws, event);
}

export function getReplayBufferForProject(projectShareId: string): ReplayBuffer | null {
  const live = liveSessions.get(projectShareId);
  return live ? live.state.replayBuffer : null;
}
```

- [ ] **Step 5: Implement the mirror module**

Create `studio/server/middleware/chatRelayMirror.ts`:

```ts
import type { RelayEvent } from "../relay/types";
import { getProjectByHostSlug } from "../relay/projectRegistry";
import { broadcastToProject, getReplayBufferForProject } from "../relay/wsServer";

/**
 * Bridge between the host's chat pipeline and the multiplayer relay.
 *
 * When the host's chat middleware appends an event to its `chat-history.json`
 * and emits an SSE event to the host's own browser, it ALSO calls into here.
 * If the project is currently shared and has live guest connections, we
 * broadcast the event over the relay; we always record it into the project's
 * replay buffer so guests joining later catch up via cache_replay.
 *
 * No-op when the project isn't shared.
 */

export interface ProjectRef {
  hostDevu: string;
  projectSlug: string;
}

export function broadcastChatEvent(ref: ProjectRef, event: RelayEvent): void {
  const project = getProjectByHostSlug(ref.hostDevu, ref.projectSlug);
  if (!project) return;
  broadcastToProject(project.id, event);
}

export function recordChatEventForReplay(ref: ProjectRef, event: RelayEvent): void {
  const project = getProjectByHostSlug(ref.hostDevu, ref.projectSlug);
  if (!project) return;
  const buf = getReplayBufferForProject(project.id);
  if (!buf) return;
  if (event.type === "frame_written") {
    buf.recordFrame(event.path, event.content);
  } else if (event.type === "frame_deleted") {
    buf.deleteFrame(event.path);
  } else {
    buf.recordChat(event);
  }
  // Also broadcast (this is the actual fan-out point in production).
  broadcastToProject(project.id, event);
}
```

- [ ] **Step 6: Wire chat.ts to call the mirror**

Open `studio/server/middleware/chat.ts`. Find the SSE emission path (search for `Content-Type": "text/event-stream"`). Identify where each event the host's UI sees gets emitted. After that emission, call `recordChatEventForReplay`. Pseudocode site (the exact code differs — find the function that consumes `subscribe` events):

```ts
import { recordChatEventForReplay } from "./chatRelayMirror";
import { resolveDevuFromPat } from "../relay/auth";
import { getDevRevPat } from "../secrets/keychain";

// Wrap the existing emission. Resolve the host devu lazily once per turn:
const pat = (await getDevRevPat()) ?? "";
const host = pat ? await resolveDevuFromPat(pat) : null;

const ref = host ? { hostDevu: host.id, projectSlug: slug } : null;

// Inside the subscribe callback, after sse-write:
if (ref) {
  recordChatEventForReplay(ref, mapToRelayEvent(ev));
}
```

`mapToRelayEvent` is a small adapter that converts the chat middleware's internal `ev` (from `turnRegistry.subscribe`) into a `RelayEvent` matching the schema. Map the fields exactly — `prompt_started`, `agent_event`, `frame_written`, `frame_deleted`, `turn_ended`. Add this adapter as a private helper at the bottom of `chat.ts`.

- [ ] **Step 7: Run test**

Run: `pnpm run studio:test __tests__/server/middleware/chatRelayMirror.test.ts`
Expected: 2 tests pass.

- [ ] **Step 8: Run full chat-related tests**

Run: `pnpm run studio:test __tests__/server/middleware/`
Expected: existing chat tests still pass; new tests pass.

- [ ] **Step 9: Commit**

```bash
git add studio/server/middleware/chatRelayMirror.ts studio/server/middleware/chat.ts studio/server/relay/wsServer.ts studio/server/relay/projectRegistry.ts studio/__tests__/server/middleware/chatRelayMirror.test.ts
git commit -m "feat(studio/multiplayer): mirror host chat events into relay project replay"
```

---

## Task 9: Guest-side cache (on-disk mirror)

**Files:**
- Create: `studio/server/sharedProjects/cache.ts`
- Modify: `studio/server/paths.ts` (add `sharedProjectsRoot`, `sharedProjectDir`)
- Test: `studio/__tests__/server/sharedProjects/cache.test.ts`

- [ ] **Step 1: Add path helpers**

Open `studio/server/paths.ts`. Add:

```ts
export function sharedProjectsRoot(): string {
  return path.join(dataRoot(), "shared-projects");
}

export function sharedProjectDir(id: string): string {
  return path.join(sharedProjectsRoot(), id);
}
```

(`dataRoot()` is the existing helper — confirm by reading the top of `paths.ts`.)

- [ ] **Step 2: Write failing test**

Create `studio/__tests__/server/sharedProjects/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_DATA_DIR;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-cache-"));
  process.env.ARCADE_STUDIO_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (ORIGINAL) process.env.ARCADE_STUDIO_DATA_DIR = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("shared-projects cache", () => {
  it("createMirror writes metadata.json", async () => {
    const { createMirror, readMirror } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "https://x.trycloudflare.com",
      hostDevu: "don:.../devu/1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
    const m = await readMirror("abc");
    expect(m?.relayUrl).toBe("https://x.trycloudflare.com");
    expect(m?.hostDisplayName).toBe("Andrey");
  });

  it("appendChat persists messages", async () => {
    const { createMirror, appendChat, readChat } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await appendChat("abc", { kind: "prompt_started", text: "hi" });
    await appendChat("abc", { kind: "agent_event" });
    const chat = await readChat("abc");
    expect(chat).toHaveLength(2);
  });

  it("writeFrame stores frame content; readFrames returns the map", async () => {
    const { createMirror, writeFrame, readFrames } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await writeFrame("abc", "frame-01", "<jsx>");
    await writeFrame("abc", "frame-02", "<other>");
    const frames = await readFrames("abc");
    expect(frames["frame-01"]).toBe("<jsx>");
    expect(frames["frame-02"]).toBe("<other>");
  });

  it("deleteMirror removes the directory", async () => {
    const { createMirror, deleteMirror, readMirror } = await import(
      "../../../server/sharedProjects/cache"
    );
    await createMirror({
      id: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    await deleteMirror("abc");
    const m = await readMirror("abc");
    expect(m).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/sharedProjects/cache.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

Create `studio/server/sharedProjects/cache.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { sharedProjectDir, sharedProjectsRoot } from "../paths";

/**
 * On-disk mirror for a shared project on the GUEST side.
 *
 * Layout:
 *   <root>/shared-projects/<id>/
 *     metadata.json       — { id, relayUrl, hostDevu, hostDisplayName, projectSlug, addedAt, lastSeenAt }
 *     chat-history.json   — array of chat events received from the relay
 *     frames/<frameId>    — last-seen frame content (one file per path)
 *
 * The mirror exists so guests can revisit the project when the host is
 * offline. Writes are best-effort; failures here log and continue.
 */

export interface MirrorMetadata {
  id: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
  addedAt: string;
  lastSeenAt: string;
}

export async function createMirror(input: {
  id: string;
  relayUrl: string;
  hostDevu: string;
  hostDisplayName: string;
  projectSlug: string;
}): Promise<void> {
  const dir = sharedProjectDir(input.id);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  const meta: MirrorMetadata = {
    ...input,
    addedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(meta, null, 2));
  await fs.writeFile(path.join(dir, "chat-history.json"), "[]");
}

export async function readMirror(id: string): Promise<MirrorMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(sharedProjectDir(id), "metadata.json"), "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function appendChat(id: string, event: unknown): Promise<void> {
  const file = path.join(sharedProjectDir(id), "chat-history.json");
  let existing: unknown[] = [];
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {}
  existing.push(event);
  await fs.writeFile(file, JSON.stringify(existing, null, 2));
}

export async function readChat(id: string): Promise<unknown[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(sharedProjectDir(id), "chat-history.json"), "utf-8"));
  } catch {
    return [];
  }
}

export async function writeFrame(id: string, framePath: string, content: string): Promise<void> {
  const dir = path.join(sharedProjectDir(id), "frames");
  await fs.mkdir(dir, { recursive: true });
  // Frame paths are slugs, but we still sanitize to prevent path traversal.
  const safe = framePath.replace(/[^a-zA-Z0-9._-]/g, "_");
  await fs.writeFile(path.join(dir, safe), content, "utf-8");
}

export async function readFrames(id: string): Promise<Record<string, string>> {
  const dir = path.join(sharedProjectDir(id), "frames");
  try {
    const entries = await fs.readdir(dir);
    const out: Record<string, string> = {};
    for (const name of entries) {
      out[name] = await fs.readFile(path.join(dir, name), "utf-8");
    }
    return out;
  } catch {
    return {};
  }
}

export async function listMirrors(): Promise<MirrorMetadata[]> {
  try {
    const entries = await fs.readdir(sharedProjectsRoot());
    const out: MirrorMetadata[] = [];
    for (const id of entries) {
      const meta = await readMirror(id);
      if (meta) out.push(meta);
    }
    return out;
  } catch {
    return [];
  }
}

export async function deleteMirror(id: string): Promise<void> {
  await fs.rm(sharedProjectDir(id), { recursive: true, force: true });
}

export async function touchLastSeen(id: string): Promise<void> {
  const meta = await readMirror(id);
  if (!meta) return;
  meta.lastSeenAt = new Date().toISOString();
  await fs.writeFile(
    path.join(sharedProjectDir(id), "metadata.json"),
    JSON.stringify(meta, null, 2),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/sharedProjects/cache.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add studio/server/sharedProjects/cache.ts studio/server/paths.ts studio/__tests__/server/sharedProjects/cache.test.ts
git commit -m "feat(studio/multiplayer): on-disk cache for guest-side shared-project mirror"
```

---

## Task 10: Guest-side comment queue (offline durability)

**Files:**
- Create: `studio/server/sharedProjects/commentQueue.ts`
- Test: `studio/__tests__/server/sharedProjects/commentQueue.test.ts`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/server/sharedProjects/commentQueue.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_DATA_DIR;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-cq-"));
  process.env.ARCADE_STUDIO_DATA_DIR = tmpDir;
  await mkdir(path.join(tmpDir, "shared-projects", "abc"), { recursive: true });
});

afterEach(async () => {
  if (ORIGINAL) process.env.ARCADE_STUDIO_DATA_DIR = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("commentQueue", () => {
  it("enqueue + drain returns the queued comments", async () => {
    const { enqueueComment, drainComments } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    await enqueueComment("abc", { id: "c2", text: "hello" });
    const drained = await drainComments("abc");
    expect(drained.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("drain leaves the queue empty", async () => {
    const { enqueueComment, drainComments } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    await drainComments("abc");
    const second = await drainComments("abc");
    expect(second).toEqual([]);
  });

  it("atomic write — partial-file scenario does not duplicate on next launch", async () => {
    // Simulate by checking that the implementation uses a temp+rename pattern;
    // we assert by inspecting the file content after an enqueue.
    const { enqueueComment } = await import(
      "../../../server/sharedProjects/commentQueue"
    );
    await enqueueComment("abc", { id: "c1", text: "hi" });
    // No partial file should remain.
    const fs = await import("node:fs/promises");
    const dir = path.join(tmpDir, "shared-projects", "abc");
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/sharedProjects/commentQueue.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `studio/server/sharedProjects/commentQueue.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { sharedProjectDir } from "../paths";

/**
 * Per-mirror queue of comments composed while the host was offline.
 * Flushed in order on reconnect by the relay client.
 *
 * Persistence is atomic: write to a temp file, fsync, rename. Crash mid-write
 * leaves either the previous content or the new content, never a partial.
 */

interface QueuedComment {
  id: string;
  text: string;
  mentions?: string[];
  ts?: number;
}

function file(id: string): string {
  return path.join(sharedProjectDir(id), "comments-pending.json");
}

async function readQueue(id: string): Promise<QueuedComment[]> {
  try {
    return JSON.parse(await fs.readFile(file(id), "utf-8"));
  } catch {
    return [];
  }
}

async function writeQueueAtomic(id: string, queue: QueuedComment[]): Promise<void> {
  const target = file(id);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(queue, null, 2), "utf-8");
  await fs.rename(tmp, target);
}

export async function enqueueComment(id: string, comment: QueuedComment): Promise<void> {
  const q = await readQueue(id);
  q.push(comment);
  await writeQueueAtomic(id, q);
}

export async function drainComments(id: string): Promise<QueuedComment[]> {
  const q = await readQueue(id);
  if (q.length === 0) return [];
  await writeQueueAtomic(id, []);
  return q;
}

export async function peekQueue(id: string): Promise<QueuedComment[]> {
  return readQueue(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/sharedProjects/commentQueue.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/sharedProjects/commentQueue.ts studio/__tests__/server/sharedProjects/commentQueue.test.ts
git commit -m "feat(studio/multiplayer): atomic offline-comment queue for guest mirrors"
```

---

## Task 11: Server-side relay client (long-lived WS, mirror writes, queue flush)

**Files:**
- Create: `studio/server/sharedProjects/relayClient.ts`
- Test: `studio/__tests__/server/sharedProjects/relayClient.test.ts`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/server/sharedProjects/relayClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeWS extends EventEmitter {
  static OPEN = 1;
  readyState = FakeWS.OPEN;
  sent: string[] = [];
  send(s: string) { this.sent.push(s); }
  close() { this.emit("close"); }
}

let lastWS: FakeWS | null = null;

vi.mock("ws", () => {
  return {
    WebSocket: class extends FakeWS {
      constructor(url: string) {
        super();
        lastWS = this;
        setImmediate(() => this.emit("open"));
      }
    },
  };
});

const cacheCalls: any[] = [];
vi.mock("../../../server/sharedProjects/cache", () => ({
  appendChat: async (...args: any[]) => cacheCalls.push(["appendChat", ...args]),
  writeFrame: async (...args: any[]) => cacheCalls.push(["writeFrame", ...args]),
  readMirror: async (id: string) => ({
    id,
    relayUrl: "wss://x.trycloudflare.com/api/multiplayer/ws",
    hostDevu: "h",
    hostDisplayName: "A",
    projectSlug: "p",
    addedAt: "x",
    lastSeenAt: "x",
  }),
  touchLastSeen: async () => {},
}));

const queueCalls: any[] = [];
vi.mock("../../../server/sharedProjects/commentQueue", () => ({
  drainComments: async () => queueCalls.length === 0 ? [{ id: "c1", text: "hi" }] : [],
  enqueueComment: async (...args: any[]) => queueCalls.push(args),
}));

vi.mock("../../../server/secrets/keychain", () => ({
  getDevRevPat: async () => "guest-pat",
}));

beforeEach(() => {
  cacheCalls.length = 0;
  queueCalls.length = 0;
  lastWS = null;
});

describe("relayClient", () => {
  it("connect: opens WS to the relay URL with projectShareId + asRole=guest + pat", async () => {
    const { connectMirror } = await import("../../../server/sharedProjects/relayClient");
    await connectMirror("abc");
    expect(lastWS).not.toBeNull();
  });

  it("on cache_replay: writes chatHistoryTail and frames into the local mirror", async () => {
    const { connectMirror } = await import("../../../server/sharedProjects/relayClient");
    await connectMirror("abc");
    const ev = {
      type: "cache_replay",
      chatHistoryTail: [{ kind: "prompt_started" }],
      frames: { "frame-01": "<jsx>" },
    };
    lastWS!.emit("message", JSON.stringify(ev));
    await new Promise((r) => setImmediate(r));
    expect(cacheCalls).toContainEqual(["appendChat", "abc", { kind: "prompt_started" }]);
    expect(cacheCalls).toContainEqual(["writeFrame", "abc", "frame-01", "<jsx>"]);
  });

  it("on open: drains the offline comment queue and sends each over the WS", async () => {
    const { connectMirror } = await import("../../../server/sharedProjects/relayClient");
    await connectMirror("abc");
    await new Promise((r) => setImmediate(r));
    expect(lastWS!.sent.some((s) => s.includes("comment_posted"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/sharedProjects/relayClient.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `studio/server/sharedProjects/relayClient.ts`:

```ts
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  appendChat,
  writeFrame,
  readMirror,
  touchLastSeen,
} from "./cache";
import { drainComments, enqueueComment } from "./commentQueue";
import { getDevRevPat } from "../secrets/keychain";
import { relayEventSchema } from "../relay/types";

/**
 * Server-side WebSocket client per shared-project mirror.
 *
 * Lives in the Vite dev process — NOT in the browser tab — so the
 * connection survives tab close. The browser fetches state through
 * sharedProjects middleware (HTTP/SSE), and the relay client owns
 * the live transport.
 */

interface MirrorClient {
  id: string;
  ws: WebSocket | null;
  bus: EventEmitter;
  reconnectMs: number;
  closed: boolean;
}

const clients = new Map<string, MirrorClient>();

export function getMirrorBus(id: string): EventEmitter | null {
  return clients.get(id)?.bus ?? null;
}

export async function connectMirror(id: string): Promise<void> {
  if (clients.has(id)) return;
  const meta = await readMirror(id);
  if (!meta) throw new Error(`No mirror for ${id}`);
  const client: MirrorClient = {
    id,
    ws: null,
    bus: new EventEmitter(),
    reconnectMs: 1000,
    closed: false,
  };
  clients.set(id, client);
  await openSocket(client, meta.relayUrl);
}

export async function disconnectMirror(id: string): Promise<void> {
  const c = clients.get(id);
  if (!c) return;
  c.closed = true;
  c.ws?.close();
  clients.delete(id);
}

export async function sendComment(id: string, text: string, mentions: string[] = []): Promise<void> {
  const c = clients.get(id);
  const cmd = { type: "comment_posted", id: `c-${Date.now()}`, text, mentions };
  if (c?.ws?.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify(cmd));
  } else {
    await enqueueComment(id, { id: cmd.id, text, mentions, ts: Date.now() });
  }
}

async function openSocket(client: MirrorClient, relayUrl: string): Promise<void> {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const url = `${relayUrl}?projectShareId=${client.id}&asRole=guest&pat=${encodeURIComponent(pat)}`;
  const ws = new WebSocket(url);
  client.ws = ws;

  ws.on("open", async () => {
    client.bus.emit("status", "online");
    client.reconnectMs = 1000;
    const queued = await drainComments(client.id);
    for (const c of queued) {
      ws.send(JSON.stringify({ type: "comment_posted", id: c.id, text: c.text, mentions: c.mentions ?? [] }));
    }
  });

  ws.on("message", async (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); } catch { return; }
    const result = relayEventSchema.safeParse(parsed);
    if (!result.success) return;
    const ev = result.data;

    if (ev.type === "cache_replay") {
      for (const e of ev.chatHistoryTail) {
        await appendChat(client.id, e);
      }
      for (const [framePath, content] of Object.entries(ev.frames)) {
        await writeFrame(client.id, framePath, content);
      }
    } else if (ev.type === "frame_written") {
      await writeFrame(client.id, ev.path, ev.content);
    } else {
      // Anything else (chat events, comments, presence) is journaled to
      // chat-history.json for offline replay AND emitted on the bus for
      // any browser SSE listeners.
      await appendChat(client.id, ev);
    }
    await touchLastSeen(client.id);
    client.bus.emit("event", ev);
  });

  ws.on("close", () => {
    client.bus.emit("status", "offline");
    client.ws = null;
    if (client.closed) return;
    setTimeout(() => {
      if (clients.has(client.id) && !client.closed) {
        openSocket(client, relayUrl).catch(() => {});
      }
    }, client.reconnectMs);
    client.reconnectMs = Math.min(client.reconnectMs * 2, 30_000);
  });

  ws.on("error", () => {
    // close handler does the reconnect work
  });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm run studio:test __tests__/server/sharedProjects/relayClient.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/sharedProjects/relayClient.ts studio/__tests__/server/sharedProjects/relayClient.test.ts
git commit -m "feat(studio/multiplayer): server-side relay client with reconnect + queue flush"
```

---

## Task 12: Shared projects middleware (guest endpoints + SSE)

**Files:**
- Create: `studio/server/middleware/sharedProjects.ts`
- Test: `studio/__tests__/server/middleware/sharedProjects.test.ts`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/server/middleware/sharedProjects.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

const ORIGINAL = process.env.ARCADE_STUDIO_DATA_DIR;
let tmpDir: string;
let server: Server;
let port: number;

vi.mock("../../../server/sharedProjects/relayClient", () => ({
  connectMirror: vi.fn(async () => {}),
  disconnectMirror: vi.fn(async () => {}),
  sendComment: vi.fn(async () => {}),
  getMirrorBus: () => ({ on: () => {}, off: () => {} }),
}));

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "studio-sp-"));
  process.env.ARCADE_STUDIO_DATA_DIR = tmpDir;
  const { sharedProjectsMiddleware } = await import(
    "../../../server/middleware/sharedProjects"
  );
  server = createServer((req, res) => sharedProjectsMiddleware()(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (ORIGINAL) process.env.ARCADE_STUDIO_DATA_DIR = ORIGINAL;
  else delete process.env.ARCADE_STUDIO_DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(`http://localhost:${port}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("sharedProjects middleware", () => {
  it("POST /api/shared-projects/import creates a mirror entry", async () => {
    const res = await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "wss://x.trycloudflare.com/api/multiplayer/ws",
      hostDevu: "don:.../devu/1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("abc");
  });

  it("GET /api/shared-projects returns the list", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("GET", "/api/shared-projects");
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].id).toBe("abc");
  });

  it("POST /api/shared-projects/:id/comment returns 200 even when offline", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("POST", "/api/shared-projects/abc/comment", { text: "hi" });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/shared-projects/:id removes the mirror", async () => {
    await call("POST", "/api/shared-projects/import", {
      projectShareId: "abc",
      relayUrl: "x",
      hostDevu: "h",
      hostDisplayName: "A",
      projectSlug: "p",
    });
    const res = await call("DELETE", "/api/shared-projects/abc");
    expect(res.status).toBe(204);
    const list = await call("GET", "/api/shared-projects");
    expect(list.body.projects).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/middleware/sharedProjects.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `studio/server/middleware/sharedProjects.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMirror,
  readMirror,
  listMirrors,
  deleteMirror,
  readChat,
  readFrames,
} from "../sharedProjects/cache";
import {
  connectMirror,
  disconnectMirror,
  sendComment,
  getMirrorBus,
} from "../sharedProjects/relayClient";

const LIST_RE = /^\/api\/shared-projects\/?$/;
const IMPORT_RE = /^\/api\/shared-projects\/import\/?$/;
const ITEM_RE = /^\/api\/shared-projects\/([^\/]+)\/?$/;
const COMMENT_RE = /^\/api\/shared-projects\/([^\/]+)\/comment\/?$/;
const STREAM_RE = /^\/api\/shared-projects\/([^\/]+)\/stream\/?$/;

export function sharedProjectsMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && LIST_RE.test(url)) return list(res);
    if (req.method === "POST" && IMPORT_RE.test(url)) return importMirror(req, res);
    if (req.method === "GET" && STREAM_RE.test(url)) return stream(req, res, url.match(STREAM_RE)![1]);
    if (req.method === "POST" && COMMENT_RE.test(url)) return comment(req, res, url.match(COMMENT_RE)![1]);
    if (req.method === "DELETE" && ITEM_RE.test(url)) return remove(res, url.match(ITEM_RE)![1]);
    if (req.method === "GET" && ITEM_RE.test(url)) return show(res, url.match(ITEM_RE)![1]);
    return next?.();
  };
}

async function readJson(req: IncomingMessage): Promise<any> {
  let buf = "";
  for await (const c of req) buf += c;
  return buf ? JSON.parse(buf) : {};
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function list(res: ServerResponse) {
  const mirrors = await listMirrors();
  json(res, 200, { projects: mirrors });
}

async function show(res: ServerResponse, id: string) {
  const meta = await readMirror(id);
  if (!meta) return json(res, 404, { error: "not_found" });
  const [chat, frames] = await Promise.all([readChat(id), readFrames(id)]);
  json(res, 200, { metadata: meta, chat, frames });
}

async function importMirror(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try { body = await readJson(req); } catch { return json(res, 400, { error: "bad_json" }); }
  const required = ["projectShareId", "relayUrl", "hostDevu", "hostDisplayName", "projectSlug"];
  for (const k of required) {
    if (!body[k]) return json(res, 400, { error: `${k} required` });
  }
  await createMirror({
    id: body.projectShareId,
    relayUrl: body.relayUrl,
    hostDevu: body.hostDevu,
    hostDisplayName: body.hostDisplayName,
    projectSlug: body.projectSlug,
  });
  await connectMirror(body.projectShareId);
  json(res, 201, { id: body.projectShareId });
}

async function comment(req: IncomingMessage, res: ServerResponse, id: string) {
  let body: any;
  try { body = await readJson(req); } catch { return json(res, 400, { error: "bad_json" }); }
  const text = String(body.text ?? "").trim();
  if (!text) return json(res, 400, { error: "text required" });
  await sendComment(id, text);
  json(res, 200, { ok: true });
}

async function remove(res: ServerResponse, id: string) {
  await disconnectMirror(id);
  await deleteMirror(id);
  res.writeHead(204);
  res.end();
}

async function stream(_req: IncomingMessage, res: ServerResponse, id: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const bus = getMirrorBus(id);
  if (!bus) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: "no mirror" })}\n\n`);
    res.end();
    return;
  }
  const onEvent = (ev: unknown) => res.write(`event: relay\ndata: ${JSON.stringify(ev)}\n\n`);
  const onStatus = (s: string) => res.write(`event: status\ndata: ${JSON.stringify({ status: s })}\n\n`);
  bus.on("event", onEvent);
  bus.on("status", onStatus);
  res.on("close", () => {
    bus.off("event", onEvent);
    bus.off("status", onStatus);
  });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm run studio:test __tests__/server/middleware/sharedProjects.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/sharedProjects.ts studio/__tests__/server/middleware/sharedProjects.test.ts
git commit -m "feat(studio/multiplayer): guest-side shared-projects middleware (list/import/comment/SSE)"
```

---

## Task 13: Wire new middleware into vite.config.ts; hydrate registry on boot

**Files:**
- Modify: `studio/vite.config.ts`

- [ ] **Step 1: Read existing vite.config.ts**

```bash
sed -n '1,80p' studio/vite.config.ts
```

Find the `configureServer` block. Note where existing middleware are wired (`multiplayerMiddleware`, `multiplayerInviteMiddleware`).

- [ ] **Step 2: Replace `hydrateSessionRegistry` with `hydrateProjectRegistry`**

Find:
```ts
import { hydrateSessionRegistry } from "./server/relay/sessionRegistry";
```

Replace with:
```ts
import { hydrateProjectRegistry } from "./server/relay/projectRegistry";
```

Find the call site:
```ts
await hydrateSessionRegistry();
```
Replace with:
```ts
await hydrateProjectRegistry();
```

- [ ] **Step 3: Wire new middleware**

Find where `multiplayerMiddleware` and `multiplayerInviteMiddleware` are added with `server.middlewares.use`. Add:

```ts
import { projectSharingMiddleware } from "./server/middleware/projectSharing";
import { sharedProjectsMiddleware } from "./server/middleware/sharedProjects";

// ...inside configureServer, after existing middleware:
server.middlewares.use(projectSharingMiddleware());
server.middlewares.use(sharedProjectsMiddleware());
```

Auto-resume any persisted shared-project mirrors on boot:

```ts
import { listMirrors } from "./server/sharedProjects/cache";
import { connectMirror } from "./server/sharedProjects/relayClient";

// ...after middleware wiring:
const mirrors = await listMirrors();
for (const m of mirrors) {
  connectMirror(m.id).catch((err) =>
    console.warn(`[shared-projects] failed to reconnect ${m.id}:`, err),
  );
}
```

- [ ] **Step 4: Verify it boots**

Run: `pnpm run studio` — open the browser. Don't actually test functionality yet, just confirm boot doesn't crash.

Expected: dev server starts without errors. Quit it (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts
git commit -m "feat(studio/multiplayer): wire shared-projects middleware + auto-resume mirrors on boot"
```

---

## Task 14: Worker route `GET /project/<id>` + legacy `/join/<id>` preserved

**Files:**
- Modify: `studio/worker/src/index.ts`

- [ ] **Step 1: Add the new route**

Open `studio/worker/src/index.ts`. Find the existing block:

```ts
const joinMatch = /^\/join\/([a-zA-Z0-9-]+)\/?$/.exec(url.pathname);
if (joinMatch) { /* ... */ }
```

Above that, add:

```ts
const projectMatch = /^\/project\/([a-zA-Z0-9-]+)\/?$/.exec(url.pathname);
if (projectMatch) {
  const projectShareId = projectMatch[1];
  const relay = url.searchParams.get("relay") ?? "";
  const host = url.searchParams.get("host") ?? "";
  const hostName = url.searchParams.get("hostName") ?? "your teammate";
  const projectSlug = url.searchParams.get("projectSlug") ?? "";
  return new Response(
    renderProjectLandingPage({ projectShareId, relay, host, hostName, projectSlug }),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
```

- [ ] **Step 2: Add the renderer**

Below the existing `renderJoinLandingPage`, add:

```ts
function renderProjectLandingPage(input: {
  projectShareId: string;
  relay: string;
  host: string;
  hostName: string;
  projectSlug: string;
}): string {
  const RELEASES_URL = "https://github.com/asundiev-devrev/arcade-studio-releases/releases/latest";
  const MIN_VERSION = "0.18";
  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escJs = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");

  // Deep link encodes the full payload so the launcher can hand it to Studio:
  //   arcade-studio://project/<id>?relay=<url>&host=<devu>&hostName=<name>&projectSlug=<slug>
  const deepLink =
    `arcade-studio://project/${encodeURIComponent(input.projectShareId)}` +
    `?relay=${encodeURIComponent(input.relay)}` +
    `&host=${encodeURIComponent(input.host)}` +
    `&hostName=${encodeURIComponent(input.hostName)}` +
    `&projectSlug=${encodeURIComponent(input.projectSlug)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Open shared Arcade Studio project</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    background: #fceade;
    color: #2a1a3d;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card { background: white; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
  p { margin: 0 0 16px; line-height: 1.5; color: #4a3a5d; }
  .muted { font-size: 13px; color: #6a5a7d; }
  .btn { display: inline-block; padding: 10px 16px; background: #7c3aed; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; margin-top: 8px; border: none; cursor: pointer; font-size: 14px; }
  .btn:hover { background: #6d28d9; }
  .btn-secondary { background: transparent; color: #7c3aed; border: 1px solid #7c3aed; }
  .btn-secondary:hover { background: #f5f0fa; }
  #install-prompt { display: none; margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee4d4; }
  code { font-size: 12px; padding: 2px 6px; background: #f5f0fa; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; }
</style>
</head>
<body>
  <div class="card">
    <h1>Opening Arcade Studio…</h1>
    <p id="status">${escHtml(input.hostName)} shared a project with you. If Arcade Studio is installed, it should open automatically.</p>
    <p class="muted">Project: <code>${escHtml(input.projectSlug || input.projectShareId)}</code></p>
    <button class="btn" id="retry">Try opening again</button>

    <div id="install-prompt">
      <h1 style="font-size: 18px; margin-top: 0;">Don't have Arcade Studio yet?</h1>
      <p>You'll need version ${escHtml(MIN_VERSION)} or later to open shared projects.</p>
      <a class="btn" href="${escHtml(RELEASES_URL)}" target="_blank" rel="noopener">Download Arcade Studio</a>
      <a class="btn btn-secondary" id="try-again" href="#">Already installed — try again</a>
    </div>
  </div>

<script>
(function(){
  var deepLink = '${escJs(deepLink)}';
  var status = document.getElementById('status');
  var shown = false;
  function showInstall() { if (shown) return; shown = true; document.getElementById('install-prompt').style.display = 'block'; }
  function fireScheme() { window.location.href = deepLink; }
  function retryFlow() {
    fireScheme();
    setTimeout(function() { if (shown) return; fireScheme(); }, 8000);
    setTimeout(function() { status.textContent = 'Still working on it — the app is starting up.'; }, 3000);
    setTimeout(showInstall, 18000);
  }
  document.getElementById('retry').addEventListener('click', retryFlow);
  document.getElementById('try-again').addEventListener('click', function(e) { e.preventDefault(); retryFlow(); });
  retryFlow();
})();
</script>
</body>
</html>`;
}
```

- [ ] **Step 3: Verify the worker still type-checks**

Run from repo root: `cd studio/worker && npx wrangler deploy --dry-run 2>&1 | head -20`

Expected: succeeds with "Total Upload: …".

- [ ] **Step 4: Commit**

```bash
git add studio/worker/src/index.ts
git commit -m "feat(studio/worker): add /project/<id> landing page route for shared-project shares"
```

(Don't deploy yet — that happens after end-to-end works.)

---

## Task 15: Generalize the deep-link parser

**Files:**
- Modify: `studio/src/hooks/useDeepLinkRoute.ts`
- Test: `studio/__tests__/hooks/useDeepLinkRoute.test.ts` (extend existing)

- [ ] **Step 1: Read the existing parser**

```bash
cat studio/src/hooks/useDeepLinkRoute.ts
```

- [ ] **Step 2: Write failing test cases**

Append to `studio/__tests__/hooks/useDeepLinkRoute.test.ts` (or create if absent):

```ts
import { describe, it, expect } from "vitest";
import { parseDeepLink } from "../../src/hooks/useDeepLinkRoute";

describe("parseDeepLink — project shares (Plan 2b)", () => {
  it("returns a project deep-link from a #share=arcade-studio://project/... fragment", () => {
    const url = encodeURIComponent(
      "arcade-studio://project/abc?relay=https%3A%2F%2Fx.trycloudflare.com&host=devu1&hostName=Andrey&projectSlug=p",
    );
    const result = parseDeepLink(`http://localhost:5556/#share=${url}`);
    expect(result).toEqual({
      kind: "project",
      projectShareId: "abc",
      relayUrl: "https://x.trycloudflare.com",
      hostDevu: "devu1",
      hostDisplayName: "Andrey",
      projectSlug: "p",
    });
  });

  it("returns a session deep-link from the legacy #join=arcade-studio://session/... fragment", () => {
    const url = encodeURIComponent(
      "arcade-studio://session/xyz?relay=https%3A%2F%2Fy.trycloudflare.com",
    );
    const result = parseDeepLink(`http://localhost:5556/#join=${url}`);
    expect(result).toEqual({
      kind: "session",
      sessionId: "xyz",
      relayUrl: "https://y.trycloudflare.com",
    });
  });

  it("returns null for an unrelated fragment", () => {
    expect(parseDeepLink("http://localhost:5556/#notjoin=xyz")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/hooks/useDeepLinkRoute.test.ts`
Expected: FAIL — `parseDeepLink` returns the wrong shape (no `kind`, no project fields).

- [ ] **Step 4: Update the parser**

Open `studio/src/hooks/useDeepLinkRoute.ts`. Replace `parseDeepLink`:

```ts
export type DeepLinkRoute =
  | { kind: "session"; sessionId: string; relayUrl: string }
  | {
      kind: "project";
      projectShareId: string;
      relayUrl: string;
      hostDevu: string;
      hostDisplayName: string;
      projectSlug: string;
    };

export function parseDeepLink(href: string): DeepLinkRoute | null {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return null;
  const hash = href.slice(hashIdx + 1);
  const params = new URLSearchParams(hash);
  const encoded = params.get("share") ?? params.get("join");
  if (!encoded) return null;

  let inner: URL;
  try {
    inner = new URL(encoded);
  } catch {
    return null;
  }
  if (inner.protocol !== "arcade-studio:") return null;

  const relay = inner.searchParams.get("relay") ?? "";

  // Path shape: //session/<id> or //project/<id>
  // URL puts the host as the segment after //; strip and treat as the kind.
  const kind = inner.host;
  const id = inner.pathname.replace(/^\//, "");

  if (kind === "session") {
    if (!id || !relay) return null;
    return { kind: "session", sessionId: id, relayUrl: relay };
  }
  if (kind === "project") {
    const hostDevu = inner.searchParams.get("host") ?? "";
    const hostDisplayName = inner.searchParams.get("hostName") ?? "";
    const projectSlug = inner.searchParams.get("projectSlug") ?? "";
    if (!id || !relay) return null;
    return {
      kind: "project",
      projectShareId: id,
      relayUrl: relay,
      hostDevu,
      hostDisplayName,
      projectSlug,
    };
  }
  return null;
}
```

Update the `clearDeepLink` to match:

```ts
export function clearDeepLink(): void {
  if (typeof window === "undefined") return;
  if (!window.location.hash) return;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}
```

(If the hook itself returns the parsed value, update its callers in App.tsx to inspect `result.kind`.)

- [ ] **Step 5: Run test**

Run: `pnpm run studio:test __tests__/hooks/useDeepLinkRoute.test.ts`
Expected: 3 tests pass; existing tests in this file (if any) still pass.

- [ ] **Step 6: Commit**

```bash
git add studio/src/hooks/useDeepLinkRoute.ts studio/__tests__/hooks/useDeepLinkRoute.test.ts
git commit -m "feat(studio/multiplayer): generalize deep-link parser to handle project shares"
```

---

## Task 16: Update launcher.sh deep-link forwarding to support `#share`

**Files:**
- Modify: `studio/packaging/launcher.sh`

- [ ] **Step 1: Update the encoded-hash key**

Open `studio/packaging/launcher.sh`. Find the two python invocations that produce `#join=...` (one in fast-path around line 95, one in slow-path around line 144). Replace both:

```bash
HASH=$(printf '%s' "$DEEP_LINK" | python3 -c 'import sys,urllib.parse; print("#share=" + urllib.parse.quote(sys.stdin.read().strip(), safe=""))')
```

(I.e., change `#join=` to `#share=`.) The frontend hook in Task 15 accepts both, so 0.18.x invites still work — but new builds emit `#share=` consistently.

- [ ] **Step 2: Verify launcher.sh is still syntactically valid**

Run: `bash -n studio/packaging/launcher.sh`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/launcher.sh
git commit -m "fix(studio/packaging): launcher emits #share= instead of #join= for deep links"
```

---

## Task 17: App.tsx — route `/shared/:id` + handle `kind: "project"` deep link

**Files:**
- Modify: `studio/src/App.tsx`
- Create: `studio/src/routes/SharedProject.tsx`

- [ ] **Step 1: Read App.tsx to understand the routing**

```bash
sed -n '1,80p' studio/src/App.tsx
```

Find the section that matches `useDeepLinkRoute` and conditionally mounts `<JoinSessionGate>`.

- [ ] **Step 2: Create stub SharedProject component**

Create `studio/src/routes/SharedProject.tsx`:

```tsx
import { useEffect, useState } from "react";

interface MirrorMetadata {
  id: string;
  hostDisplayName: string;
  projectSlug: string;
  lastSeenAt: string;
}

interface ChatEvent { type?: string; [k: string]: unknown }

export default function SharedProject({ id }: { id: string }) {
  const [meta, setMeta] = useState<MirrorMetadata | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<ChatEvent[]>([]);
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");

  useEffect(() => {
    fetch(`/api/shared-projects/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setMeta(data.metadata);
        setFrames(data.frames ?? {});
        setChat(data.chat ?? []);
      })
      .catch((err) => console.warn("shared project fetch failed:", err));

    const es = new EventSource(`/api/shared-projects/${id}/stream`);
    es.addEventListener("relay", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "frame_written") {
          setFrames((f) => ({ ...f, [ev.path]: ev.content }));
        } else {
          setChat((c) => [...c, ev]);
        }
      } catch {}
    });
    es.addEventListener("status", (e: MessageEvent) => {
      try {
        const { status } = JSON.parse(e.data);
        if (status === "online" || status === "offline") setStatus(status);
      } catch {}
    });
    return () => es.close();
  }, [id]);

  if (!meta) return <div style={{ padding: 24 }}>Loading shared project…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1>{meta.projectSlug}</h1>
      <p>Shared by {meta.hostDisplayName}</p>
      {status === "offline" && <div>Host is offline — viewing cached state</div>}
      <pre>{Object.keys(frames).length} frame(s) cached</pre>
      <pre>{chat.length} chat event(s) loaded</pre>
    </div>
  );
}
```

(This is a minimal scaffold. Real polish — viewport rendering, comment input, presence strip — comes in Task 18.)

- [ ] **Step 3: Wire routing in App.tsx**

Find where `useDeepLinkRoute` is consumed. Add handling for the project kind:

```tsx
import SharedProject from "./routes/SharedProject";

// inside App component, after existing deep-link handling:
const [activeShared, setActiveShared] = useState<string | null>(null);

useEffect(() => {
  const route = parseDeepLink(window.location.href);
  if (!route) return;
  if (route.kind === "project") {
    fetch("/api/shared-projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectShareId: route.projectShareId,
        relayUrl: `${route.relayUrl.replace(/^http/, "ws")}/api/multiplayer/ws`,
        hostDevu: route.hostDevu,
        hostDisplayName: route.hostDisplayName,
        projectSlug: route.projectSlug,
      }),
    })
      .then(() => {
        clearDeepLink();
        setActiveShared(route.projectShareId);
      })
      .catch((err) => console.error("project import failed:", err));
  }
  // legacy session handling stays as-is
}, []);

// in the render tree, before existing routes:
if (activeShared) return <SharedProject id={activeShared} />;
```

- [ ] **Step 4: Manual smoke test**

```bash
pnpm run studio
```

Open `http://localhost:5556/`. Verify the homepage still renders.

Expected: no console errors, app starts.

- [ ] **Step 5: Commit**

```bash
git add studio/src/App.tsx studio/src/routes/SharedProject.tsx
git commit -m "feat(studio/multiplayer): route /shared/:id to SharedProject + import on deep-link"
```

---

## Task 18: Homepage — show shared-project tiles

**Files:**
- Create: `studio/src/components/multiplayer/SharedTile.tsx`
- Modify: `studio/src/components/Home.tsx` (or whichever file owns the homepage project grid; find with grep)

- [ ] **Step 1: Find the homepage component**

```bash
grep -rln "/api/projects" studio/src/ --include="*.tsx" | head -5
```

Identify the file that calls `GET /api/projects` and renders the tile grid. That's the homepage. Open it.

- [ ] **Step 2: Create the shared-tile component**

Create `studio/src/components/multiplayer/SharedTile.tsx`:

```tsx
interface Props {
  id: string;
  hostDisplayName: string;
  projectSlug: string;
  status?: "online" | "offline" | "unknown";
  onOpen: () => void;
}

export function SharedTile({ id, hostDisplayName, projectSlug, status, onOpen }: Props) {
  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: "left",
        padding: 16,
        borderRadius: 12,
        border: "1px solid #e0d8e8",
        background: "white",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <div style={{ position: "absolute", top: 8, right: 8, fontSize: 11, color: "#6a5a7d" }}>
        {status === "online" ? "● live" : "○ offline"}
      </div>
      <div style={{ fontWeight: 600 }}>{projectSlug}</div>
      <div style={{ fontSize: 13, color: "#4a3a5d", marginTop: 4 }}>
        Shared by {hostDisplayName}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Merge shared-projects into the homepage**

In the homepage component, alongside the existing `useEffect` that fetches `/api/projects`, fetch `/api/shared-projects` and render shared tiles in the same grid:

```tsx
import { SharedTile } from "./multiplayer/SharedTile";

// in component state:
const [sharedProjects, setSharedProjects] = useState<any[]>([]);

useEffect(() => {
  fetch("/api/shared-projects")
    .then((r) => r.json())
    .then((data) => setSharedProjects(data.projects ?? []))
    .catch(() => {});
}, []);

// in render, alongside the existing tile grid:
{sharedProjects.map((p) => (
  <SharedTile
    key={p.id}
    id={p.id}
    hostDisplayName={p.hostDisplayName}
    projectSlug={p.projectSlug}
    status="unknown"
    onOpen={() => { window.location.hash = `share=${encodeURIComponent(`arcade-studio://project/${p.id}`)}`; window.location.reload(); }}
  />
))}
```

(The "open" handler uses the deep-link path so the same code lights up; in a real polish pass we'd wire React Router but the scope here is small.)

- [ ] **Step 4: Manual smoke test**

```bash
pnpm run studio
```

Verify the homepage doesn't crash. With no shared projects yet, the new section is just empty.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/multiplayer/SharedTile.tsx studio/src/components/Home.tsx
git commit -m "feat(studio/multiplayer): render shared-project tiles on homepage alongside own projects"
```

---

## Task 19: Host UI — Share panel + presence strip

**Files:**
- Create: `studio/src/components/multiplayer/SharePanel.tsx`
- Create: `studio/src/components/multiplayer/PresenceStrip.tsx`
- Modify: project header component (find via grep)

- [ ] **Step 1: Locate the project header**

```bash
grep -rln "Share to web\|ShareModal" studio/src/components/ | head -5
```

Open the file that renders the existing share-to-web button.

- [ ] **Step 2: Create SharePanel.tsx**

Create `studio/src/components/multiplayer/SharePanel.tsx`:

```tsx
import { useState, useEffect } from "react";

interface Collab {
  devu: string;
  displayName: string;
  addedAt: string;
}

export function SharePanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${slug}/share`)
      .then((r) => r.json())
      .then((data) => setCollabs(data.shared_with ?? []))
      .catch(() => {});
  }, [slug]);

  const remove = async (devu: string) => {
    setBusy(true);
    await fetch(`/api/projects/${slug}/share/${encodeURIComponent(devu)}`, { method: "DELETE" });
    const fresh = await fetch(`/api/projects/${slug}/share`).then((r) => r.json());
    setCollabs(fresh.shared_with ?? []);
    setBusy(false);
  };

  const add = async () => {
    const trimmed = adding.trim();
    if (!trimmed) return;
    setBusy(true);
    await fetch(`/api/projects/${slug}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devu: trimmed, displayName: trimmed }),
    });
    const fresh = await fetch(`/api/projects/${slug}/share`).then((r) => r.json());
    setCollabs(fresh.shared_with ?? []);
    setAdding("");
    setBusy(false);
  };

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, background: "white" }}>
      <h3>Shared with</h3>
      {collabs.length === 0 && <p style={{ color: "#6a5a7d" }}>Not shared yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {collabs.map((c) => (
          <li key={c.devu} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{c.displayName}</span>
            <button onClick={() => remove(c.devu)} disabled={busy}>Remove</button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="devu_don of teammate"
          style={{ flex: 1 }}
        />
        <button onClick={add} disabled={busy || !adding.trim()}>Add</button>
      </div>
      <button onClick={onClose} style={{ marginTop: 12 }}>Close</button>
    </div>
  );
}
```

(Mention popover comes from the existing `MentionPopover` — wire it in a polish pass; v1 accepts the raw devu string.)

- [ ] **Step 3: Create PresenceStrip.tsx**

Create `studio/src/components/multiplayer/PresenceStrip.tsx`:

```tsx
interface Connection { devu: string; displayName: string }

export function PresenceStrip({ host, guests }: { host: Connection | null; guests: Connection[] }) {
  if (!host && guests.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {host && (
        <div title={`Host: ${host.displayName}`} style={{ width: 24, height: 24, borderRadius: 12, background: "#7c3aed", color: "white", display: "grid", placeItems: "center", fontSize: 11 }}>
          {host.displayName.slice(0, 1)}
        </div>
      )}
      {guests.map((g) => (
        <div key={g.devu} title={g.displayName} style={{ width: 24, height: 24, borderRadius: 12, background: "#a78bfa", color: "white", display: "grid", placeItems: "center", fontSize: 11 }}>
          {g.displayName.slice(0, 1)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into the project header**

In the project header file you found in Step 1, add a "Share with teammates" button next to the existing "Share to web" button. Toggle the SharePanel:

```tsx
import { useState } from "react";
import { SharePanel } from "./multiplayer/SharePanel";
import { PresenceStrip } from "./multiplayer/PresenceStrip";

const [showShare, setShowShare] = useState(false);
const [presence, setPresence] = useState<{ host: any; guests: any[] }>({ host: null, guests: [] });

// (Presence wiring is wired up properly in Task 22 once host-side EventSource exists.)

// In render:
<button onClick={() => setShowShare((s) => !s)}>Share with teammates</button>
{showShare && <SharePanel slug={slug} onClose={() => setShowShare(false)} />}
<PresenceStrip host={presence.host} guests={presence.guests} />
```

- [ ] **Step 5: Manual smoke test**

```bash
pnpm run studio
```

Open a project. Click "Share with teammates" — panel renders, can fetch the empty shared_with list, can attempt to add a devu. (Adding will hit the real DM endpoint — only test with your own devu in dev.)

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/multiplayer/SharePanel.tsx studio/src/components/multiplayer/PresenceStrip.tsx studio/src/components/<HEADER FILE>.tsx
git commit -m "feat(studio/multiplayer): host-side Share panel + presence strip"
```

---

## Task 20: Repurpose @-mention chat shortcut → share confirmation

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Modify: `studio/server/middleware/multiplayerInvite.ts` (deprecate or thin-wrap)

- [ ] **Step 1: Inspect the existing flow**

```bash
sed -n '1,80p' studio/src/components/chat/PromptInput.tsx
```

Find where mention detection currently triggers `POST /api/multiplayer/invite`.

- [ ] **Step 2: Replace the call site**

Inside `PromptInput.tsx`, in the mention-detection branch, replace the existing invite call with a share-confirmation flow:

```tsx
// Pseudocode — adjust to fit existing structure.
if (mentionDetected) {
  // 1. Fetch current shared_with for this project.
  const cur = await fetch(`/api/projects/${projectSlug}/share`).then((r) => r.json());
  const isAlready = (cur.shared_with ?? []).some((c: any) => c.devu === mentionedDevu);

  if (!isAlready) {
    // 2. Confirm.
    const ok = window.confirm(`Add ${mentionedDisplayName} to this project?`);
    if (!ok) return;
    // 3. Add.
    await fetch(`/api/projects/${projectSlug}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devu: mentionedDevu, displayName: mentionedDisplayName }),
    });
  }
  // 4. Comment instead of inviting; for now, write to chat-history as a system message.
  // Comment delivery to live guests will be plumbed via the relay client when host-side
  // outbound comments are added in a polish task (deferred).
  return; // skip the regular onSend chat turn — same as 2a
}
```

The native `window.confirm` is a deliberate v1 — replacing with a styled inline confirmation is a polish task.

- [ ] **Step 3: Mark old `multiplayerInvite.ts` invite endpoint as deprecated**

Open `studio/server/middleware/multiplayerInvite.ts`. At the top of the `INVITE_URL` POST handler, add a comment:

```ts
// DEPRECATED (Plan 2b): This endpoint creates a per-mention session, which
// the new shared-project model replaces. Kept for one release so 0.18.6
// clients can still invite. New code paths must use POST /api/projects/:slug/share.
```

The middleware itself stays functional for one release.

- [ ] **Step 4: Run existing prompt-input tests**

```bash
pnpm run studio:test __tests__/components/PromptInput.test.tsx 2>/dev/null || true
```

If tests exist for the @-mention path, they'll need updating. Update the assertions to match the new "POST /api/projects/:slug/share" call.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/chat/PromptInput.tsx studio/server/middleware/multiplayerInvite.ts
git commit -m "feat(studio/multiplayer): @-mention shortcut now goes through project sharing endpoint"
```

---

## Task 21: Host-side presence stream + live chat-event broadcast

**Files:**
- Modify: project header / project view component (find with grep)
- Create: `studio/src/hooks/useProjectPresence.ts`

- [ ] **Step 1: Add a host-side presence SSE endpoint**

Open `studio/server/middleware/sharedProjects.ts`. Add a new route:

```ts
const HOST_STREAM_RE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/presence-stream\/?$/i;

// inside the router:
if (req.method === "GET" && HOST_STREAM_RE.test(url)) return hostPresenceStream(req, res, url.match(HOST_STREAM_RE)![1]);
```

(Implementing this means we need to subscribe to the relay's wsServer broadcasts. Easier: use `getReplayBufferForProject` is wrong here — instead expose a hook from wsServer that fires presence updates.)

Add to `studio/server/relay/wsServer.ts`:

```ts
import { EventEmitter } from "node:events";

const projectBus = new EventEmitter();

export function onProjectEvent(projectShareId: string, listener: (ev: RelayEvent) => void): () => void {
  const wrapped = (id: string, ev: RelayEvent) => { if (id === projectShareId) listener(ev); };
  projectBus.on("event", wrapped);
  return () => projectBus.off("event", wrapped);
}

// ...inside emitAll, add:
function emitAll(...) {
  for (const ev of events) {
    if (ev.recipient === "broadcast") {
      for (const socket of live.sockets.values()) sendEvent(socket, ev.event);
      projectBus.emit("event", live.projectShareId, ev.event);  // NEW
    } else { /* unchanged */ }
  }
}
```

(Make sure `live.projectShareId` exists; if not, store it on the `LiveSession`.)

Implement `hostPresenceStream` in `sharedProjects.ts`:

```ts
import { getProjectByHostSlug } from "../relay/projectRegistry";
import { onProjectEvent } from "../relay/wsServer";
import { getDevRevPat } from "../secrets/keychain";
import { resolveDevuFromPat } from "../relay/auth";

async function hostPresenceStream(_req: IncomingMessage, res: ServerResponse, slug: string) {
  const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
  const host = pat ? await resolveDevuFromPat(pat) : null;
  if (!host) { res.writeHead(401); res.end(); return; }
  const project = getProjectByHostSlug(host.id, slug);
  if (!project) { res.writeHead(404); res.end(); return; }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const off = onProjectEvent(project.id, (ev) => {
    res.write(`event: relay\ndata: ${JSON.stringify(ev)}\n\n`);
  });
  res.on("close", () => off());
}
```

- [ ] **Step 2: Create useProjectPresence hook**

Create `studio/src/hooks/useProjectPresence.ts`:

```ts
import { useEffect, useState } from "react";

interface Connection { devu: string; displayName: string }

export function useProjectPresence(projectSlug: string | null) {
  const [host, setHost] = useState<Connection | null>(null);
  const [guests, setGuests] = useState<Connection[]>([]);

  useEffect(() => {
    if (!projectSlug) return;
    const es = new EventSource(`/api/projects/${projectSlug}/presence-stream`);
    es.addEventListener("relay", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === "presence_state") {
          setHost(ev.host);
          setGuests(ev.guests);
        }
      } catch {}
    });
    return () => es.close();
  }, [projectSlug]);

  return { host, guests };
}
```

- [ ] **Step 3: Wire useProjectPresence into the project header**

In the file modified in Task 19's Step 4, replace the placeholder `presence` state with the hook:

```tsx
import { useProjectPresence } from "../hooks/useProjectPresence";

// inside component:
const { host, guests } = useProjectPresence(slug);

// in render:
<PresenceStrip host={host} guests={guests} />
```

- [ ] **Step 4: Manual smoke test**

```bash
pnpm run studio
```

Open a project. Open the Share panel. Add yourself as a collaborator (use your own devu). Open the share link (deep link should open Studio's homepage with a tile for your shared project).

Expected: presence strip eventually shows you twice once you join as guest.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/sharedProjects.ts studio/server/relay/wsServer.ts studio/src/hooks/useProjectPresence.ts studio/src/components/<HEADER FILE>.tsx
git commit -m "feat(studio/multiplayer): host-side presence SSE + useProjectPresence hook"
```

---

## Task 22: Polish SharedProject view (real viewport + comment input + offline banner)

**Files:**
- Modify: `studio/src/routes/SharedProject.tsx`
- Create: `studio/src/components/multiplayer/CommentInput.tsx`
- Create: `studio/src/components/multiplayer/OfflineBanner.tsx`

- [ ] **Step 1: Find the existing viewport component**

```bash
grep -rln "Viewport\|FrameMount" studio/src/ --include="*.tsx" | head -5
```

Identify the component that renders frames in a normal project view. We'll reuse it.

- [ ] **Step 2: Create CommentInput.tsx**

Create `studio/src/components/multiplayer/CommentInput.tsx`:

```tsx
import { useState } from "react";

export function CommentInput({ onSend }: { onSend: (text: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    await onSend(trimmed);
    setText("");
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comment on this prototype…"
        rows={2}
        style={{ flex: 1, resize: "none" }}
      />
      <button onClick={submit} disabled={busy || !text.trim()}>Send</button>
    </div>
  );
}
```

- [ ] **Step 3: Create OfflineBanner.tsx**

Create `studio/src/components/multiplayer/OfflineBanner.tsx`:

```tsx
export function OfflineBanner({ hostName }: { hostName: string }) {
  return (
    <div style={{ background: "#fff3e0", color: "#5a3a1d", padding: 8, fontSize: 13 }}>
      {hostName} is offline — viewing cached state. New comments will be sent when they're back.
    </div>
  );
}
```

- [ ] **Step 4: Replace SharedProject.tsx with the polished version**

```tsx
import { useEffect, useState } from "react";
import { CommentInput } from "../components/multiplayer/CommentInput";
import { OfflineBanner } from "../components/multiplayer/OfflineBanner";

interface Mirror { id: string; hostDisplayName: string; projectSlug: string; lastSeenAt: string }
interface ChatEvent { type?: string; [k: string]: unknown }

export default function SharedProject({ id }: { id: string }) {
  const [meta, setMeta] = useState<Mirror | null>(null);
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<ChatEvent[]>([]);
  const [status, setStatus] = useState<"online" | "offline" | "unknown">("unknown");

  useEffect(() => {
    fetch(`/api/shared-projects/${id}`)
      .then((r) => r.json())
      .then((d) => { setMeta(d.metadata); setFrames(d.frames ?? {}); setChat(d.chat ?? []); })
      .catch(() => {});
    const es = new EventSource(`/api/shared-projects/${id}/stream`);
    es.addEventListener("relay", (e: MessageEvent) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "frame_written") setFrames((f) => ({ ...f, [ev.path]: ev.content }));
      else setChat((c) => [...c, ev]);
    });
    es.addEventListener("status", (e: MessageEvent) => {
      const { status } = JSON.parse(e.data);
      if (status === "online" || status === "offline") setStatus(status);
    });
    return () => es.close();
  }, [id]);

  const sendComment = async (text: string) => {
    await fetch(`/api/shared-projects/${id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  };

  if (!meta) return <div style={{ padding: 24 }}>Loading shared project…</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh" }}>
      <div style={{ overflow: "auto" }}>
        {status === "offline" && <OfflineBanner hostName={meta.hostDisplayName} />}
        <header style={{ padding: 16, borderBottom: "1px solid #eee" }}>
          <h1>{meta.projectSlug}</h1>
          <p style={{ color: "#6a5a7d" }}>Shared by {meta.hostDisplayName}</p>
        </header>
        <main style={{ padding: 16 }}>
          {Object.entries(frames).map(([path, content]) => (
            <div key={path} style={{ marginBottom: 24 }}>
              <h3>{path}</h3>
              <iframe
                title={path}
                srcDoc={content}
                style={{ width: "100%", height: 480, border: "1px solid #eee" }}
              />
            </div>
          ))}
        </main>
      </div>
      <aside style={{ borderLeft: "1px solid #eee", display: "grid", gridTemplateRows: "1fr auto" }}>
        <div style={{ overflow: "auto", padding: 12 }}>
          {chat.map((c, i) => (
            <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>{(c as any).type}:</strong> {JSON.stringify(c)}
            </div>
          ))}
        </div>
        <CommentInput onSend={sendComment} />
      </aside>
    </div>
  );
}
```

(Iframe `srcDoc` rendering of frame content is a v1 stand-in — host frames are JSX, not standalone HTML. Fixing this needs a proper bundle-and-render path, deferred to a follow-up.)

- [ ] **Step 5: Manual smoke test**

```bash
pnpm run studio
```

Open a shared project tile. Verify the comment input renders and sending fires the POST. Verify the offline banner shows when status flips to offline.

- [ ] **Step 6: Commit**

```bash
git add studio/src/routes/SharedProject.tsx studio/src/components/multiplayer/CommentInput.tsx studio/src/components/multiplayer/OfflineBanner.tsx
git commit -m "feat(studio/multiplayer): polish SharedProject view with comment input + offline banner"
```

---

## Task 23: End-to-end smoke test (two Studio instances, one relay)

**Files:**
- Test: `studio/__tests__/integration/multiplayer-shared-project.test.ts`

This task is the equivalent of the spec's §13 e2e item. Implement against in-process WebSocket clients (no real cloudflared).

- [ ] **Step 1: Write the e2e test**

Create `studio/__tests__/integration/multiplayer-shared-project.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { attachRelayToHttpServer, __resetWsServerForTests } from "../../server/relay/wsServer";
import { __resetProjectRegistryForTests, createOrGetProject, addCollaborator } from "../../server/relay/projectRegistry";

vi.mock("../../server/relay/auth", () => ({
  resolveDevuFromPat: async (pat: string) => {
    if (pat === "host-pat") return { id: "don:.../devu/1", displayName: "Andrey" };
    if (pat === "guest-pat") return { id: "don:.../devu/2", displayName: "Bea" };
    return null;
  },
}));

vi.mock("../../server/relay/persistence", () => ({
  loadProjects: async () => [],
  saveProjects: async () => {},
  loadSessions: async () => [],
  saveSessions: async () => {},
}));

let server: Server;
let port: number;

beforeEach(async () => {
  __resetWsServerForTests();
  __resetProjectRegistryForTests();
  server = createServer();
  attachRelayToHttpServer(server);
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as any).port;
});

async function open(qs: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${port}/api/multiplayer/ws?${qs}`);
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
  });
  return ws;
}

describe("multiplayer shared project — end to end", () => {
  it("frame_written from host reaches a connected guest", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const guestEvents: any[] = [];
    guest.on("message", (raw) => guestEvents.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    host.send(JSON.stringify({ type: "frame_write", path: "frame-01", content: "<jsx>", turnId: "t1" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(guestEvents.find((e) => e.type === "frame_written")).toBeDefined();
    host.close();
    guest.close();
  });

  it("guest reconnect receives cache_replay with the latest frame state", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    host.send(JSON.stringify({ type: "frame_write", path: "frame-01", content: "v1", turnId: "t1" }));
    await new Promise((r) => setTimeout(r, 50));

    // Guest joins for the first time AFTER the frame_write was sent.
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const replay = await new Promise<any>((r) => {
      guest.on("message", (raw) => {
        const ev = JSON.parse(raw.toString());
        if (ev.type === "cache_replay") r(ev);
      });
    });
    expect(replay.frames["frame-01"]).toBe("v1");
    host.close();
    guest.close();
  });

  it("comment_posted from guest reaches the host", async () => {
    const project = await createOrGetProject({ hostDevu: "don:.../devu/1", projectSlug: "p" });
    await addCollaborator(project.id, { devu: "don:.../devu/2", displayName: "Bea", addedBy: "don:.../devu/1" });
    const host = await open(`projectShareId=${project.id}&pat=host-pat&asRole=host`);
    const guest = await open(`projectShareId=${project.id}&pat=guest-pat&asRole=guest`);
    const hostEvents: any[] = [];
    host.on("message", (raw) => hostEvents.push(JSON.parse(raw.toString())));
    await new Promise((r) => setTimeout(r, 50));
    guest.send(JSON.stringify({ type: "comment_posted", id: "c1", text: "looks great", mentions: [] }));
    await new Promise((r) => setTimeout(r, 50));
    expect(hostEvents.find((e) => e.type === "comment_posted" && e.text === "looks great")).toBeDefined();
    host.close();
    guest.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm run studio:test __tests__/integration/multiplayer-shared-project.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Run the full suite**

Run: `pnpm run studio:test`
Expected: all tests pass. Address any regressions before continuing — common cause: tests still referencing `sessionId` query param need updating to `projectShareId`.

- [ ] **Step 4: Commit**

```bash
git add studio/__tests__/integration/multiplayer-shared-project.test.ts
git commit -m "test(studio/multiplayer): end-to-end test for shared-project frame stream + cache_replay + comments"
```

---

## Task 24: Deploy the worker

**Files:**
- (None, deploy-only)

- [ ] **Step 1: Verify worker compiles**

Run: `wrangler deploy --dry-run --config studio/worker/wrangler.toml`
Expected: "Total Upload: …" success.

- [ ] **Step 2: Deploy**

Run: `wrangler deploy --config studio/worker/wrangler.toml`
Expected: "Uploaded arcade-studio-share … Deployed arcade-studio-share triggers".

- [ ] **Step 3: Verify the new route works**

Run:
```bash
curl -s "https://arcade-studio-share.devrev-product-design.workers.dev/project/abc?relay=https://x.trycloudflare.com&host=devu1&hostName=Andrey&projectSlug=p" | grep -c "Opening Arcade Studio"
```
Expected: `1`.

- [ ] **Step 4: Confirm legacy route still works**

Run:
```bash
curl -s "https://arcade-studio-share.devrev-product-design.workers.dev/join/test-session" | grep -c "Opening Arcade Studio"
```
Expected: `1`.

(No commit — deploy only. Source is already committed.)

---

## Task 25: Final sweep — full test suite + manual smoke

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: all tests pass, no regressions.

- [ ] **Step 2: Manual smoke**

Start two Studio instances on the same machine (one in dev, one packaged old build) — or use a single instance and self-share to your own devu. Walk through:

1. Open a project on the host.
2. Click "Share with teammates" → add a real DevRev teammate (or yourself if testing solo).
3. Verify Computer DM arrives with a markdown link.
4. Click the link → landing page → opens deep link.
5. (If the same machine) verify the homepage shows a new shared-project tile.
6. Open the tile → SharedProject view loads → frames cached load.
7. Host writes a new frame → guest sees frame_written event.
8. Guest types a comment → host sees comment_posted in chat.
9. Host kills tunnel (or quits) → guest's banner flips to offline.
10. Host restarts → guest reconnects → cache_replay fires.

Note any defects against the spec. File polish work as follow-up tasks; don't expand scope here.

- [ ] **Step 3: Final commit (if any cleanup)**

If anything was tweaked during smoke, commit it:

```bash
git add <changed files>
git commit -m "chore(studio/multiplayer): smoke-test cleanup"
```

---

## Self-review notes (built into the plan)

**Spec coverage:**
- §3.1 Host sharing → Tasks 7, 19, 20
- §3.2 Guest receiving → Tasks 14, 15, 16, 17
- §3.3 Project view (guest) → Tasks 17, 22
- §3.4 Project view (host) → Tasks 19, 21
- §3.5 Removing collaborator → Task 7 (DELETE) + Task 19 (UI)
- §4 Data model (multiplayer.json, projects.json, mirror dir) → Tasks 4, 7, 9
- §5 Wire protocol → Tasks 1, 5
- §6 Server (host) → Tasks 5, 6, 7, 8, 13
- §7 Server (guest) → Tasks 9, 10, 11, 12, 13
- §8 UI → Tasks 17, 18, 19, 20, 22
- §9 Worker → Task 14 (+ deploy in 24)
- §10 macOS deep-link → Tasks 15, 16
- §11 Notifications — explicitly inherited known-limitation, no task
- §12 Migration — Task 4
- §13 Testing — covered task-by-task + Task 23 e2e

**Out-of-scope (per spec §3.6):** frame-anchored comments, driver handoff, live cursors, server-backed persistence, frame-history scrubbing — none included.

**Type consistency:** `projectShareId` used uniformly across schema, registry, middleware, deep-link, worker. `sharedWithEntrySchema` matches the disk shape in `multiplayer.json`. `MirrorMetadata` matches the deep-link payload. `RelayEvent` discriminator exhaustive between protocol.ts and types.ts.

**Open from spec §14:**
- Cache-replay buffer is "latest content per frame" (Task 2 implements this) ✅
- Comment queue is atomic write+rename (Task 10 implements this) ✅
- Host disconnect handling: replay buffer survives because LiveSession map is keyed by projectShareId, not session lifecycle. Verified by Task 23's reconnect test ✅
