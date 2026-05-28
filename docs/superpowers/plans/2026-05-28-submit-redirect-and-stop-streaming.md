# Submit-redirect + Stop-streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hero submit instantly redirect to the new project's chat screen, and add a Stop button that cancels a running agent turn.

**Architecture:** Optimistic nav with a small in-memory pending-prompt handoff bucket; server-side cancellation via `AbortController` plumbed through the turn registry to subprocess `signal`s. Cancelled turns get their own discriminant (`cancelled`) so the UI renders a neutral marker rather than a red error banner.

**Tech Stack:** React 18, Vite middleware (Node http), TypeScript, Vitest, Zod (relay schema). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-submit-redirect-and-stop-streaming-design.md`

---

## File Structure

**New files:**
- `studio/src/lib/pendingPrompt.ts` — module-level `Map<slug, PendingHeroPrompt>`. Owns the handoff between `HomePage.handleHeroSubmit` and `ProjectDetail` mount.
- `studio/__tests__/lib/pendingPrompt.test.ts` — set/take/clear behaviour.
- `studio/__tests__/server/turnRegistry-cancel.test.ts` — server cancel state transitions.
- `studio/__tests__/server/chat-cancel.test.ts` — `POST /api/chat/cancel/:slug` middleware.
- `studio/__tests__/hooks/useChatStream-cancel.test.ts` — client cancel POST + reducer fallout.
- `studio/__tests__/components/PromptInput-stop.test.tsx` — Stop button rendering + click.

**Modified files:**
- `studio/src/lib/streamJson.ts` — extend `end` event with `cancelled?: boolean`.
- `studio/server/turnRegistry.ts` — `cancelled` status, `cancelTurn(slug)`, plumb signal into `init.run`.
- `studio/server/middleware/chat.ts` — wire `AbortController` into runners; new `cancel` route; mirror `turn_ended.cancelled`.
- `studio/server/relay/types.ts` — `turn_ended.cancelled?: boolean`.
- `studio/src/lib/api.ts` — `cancelTurn(slug)`.
- `studio/src/hooks/chatStreamReducer.ts` — `cancelled` phase + handle terminal `cancelled` event.
- `studio/src/hooks/useChatStream.ts` — expose `cancel()`.
- `studio/src/components/chat/PromptInput.tsx` — render `StopButton` while busy; thread `onStop`.
- `studio/src/components/chat/ChatPane.tsx` — pass `onStop={cancel}` when running.
- `studio/src/components/chat/MessageList.tsx` — render `cancelled` phase indicator.
- `studio/src/routes/HomePage.tsx` — drop pre-nav `startChatTurn`; stash pending prompt; nav after `createProject`.
- `studio/src/routes/ProjectDetail.tsx` — author wrapper consumes pending prompt on mount and triggers `chatStream.send`.
- `studio/server/middleware/projectSharing.ts` (or wherever `turn_ended` is emitted server-side from cancel context — only edit if discovered during Task 8).

---

## Task 1: Pending-prompt bucket

**Files:**
- Create: `studio/src/lib/pendingPrompt.ts`
- Test: `studio/__tests__/lib/pendingPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/lib/pendingPrompt.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  setPendingPrompt,
  takePendingPrompt,
  clearPendingPrompt,
  __resetPendingPromptForTests,
} from "../../src/lib/pendingPrompt";

describe("pendingPrompt", () => {
  beforeEach(() => {
    __resetPendingPromptForTests();
  });

  it("returns undefined when no pending prompt is set", () => {
    expect(takePendingPrompt("missing")).toBeUndefined();
  });

  it("set then take returns the value once and clears it", () => {
    setPendingPrompt("alpha", { prompt: "hi", imagePaths: [], figmaUrl: null });
    const first = takePendingPrompt("alpha");
    expect(first).toEqual({ prompt: "hi", imagePaths: [], figmaUrl: null });
    const second = takePendingPrompt("alpha");
    expect(second).toBeUndefined();
  });

  it("clearPendingPrompt removes without consuming", () => {
    setPendingPrompt("beta", {
      prompt: "p",
      imagePaths: ["/tmp/x.png"],
      figmaUrl: "https://figma.com/abc",
    });
    clearPendingPrompt("beta");
    expect(takePendingPrompt("beta")).toBeUndefined();
  });

  it("each slug has its own slot", () => {
    setPendingPrompt("a", { prompt: "A", imagePaths: [], figmaUrl: null });
    setPendingPrompt("b", { prompt: "B", imagePaths: [], figmaUrl: null });
    expect(takePendingPrompt("b")?.prompt).toBe("B");
    expect(takePendingPrompt("a")?.prompt).toBe("A");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/pendingPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// studio/src/lib/pendingPrompt.ts
export interface PendingHeroPrompt {
  prompt: string;
  imagePaths: string[];
  figmaUrl: string | null;
}

const bucket = new Map<string, PendingHeroPrompt>();

export function setPendingPrompt(slug: string, value: PendingHeroPrompt): void {
  bucket.set(slug, value);
}

/** Read-and-remove. Returns undefined if no pending prompt for this slug. */
export function takePendingPrompt(slug: string): PendingHeroPrompt | undefined {
  const value = bucket.get(slug);
  if (value !== undefined) bucket.delete(slug);
  return value;
}

export function clearPendingPrompt(slug: string): void {
  bucket.delete(slug);
}

export function __resetPendingPromptForTests(): void {
  bucket.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test studio/__tests__/lib/pendingPrompt.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/pendingPrompt.ts \
        studio/__tests__/lib/pendingPrompt.test.ts
git commit -m "feat(studio/home): pending-prompt handoff bucket"
```

---

## Task 2: Hero submit stashes prompt + navigates first

**Files:**
- Modify: `studio/src/routes/HomePage.tsx`

- [ ] **Step 1: Update `handleHeroSubmit`**

Replace the existing `handleHeroSubmit` body (lines ~64–117) with:

```tsx
async function handleHeroSubmit(args: HeroPromptSubmitArgs) {
  if (submitting) return;
  setSubmitting(true);
  try {
    const name = deriveProjectName(args.prompt);
    const project = await api.createProject({
      name,
      theme: "arcade",
      mode: "light",
    });

    setPendingPrompt(project.slug, {
      prompt: args.prompt,
      imagePaths: args.imagePaths,
      figmaUrl: args.figmaUrl,
    });

    void refresh();
    onOpen(project.slug);
  } catch (e) {
    toast({
      title: "Failed to create project",
      description: e instanceof Error ? e.message : String(e),
      intent: "alert",
    });
  } finally {
    setSubmitting(false);
  }
}
```

Add the import at the top of the file:

```tsx
import { setPendingPrompt } from "../lib/pendingPrompt";
```

Drop the now-unused imports if they have no other consumer in the file:

```tsx
// Remove if no longer referenced anywhere in HomePage.tsx:
//   - deriveProjectName: still used (kept).
//   - decoratePromptWithFigma: REMOVE — no longer called here.
```

Verify by searching the file: only the `handleHeroSubmit` body referenced `decoratePromptWithFigma`. After the edit, remove its import line:

```tsx
// Delete this line at the top:
import { decoratePromptWithFigma } from "../lib/figmaUrl";
```

- [ ] **Step 2: Manually verify the file builds**

Run: `pnpm exec tsc --noEmit -p studio/tsconfig.json`
Expected: no new TS errors.

- [ ] **Step 3: Commit**

```bash
git add studio/src/routes/HomePage.tsx
git commit -m "feat(studio/home): redirect to project after createProject, stash prompt"
```

---

## Task 3: ProjectDetail consumes pending prompt on mount

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`

The author wrapper (`ProjectDetailAuthor`) is the right place — only the host fires turns, and `chatStream.send` is on the host's stream.

- [ ] **Step 1: Add the consumer hook**

In `ProjectDetail.tsx`, after the imports near the top, add:

```tsx
import { takePendingPrompt } from "../lib/pendingPrompt";
import { decoratePromptWithFigma } from "../lib/figmaUrl";
import { api } from "../lib/api";
```

Replace the body of `ProjectDetailAuthor` with:

```tsx
function ProjectDetailAuthor({
  slug,
  onBack,
  onOpenProject,
}: {
  slug: string;
  onBack: () => void;
  onOpenProject: (slug: string) => void;
}) {
  const source = useProjectFromHost(slug);
  const send = source.send;
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    if (!send) return;
    const pending = takePendingPrompt(slug);
    if (!pending) return;
    consumedRef.current = true;

    let cancelled = false;
    (async () => {
      let images = pending.imagePaths;
      if (images.length > 0) {
        try {
          const adoption = await api.adoptUploads(slug, images);
          images = images.map((old) => adoption.mapping[old] ?? old);
        } catch {
          images = [];
        }
      }
      if (cancelled) return;
      const decorated = pending.figmaUrl
        ? decoratePromptWithFigma(pending.prompt, pending.figmaUrl)
        : pending.prompt;
      send(decorated, images);
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, send]);

  return (
    <ProjectDetailShell
      mode="author"
      routeKey={slug}
      source={source}
      onBack={onBack}
      onOpenProject={onOpenProject}
    />
  );
}
```

`useRef` and `useEffect` are already imported at the top of the file. If not, add them to the existing `react` import.

- [ ] **Step 2: Manually verify**

Run the dev server: `pnpm run studio`
- Type a prompt in the hero input.
- Submit.
- Expected: instant nav to the project page; agent narration starts within ~2s.

- [ ] **Step 3: Commit**

```bash
git add studio/src/routes/ProjectDetail.tsx
git commit -m "feat(studio/home): consume pending prompt on ProjectDetail mount"
```

---

## Task 4: Extend `StudioEvent.end` with `cancelled` discriminant

**Files:**
- Modify: `studio/src/lib/streamJson.ts`

- [ ] **Step 1: Update the type**

Replace the two `end` variants with three:

```ts
export type StudioEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "origin"; source: "claude" | "computer" }
  | { kind: "narration"; text: string }
  | {
      kind: "tool_call";
      tool: string;
      pretty: string;
      details?: string;
    }
  | {
      kind: "tool_result";
      tool: string;
      ok: boolean;
      snippet?: string;
    }
  | { kind: "end"; ok: true }
  | { kind: "end"; ok: false; error: string; cancelled?: boolean };
```

- [ ] **Step 2: Run the existing parser tests**

Run: `pnpm run studio:test studio/__tests__/lib/streamJson.test.ts`
Expected: PASS — no behavior change in the parser itself.

- [ ] **Step 3: Commit**

```bash
git add studio/src/lib/streamJson.ts
git commit -m "feat(studio/chat): add cancelled flag to StudioEvent end"
```

---

## Task 5: Turn registry — `cancelled` status + `cancelTurn`

**Files:**
- Modify: `studio/server/turnRegistry.ts`
- Test: `studio/__tests__/server/turnRegistry-cancel.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// studio/__tests__/server/turnRegistry-cancel.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  startTurn,
  cancelTurn,
  getTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";

describe("turnRegistry cancellation", () => {
  beforeEach(() => {
    __resetTurnRegistryForTests();
  });

  it("cancelTurn flips a running turn to cancelled and aborts its signal", () => {
    let abortReason: unknown;
    const turn = startTurn("alpha", {
      prompt: "hi",
      run: ({ signal }) => {
        signal.addEventListener("abort", () => {
          abortReason = signal.reason;
        });
        // never call end — registry will finalize via cancelTurn
      },
    });
    expect(turn.status).toBe("running");

    const ok = cancelTurn("alpha");
    expect(ok).toBe(true);

    const after = getTurn("alpha");
    expect(after?.status).toBe("cancelled");
    expect(abortReason).toBeDefined();
  });

  it("cancelTurn returns false when no turn is running", () => {
    expect(cancelTurn("missing")).toBe(false);
  });

  it("cancelled turns emit a terminal end event with cancelled:true", () => {
    const events: any[] = [];
    startTurn("beta", {
      prompt: "hi",
      run: ({ emit }) => {
        emit({ kind: "narration", text: "starting" });
        // never call end — registry finalizes via cancelTurn below
      },
    });
    const turn = getTurn("beta")!;
    turn.subscribers.add((ev) => events.push(ev));

    cancelTurn("beta");
    const last = events[events.length - 1];
    expect(last.kind).toBe("end");
    expect(last.ok).toBe(false);
    expect(last.cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm run studio:test studio/__tests__/server/turnRegistry-cancel.test.ts`
Expected: FAIL — `cancelTurn` not exported, `signal` not in run init.

- [ ] **Step 3: Update registry types**

In `studio/server/turnRegistry.ts`, change:

```ts
export type TurnStatus = "running" | "done" | "error" | "cancelled";

export interface Turn {
  slug: string;
  id: string;
  prompt: string;
  startedAt: number;
  endedAt?: number;
  status: TurnStatus;
  error?: string;
  cancelled?: boolean;
  events: StudioEvent[];
  subscribers: Set<(ev: StudioEvent) => void>;
  terminators: Set<() => void>;
  abortController: AbortController;
}

export interface StartTurnInit {
  prompt: string;
  run: (api: {
    emit: (ev: StudioEvent) => void;
    end: (result: { ok: boolean; error?: string }) => void;
    signal: AbortSignal;
  }) => void | Promise<void>;
}
```

- [ ] **Step 4: Update `startTurn` to allocate the controller and pass `signal`**

Inside `startTurn`, after building `turn` and before `init.run`:

```ts
const turn: Turn = {
  slug,
  id: randomId(),
  prompt: init.prompt,
  startedAt: Date.now(),
  status: "running",
  events: [],
  subscribers: new Set(),
  terminators: new Set(),
  abortController: new AbortController(),
};
turns.set(slug, turn);
```

In the `init.run` invocation, pass `signal`:

```ts
const ret = init.run({ emit, end, signal: turn.abortController.signal });
```

- [ ] **Step 5: Update `finalize` to accept a `cancelled` hint**

Replace `finalize`:

```ts
function finalize(
  turn: Turn,
  result: { ok: boolean; error?: string; cancelled?: boolean },
): void {
  if (turn.status !== "running") return;
  if (result.cancelled) {
    turn.status = "cancelled";
    turn.cancelled = true;
    turn.error = result.error ?? "Cancelled by user.";
  } else {
    turn.status = result.ok ? "done" : "error";
    turn.error = result.ok ? undefined : result.error ?? "Unknown error.";
  }
  turn.endedAt = Date.now();
  const terminal: StudioEvent = result.ok
    ? { kind: "end", ok: true }
    : {
        kind: "end",
        ok: false,
        error: turn.error!,
        ...(result.cancelled ? { cancelled: true } : {}),
      };
  const lastEvent = turn.events[turn.events.length - 1];
  const alreadyHasTerminal =
    lastEvent &&
    lastEvent.kind === "end" &&
    lastEvent.ok === terminal.ok &&
    (lastEvent as { error?: string }).error === (terminal as { error?: string }).error;
  if (!alreadyHasTerminal && turn.events.length < MAX_EVENTS_PER_TURN) {
    turn.events.push(terminal);
    for (const fn of turn.subscribers) {
      try { fn(terminal); } catch {}
    }
  }
  for (const fn of turn.terminators) {
    try { fn(); } catch {}
  }
  turn.subscribers.clear();
  turn.terminators.clear();

  const timer = setTimeout(() => {
    if (turns.get(turn.slug) === turn) turns.delete(turn.slug);
    retentionTimers.delete(turn.slug);
  }, TURN_RETENTION_MS);
  timer.unref?.();
  retentionTimers.set(turn.slug, timer);
}
```

- [ ] **Step 6: Add `cancelTurn`**

After `getTurn`:

```ts
export function cancelTurn(slug: string): boolean {
  const turn = turns.get(slug);
  if (!turn || turn.status !== "running") return false;
  turn.abortController.abort(new Error("cancelled by user"));
  finalize(turn, { ok: false, cancelled: true, error: "Cancelled by user." });
  return true;
}
```

- [ ] **Step 7: Run the new test**

Run: `pnpm run studio:test studio/__tests__/server/turnRegistry-cancel.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 8: Run the full server suite (regression check)**

Run: `pnpm run studio:test studio/__tests__/server`
Expected: all server tests still pass.

- [ ] **Step 9: Commit**

```bash
git add studio/server/turnRegistry.ts \
        studio/__tests__/server/turnRegistry-cancel.test.ts
git commit -m "feat(studio/chat): turn registry cancellation with abort signal"
```

---

## Task 6: Wire registry signal into the chat middleware runners

**Files:**
- Modify: `studio/server/middleware/chat.ts`

- [ ] **Step 1: Pass `signal` from registry into runners**

In `chat.ts`, the `startTurn` call inside `handleStart`:

```ts
const turn = startTurn(slug, {
  prompt,
  run: ({ emit, end, signal }) => {
    const wrappedEmit = projectRef
      ? (ev: StudioEvent) => {
          emit(ev);
          if (!turnIdHolder.id) return;
          const relayEv = mapStudioEventToRelayEvent(ev, turnIdHolder.id);
          if (relayEv) recordChatEventForReplay(projectRef!, relayEv);
        }
      : emit;
    const wrappedEnd = projectRef
      ? (result: { ok: boolean; error?: string }) => {
          if (turnIdHolder.id) {
            recordChatEventForReplay(projectRef!, {
              type: "turn_ended",
              turnId: turnIdHolder.id,
              ok: result.ok,
              error: result.error,
            });
          }
          end(result);
        }
      : end;
    const task = isComputerTurn
      ? runComputerBranch({ emit: wrappedEmit, slug, prompt, project, signal })
      : runClaudeBranch({ emit: wrappedEmit, slug, prompt, images, project, signal });
    task.then(
      (result) => wrappedEnd(result),
      (err) => wrappedEnd({ ok: false, error: err?.message ?? String(err) }),
    );
  },
});
```

- [ ] **Step 2: Thread `signal` into `runClaudeBranch`**

Update the function signature and forward it:

```ts
async function runClaudeBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  images?: string[];
  project: { sessionId?: string };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, project, signal } = ctx;
  // … existing body …

  await runClaudeTurnWithRetry({
    cwd: projectDir(slug),
    prompt,
    sessionId: project.sessionId,
    bin: resolveClaudeBin(),
    images,
    model,
    signal,
    onEvent: (ev) => { /* unchanged */ },
    onCrash: async (info) => { /* unchanged */ },
  });
  // … rest unchanged …
}
```

- [ ] **Step 3: Thread `signal` into `runComputerBranch`**

```ts
async function runComputerBranch(ctx: {
  emit: (ev: StudioEvent) => void;
  slug: string;
  prompt: string;
  project: { computerConversationId?: string };
  signal: AbortSignal;
}): Promise<{ ok: boolean; error?: string }> {
  const { emit, slug, prompt, project, signal } = ctx;
  // … existing body …

  const result = await runComputerTurn({
    prompt: finalPrompt,
    conversationId: project.computerConversationId,
    signal,
    onEvent: (ev) => { /* unchanged */ },
  });
  // … rest unchanged …
}
```

- [ ] **Step 4: Verify `runClaudeTurnWithRetry` forwards `signal`**

Open `studio/server/claudeCode.ts`. The retry wrapper spreads `opts` into each `runClaudeTurn` invocation, so `signal` already reaches the subprocess. Confirm by reading the retry loop. No code change needed.

- [ ] **Step 5: Run server tests**

Run: `pnpm run studio:test studio/__tests__/server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/server/middleware/chat.ts
git commit -m "feat(studio/chat): plumb cancellation signal through chat runners"
```

---

## Task 7: `POST /api/chat/cancel/:slug` endpoint

**Files:**
- Modify: `studio/server/middleware/chat.ts`
- Test: `studio/__tests__/server/chat-cancel.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// studio/__tests__/server/chat-cancel.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createServer } from "node:http";
import { chatMiddleware } from "../../server/middleware/chat";
import {
  startTurn,
  getTurn,
  __resetTurnRegistryForTests,
} from "../../server/turnRegistry";

async function postJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: "POST" });
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe("POST /api/chat/cancel/:slug", () => {
  let baseUrl: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    __resetTurnRegistryForTests();
    server = createServer((req, res) => {
      void chatMiddleware()(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address();
    baseUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("returns 200 + cancelled:true when a turn is running", async () => {
    startTurn("alpha", { prompt: "hi", run: () => { /* hangs */ } });
    const { status, body } = await postJson(`${baseUrl}/api/chat/cancel/alpha`);
    expect(status).toBe(200);
    expect(body.cancelled).toBe(true);
    expect(getTurn("alpha")?.status).toBe("cancelled");
  });

  it("returns 409 when no turn is running for that slug", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/chat/cancel/nope`);
    expect(status).toBe(409);
    expect(body.error.code).toBe("no_running_turn");
  });
});
```

Add the missing import at the top of the test:

```ts
import { afterEach } from "vitest";
```

- [ ] **Step 2: Run test, confirm failure**

Run: `pnpm run studio:test studio/__tests__/server/chat-cancel.test.ts`
Expected: FAIL — endpoint returns 404.

- [ ] **Step 3: Add the endpoint**

In `chat.ts`, add a regex at the top with the others:

```ts
const CANCEL_URL = /^\/api\/chat\/cancel\/([a-z0-9][a-z0-9-]{0,62})$/i;
```

Import `cancelTurn` at the top of the file (alongside `startTurn, subscribe, getTurn`):

```ts
import { startTurn, subscribe, getTurn, cancelTurn } from "../turnRegistry";
```

In `chatMiddleware`'s POST branch, before the existing `/api/chat` POST handler:

```ts
if (req.url.startsWith("/api/chat") && req.method === "POST") {
  const cancelMatch = req.url.match(CANCEL_URL);
  if (cancelMatch) return handleCancel(res, cancelMatch[1].toLowerCase());
  return handleStart(req, res);
}
```

Add `handleCancel`:

```ts
function handleCancel(res: ServerResponse, slug: string): void {
  const ok = cancelTurn(slug);
  if (!ok) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "no_running_turn", message: "No turn is running for this project." },
      }),
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ cancelled: true, slug }));
}
```

- [ ] **Step 4: Run test, confirm pass**

Run: `pnpm run studio:test studio/__tests__/server/chat-cancel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/middleware/chat.ts \
        studio/__tests__/server/chat-cancel.test.ts
git commit -m "feat(studio/chat): POST /api/chat/cancel/:slug"
```

---

## Task 8: Mirror `cancelled` flag on relay `turn_ended`

**Files:**
- Modify: `studio/server/relay/types.ts`
- Modify: `studio/server/middleware/chat.ts`

- [ ] **Step 1: Extend the relay schema**

In `relay/types.ts`, change the `turn_ended` shape:

```ts
z.object({
  type: z.literal("turn_ended"),
  turnId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  cancelled: z.boolean().optional(),
}),
```

- [ ] **Step 2: Forward `cancelled` from the wrapped end callback**

In `chat.ts`'s `wrappedEnd`, the registry's `end` is called with the runner's result. Cancellation comes from `cancelTurn()` directly finalizing the turn — `wrappedEnd` is never called in that path. So the relay mirror needs to be triggered from the registry's terminal subscription, not from `end`.

Easiest fix: subscribe to the turn after `startTurn`. After `recordChatEventForReplay({ type: "prompt_started", … })` add:

```ts
if (projectRef) {
  const sub = subscribe(slug, () => {}, () => {
    const final = getTurn(slug);
    if (!final || !projectRef) return;
    if (final.cancelled) {
      recordChatEventForReplay(projectRef, {
        type: "turn_ended",
        turnId: turn.id,
        ok: false,
        error: final.error,
        cancelled: true,
      });
    }
  });
  void sub;
}
```

This complements the existing `wrappedEnd` mirror — `wrappedEnd` handles the natural-termination case; the terminator above handles the cancel-by-user case where `wrappedEnd` is bypassed.

- [ ] **Step 3: Run server tests**

Run: `pnpm run studio:test studio/__tests__/server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/server/relay/types.ts \
        studio/server/middleware/chat.ts
git commit -m "feat(studio/multiplayer): mirror cancelled flag in turn_ended"
```

---

## Task 9: API client `cancelTurn`

**Files:**
- Modify: `studio/src/lib/api.ts`

- [ ] **Step 1: Add the method**

Append inside the `api` object literal in `studio/src/lib/api.ts`:

```ts
cancelTurn: (slug: string) =>
  fetch(`/api/chat/cancel/${slug}`, { method: "POST" }).then(
    j<{ cancelled: true; slug: string }>,
  ),
```

- [ ] **Step 2: Commit**

```bash
git add studio/src/lib/api.ts
git commit -m "feat(studio/chat): api.cancelTurn client method"
```

---

## Task 10: Reducer handles `cancelled` phase

**Files:**
- Modify: `studio/src/hooks/chatStreamReducer.ts`

- [ ] **Step 1: Update `TurnPhase`**

```ts
export type TurnPhase = "idle" | "running" | "done" | "error" | "cancelled";
```

- [ ] **Step 2: Update the `end` branch in `applyStudioEvent`**

```ts
if (ev.kind === "end") {
  if (ev.ok) {
    return {
      ...s,
      lastEvent: ev,
      busy: false,
      phase: "done",
      turnEndedAt: Date.now(),
    };
  }
  if (ev.cancelled) {
    return {
      ...s,
      lastEvent: ev,
      busy: false,
      phase: "cancelled",
      error: null,
      errorKind: undefined,
      turnEndedAt: Date.now(),
    };
  }
  const err = ev.error ?? "unknown error";
  return {
    ...s,
    lastEvent: ev,
    busy: false,
    phase: "error",
    error: err,
    errorKind: classifyError(err),
    turnEndedAt: Date.now(),
  };
}
```

- [ ] **Step 3: Run reducer tests**

Run: `pnpm run studio:test studio/__tests__/hooks`
Expected: PASS — existing tests do not assert on cancelled.

- [ ] **Step 4: Commit**

```bash
git add studio/src/hooks/chatStreamReducer.ts
git commit -m "feat(studio/chat): cancelled phase in stream reducer"
```

---

## Task 11: `useChatStream.cancel()`

**Files:**
- Modify: `studio/src/hooks/useChatStream.ts`
- Test: `studio/__tests__/hooks/useChatStream-cancel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// studio/__tests__/hooks/useChatStream-cancel.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChatStream } from "../../src/hooks/useChatStream";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useChatStream.cancel", () => {
  it("POSTs /api/chat/cancel/:slug when cancel() is called", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/chat/stream/")) {
        return new Response("event: idle\ndata: {\"kind\":\"idle\"}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.includes("/api/chat/cancel/")) {
        return new Response(JSON.stringify({ cancelled: true, slug: "alpha" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });

    const { result } = renderHook(() => useChatStream("alpha"));
    await act(async () => {
      await result.current.cancel();
    });

    const cancelCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("/api/chat/cancel/alpha"),
    );
    expect(cancelCall).toBeDefined();
    expect(cancelCall?.[1]?.method).toBe("POST");
  });
});
```

Add `import { beforeEach } from "vitest";` if not already present.

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm run studio:test studio/__tests__/hooks/useChatStream-cancel.test.ts`
Expected: FAIL — `result.current.cancel` is undefined.

- [ ] **Step 3: Implement `cancel`**

Inside `useChatStream`, after `retry`:

```ts
const cancel = useCallback(async () => {
  if (phaseRef.current !== "running") return;
  try {
    await fetch(`/api/chat/cancel/${slug}`, { method: "POST" });
  } catch {
    // The SSE stream's terminal `end` event drives state. If cancel POST
    // fails (rare; e.g. server restart), the stream itself will eventually
    // show a disconnect; user can retry.
  }
}, [slug]);
```

Update the return:

```ts
return { state, send, retry, cancel };
```

- [ ] **Step 4: Run test, confirm pass**

Run: `pnpm run studio:test studio/__tests__/hooks/useChatStream-cancel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/hooks/useChatStream.ts \
        studio/__tests__/hooks/useChatStream-cancel.test.ts
git commit -m "feat(studio/chat): expose cancel() on useChatStream"
```

---

## Task 12: ChatPane wires `onStop`

**Files:**
- Modify: `studio/src/components/chat/ChatPane.tsx`

- [ ] **Step 1: Pull `cancel` from context**

```tsx
const { state, send, retry, cancel } = useChatStreamContext();
```

- [ ] **Step 2: Pass to PromptInput**

```tsx
<PromptInput
  busy={state.phase === "running"}
  projectSlug={projectSlug}
  onSend={enhancedSend}
  onStop={cancel}
  seedRef={seedRef}
  commentMode={
    readonly
      ? { onSubmit: async (text) => { await postComment?.(text); } }
      : undefined
  }
/>
```

- [ ] **Step 3: Verify `chatStreamContext` exports the new method**

Open `studio/src/hooks/chatStreamContext.tsx`. The context is typed as `ReturnType<typeof useChatStream>`, so `cancel` is automatically included once Task 11 is in. No edit needed.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/chat/ChatPane.tsx
git commit -m "feat(studio/chat): pass cancel through to PromptInput"
```

---

## Task 13: PromptInput renders Stop while busy

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Test: `studio/__tests__/components/PromptInput-stop.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// studio/__tests__/components/PromptInput-stop.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptInput } from "../../src/components/chat/PromptInput";
import { TargetSelectionProvider } from "../../src/hooks/targetSelectionContext";

function Harness(props: Partial<React.ComponentProps<typeof PromptInput>>) {
  return (
    <TargetSelectionProvider>
      <PromptInput
        busy={false}
        projectSlug="alpha"
        onSend={() => {}}
        {...props}
      />
    </TargetSelectionProvider>
  );
}

describe("PromptInput Stop button", () => {
  it("renders the Send button when not busy", () => {
    render(<Harness busy={false} />);
    expect(screen.getByLabelText("Send")).toBeTruthy();
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });

  it("renders the Stop button when busy and onStop is set", () => {
    const onStop = vi.fn();
    render(<Harness busy={true} onStop={onStop} />);
    const stop = screen.getByLabelText("Stop");
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not render Stop when onStop is missing (e.g. spectator/comment)", () => {
    render(<Harness busy={true} />);
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });
});
```

Confirm the existing `@xorkavi/arcade-gen` mock in `studio/__tests__/setup` (or the colocated `__mocks__`) exposes the components used here. If a new mock entry is needed, follow the patterns documented in `studio/CLAUDE.md` ("mock must export Modal, Input, Button, etc. that the component uses").

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm run studio:test studio/__tests__/components/PromptInput-stop.test.tsx`
Expected: FAIL — Stop button not rendered.

- [ ] **Step 3: Update `PromptInputProps`**

In `studio/src/components/chat/PromptInput.tsx`, add the prop:

```tsx
interface PromptInputProps {
  busy: boolean;
  projectSlug: string;
  onSend: (prompt: string, images: string[]) => void;
  onStop?: () => void;
  seedRef?: MutableRefObject<((text: string) => void) | null>;
  commentMode?: { onSubmit: (text: string) => Promise<void> };
}
```

Update the destructure:

```tsx
export function PromptInput({
  busy,
  projectSlug,
  onSend,
  onStop,
  seedRef,
  commentMode,
}: PromptInputProps) {
```

- [ ] **Step 4: Swap Send for Stop in the trailing slot**

Replace the `trailing` JSX inside `ChatInput`:

```tsx
trailing={
  <>
    {!isComment && <ChatInput.AddAttachmentButton onClick={handlePickImage} />}
    {effectiveBusy && onStop && !isComment ? (
      <ChatInput.StopButton onClick={onStop} />
    ) : (
      <ChatInput.SendButton
        onClick={() => void submit()}
        disabled={!text.trim() || effectiveBusy}
      />
    )}
  </>
}
```

- [ ] **Step 5: Run test, confirm pass**

Run: `pnpm run studio:test studio/__tests__/components/PromptInput-stop.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/chat/PromptInput.tsx \
        studio/__tests__/components/PromptInput-stop.test.tsx
git commit -m "feat(studio/chat): swap Send for Stop while a turn is running"
```

---

## Task 14: MessageList renders `cancelled` indicator

**Files:**
- Modify: `studio/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Find the existing terminal-status row**

Open `MessageList.tsx`. The existing rendering treats `phase === "running"` as live and everything else as terminal. The cancelled state currently falls through and shows nothing user-facing.

- [ ] **Step 2: Add a cancelled indicator row**

Locate the JSX block that conditionally renders for `phase === "error"` (or the equivalent terminal-state branch — search for `phase ===`). Below it, add:

```tsx
{phase === "cancelled" && (
  <div
    style={{
      textAlign: "center",
      fontSize: 13,
      color: "var(--fg-neutral-subtle)",
      padding: "4px 16px",
    }}
  >
    Cancelled
  </div>
)}
```

If there is no existing terminal branch, add it right after the live-turn rendering block (after the `isComputerLive ? … : (…)` ternary, before the closing `</div>` of the scroll container).

- [ ] **Step 3: Manually verify**

Run dev server: `pnpm run studio`. Send a turn. Click Stop while it streams. Expected: streaming halts within ~2s; chat shows the user's prompt bubble + a small grey "Cancelled" line; no red banner; Send button restored.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/chat/MessageList.tsx
git commit -m "feat(studio/chat): show neutral Cancelled marker on stopped turns"
```

---

## Task 15: Full regression run

- [ ] **Step 1: Run the full Vitest suite**

Run: `pnpm run studio:test`
Expected: all tests pass. Investigate and fix any regressions before moving on.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm run studio`. Verify both flows end-to-end:
1. Hero submit → instant nav → streaming starts.
2. While streaming, Stop button appears → click → streaming halts → "Cancelled" marker → Send button restored. Send a follow-up prompt; it should run normally.

- [ ] **Step 3: Bump version + changelog**

Edit `package.json` `version` (bump patch — e.g. 0.23.0 → 0.23.1).
Add an entry to `studio/CHANGELOG.md`:

```markdown
## [0.23.1] — 2026-05-28

### Added
- Hero submit on the homepage now redirects to the new project's screen and starts streaming there.
- Stop button replaces Send while a turn is running; click to cancel.

### Changed
- Cancelled turns no longer render as errors. A neutral "Cancelled" marker appears in the chat instead.
```

- [ ] **Step 4: Commit**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump version + changelog for 0.23.1"
```

---

## Self-review notes

- Spec coverage:
  - Issue 1 redirect-on-submit → Tasks 1, 2, 3.
  - Issue 2 server-side cancellation → Tasks 4, 5, 6, 7, 8.
  - Issue 2 client surface → Tasks 9, 10, 11, 12, 13, 14.
- Type consistency: `cancelled` discriminant added to `StudioEvent.end` (Task 4) is consumed in `chatStreamReducer` (Task 10) and emitted by `turnRegistry.finalize` (Task 5). `cancelTurn` is the same name in registry, middleware, and api client.
- No placeholders.
