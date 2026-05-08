# Multi-frame Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let beta users produce multi-frame prototypes for multi-step flows by (a) teaching the agent to propose splitting flow-shaped prompts into multiple frames, (b) adding a "+ New frame" affordance to the viewport, and (c) using the agent's first turn as a proactive split suggestion.

**Architecture:** No new data model. Frames remain an ordered array on `Project`, filename-ordered by a two-digit prefix. Agent behavior is pure prompt changes in `studio/templates/CLAUDE.md.tpl`. A new single-purpose middleware exposes `POST /api/projects/:slug/frames` to create a blank frame. UI adds a placeholder card at the row's end that calls the endpoint and then seeds the chat input.

**Tech Stack:** Vite middleware (Node HTTP), React 19 + TypeScript for the shell, Vitest for tests. Package manager is **pnpm**.

---

## File Structure

**New files:**
- `studio/server/middleware/frames.ts` — `POST /api/projects/:slug/frames` endpoint. Creates a new blank frame directory, writes the scaffold, calls `reconcileFrames`, returns the created `Frame`.
- `studio/__tests__/server/frames.test.ts` — tests for the new endpoint: prefix selection, scaffold content, response shape, 404 on unknown project.
- `studio/src/components/viewport/NewFrameCard.tsx` — placeholder card component used both at the end of the frame row and as a secondary option in `EmptyViewport`.
- `studio/__tests__/components/new-frame-card.test.tsx` — component test: renders, calls handler on click.

**Modified files:**
- `studio/templates/CLAUDE.md.tpl` — new "When the prompt describes a flow" section (~40 lines) + frame-targeted prompt rule (~10 lines).
- `studio/vite.config.ts` — mount `framesMiddleware` in the plugin's `configureServer`.
- `studio/server/projects.ts` — add a tiny exported helper `nextFramePrefix(existingSlugs)` used by the new middleware. Keeps directory-scan logic out of the middleware file.
- `studio/src/lib/api.ts` — `createFrame(slug)` client helper.
- `studio/src/components/viewport/Viewport.tsx` — render `NewFrameCard` at the end of the frame row; wire its click to `api.createFrame` + a seed callback passed down from the page.
- `studio/src/components/viewport/EmptyViewport.tsx` — add `NewFrameCard` as a secondary option.
- `studio/src/components/chat/PromptInput.tsx` — accept a `seedRef` imperative for focusing with seeded text.
- `studio/src/components/chat/ChatPane.tsx` — expose a seed function up to `ProjectDetail`.
- `studio/src/routes/ProjectDetail.tsx` — thread the seed function from `ChatPane` into `Viewport`.
- `studio/CHANGELOG.md` — add entry for the new version.
- `studio/packaging/VERSION` — bump to 0.13.0.

Each file has one responsibility. The middleware only serves the one route. `NewFrameCard` is pure UI. The seed plumbing passes through `ProjectDetail` (already the parent of both panes) without adding state.

---

## Task 1: Server helper — `nextFramePrefix`

Tiny exported helper used by the new endpoint. Its own task because it's the smallest testable unit and landing it first keeps the endpoint task focused.

**Files:**
- Modify: `studio/server/projects.ts`
- Test: `studio/__tests__/server/projects-next-prefix.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/projects-next-prefix.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextFramePrefix } from "../../server/projects";

describe("nextFramePrefix", () => {
  it("returns 01 when there are no frames", () => {
    expect(nextFramePrefix([])).toBe("01");
  });

  it("returns the next two-digit prefix after the highest existing one", () => {
    expect(nextFramePrefix(["01-home", "02-settings"])).toBe("03");
  });

  it("ignores frame slugs that don't begin with a two-digit prefix", () => {
    expect(nextFramePrefix(["welcome", "02-settings"])).toBe("03");
  });

  it("handles gaps by always picking highest+1, not filling the gap", () => {
    expect(nextFramePrefix(["01-home", "05-done"])).toBe("06");
  });

  it("pads single digits to two chars", () => {
    expect(nextFramePrefix(["08-foo"])).toBe("09");
  });

  it("works for three-digit ranges", () => {
    expect(nextFramePrefix(["99-last"])).toBe("100");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/projects-next-prefix.test.ts`
Expected: FAIL with "nextFramePrefix is not a function" or similar import error.

- [ ] **Step 3: Implement the helper**

Add to `studio/server/projects.ts` (near the other exported helpers — place it just above `reconcileFrames` so nearby code stays together):

```ts
/**
 * Compute the next two-digit prefix for a new frame. Scans existing
 * frame slugs for a leading `\d{2,}-` prefix and returns highest+1,
 * padded to two digits (or more if we've gone past 99). Slugs without
 * a numeric prefix are ignored.
 */
export function nextFramePrefix(existingSlugs: string[]): string {
  let max = 0;
  for (const slug of existingSlugs) {
    const m = slug.match(/^(\d+)-/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return next.toString().padStart(2, "0");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/projects-next-prefix.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/server/projects.ts studio/__tests__/server/projects-next-prefix.test.ts
git commit -m "feat(studio/projects): nextFramePrefix helper for frame creation"
```

---

## Task 2: Server middleware — `POST /api/projects/:slug/frames`

New middleware with a single route. Creates a blank frame directory, writes the scaffold, triggers a reconcile, returns the newly-created `Frame`.

**Files:**
- Create: `studio/server/middleware/frames.ts`
- Modify: `studio/vite.config.ts`
- Test: `studio/__tests__/server/frames.test.ts`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/server/frames.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { framesMiddleware } from "../../server/middleware/frames";
import { createProject } from "../../server/projects";
import { projectDir } from "../../server/paths";

// Minimal fake req/res pair matching what Vite's connect stack hands us.
function fakeReq(method: string, url: string): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  return req;
}

function fakeRes(): ServerResponse & { _status?: number; _body?: string } {
  const res = new ServerResponse(new IncomingMessage(new Socket())) as any;
  let status = 200;
  let body = "";
  res.writeHead = (code: number) => { status = code; return res; };
  res.end = (chunk?: string) => { if (chunk) body += chunk; res._status = status; res._body = body; };
  res.write = (chunk: string) => { body += chunk; return true; };
  res._status = status;
  res._body = body;
  return res;
}

let tmpRoot: string;
let slug: string;

beforeEach(async () => {
  // Relocate the studio "projects root" to a temp dir so tests can't touch
  // real projects. `projectDir` reads ARCADE_STUDIO_HOME; set it before
  // importing anything that caches a projects-root value.
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studio-frames-test-"));
  process.env.ARCADE_STUDIO_HOME = tmpRoot;
  const p = await createProject({ name: "Test", theme: "arcade", mode: "light" });
  slug = p.slug;
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  delete process.env.ARCADE_STUDIO_HOME;
});

describe("POST /api/projects/:slug/frames", () => {
  it("creates a blank frame with the next two-digit prefix", async () => {
    const mw = framesMiddleware();
    const req = fakeReq("POST", `/api/projects/${slug}/frames`);
    const res = fakeRes();
    await mw(req, res, () => {});
    expect(res._status).toBe(201);
    const body = JSON.parse(res._body!);
    expect(body.slug).toMatch(/^01-untitled-1$/);
    expect(body.name).toBe("Untitled 1");
    // Scaffold file exists and contains the placeholder message
    const idx = path.join(projectDir(slug), "frames", "01-untitled-1", "index.tsx");
    const contents = await fs.readFile(idx, "utf-8");
    expect(contents).toContain("This frame is blank");
    expect(contents).toContain("export default function");
  });

  it("returns 404 when the project does not exist", async () => {
    const mw = framesMiddleware();
    const req = fakeReq("POST", `/api/projects/does-not-exist/frames`);
    const res = fakeRes();
    await mw(req, res, () => {});
    expect(res._status).toBe(404);
  });

  it("increments the untitled counter when called repeatedly", async () => {
    const mw = framesMiddleware();
    const call = async () => {
      const req = fakeReq("POST", `/api/projects/${slug}/frames`);
      const res = fakeRes();
      await mw(req, res, () => {});
      return JSON.parse(res._body!);
    };
    const f1 = await call();
    const f2 = await call();
    expect(f1.slug).toBe("01-untitled-1");
    expect(f2.slug).toBe("02-untitled-2");
    expect(f2.name).toBe("Untitled 2");
  });

  it("falls through for unrelated URLs", async () => {
    const mw = framesMiddleware();
    const req = fakeReq("GET", `/api/projects/${slug}`);
    const res = fakeRes();
    let called = false;
    await mw(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/server/frames.test.ts`
Expected: FAIL — `framesMiddleware` import not found.

- [ ] **Step 3: Implement the middleware**

Create `studio/server/middleware/frames.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { getProject, nextFramePrefix, reconcileFrames } from "../projects";
import { frameDir } from "../paths";

const ROUTE = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,62})\/frames$/;

const BLANK_FRAME_SCAFFOLD = `export default function UntitledFrame() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--fg-neutral-subtle)]">
        This frame is blank. Describe it in the chat to bring it to life.
      </div>
    </div>
  );
}
`;

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function nextUntitledNumber(existingSlugs: string[]): number {
  let n = 1;
  const used = new Set(
    existingSlugs
      .map((s) => s.match(/^\d+-untitled-(\d+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1])),
  );
  while (used.has(n)) n += 1;
  return n;
}

export function framesMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const url = (req.url ?? "").replace(/\?.*$/, "");
    const match = url.match(ROUTE);
    if (!match || req.method !== "POST") return next?.();

    const slug = match[1];
    try {
      const project = await getProject(slug);
      if (!project) {
        return send(res, 404, { error: { code: "not_found", message: "Project not found" } });
      }

      const existingSlugs = project.frames.map((f) => f.slug);
      const prefix = nextFramePrefix(existingSlugs);
      const n = nextUntitledNumber(existingSlugs);
      const newSlug = `${prefix}-untitled-${n}`;
      const dir = frameDir(slug, newSlug);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "index.tsx"), BLANK_FRAME_SCAFFOLD);

      // reconcileFrames rescans the frames directory and writes project.json.
      // It returns the updated frame list; pick ours out of it.
      const frames = await reconcileFrames(slug);
      const created = frames.find((f) => f.slug === newSlug);
      if (!created) {
        return send(res, 500, {
          error: { code: "reconcile_failed", message: "Frame was written but not reconciled" },
        });
      }
      send(res, 201, created);
    } catch (err: any) {
      send(res, 500, { error: { code: "internal", message: err?.message ?? String(err) } });
    }
  };
}
```

Note: `reconcileFrames` returns `Frame[]` already (see `studio/server/projects.ts:332`). The `name` defaults to `titleCase(slug)` → "Untitled 1" for `01-untitled-1`. No extra name-setting step needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/server/frames.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Mount the middleware in Vite config**

Edit `studio/vite.config.ts`. Add the import at the top with the other middleware imports:

```ts
import { framesMiddleware } from "./server/middleware/frames";
```

In the `apiPlugin` function, add the middleware inside `configureServer`, after `projectsMiddleware` and before `adoptUploadsMiddleware`:

```ts
server.middlewares.use(projectsMiddleware());
server.middlewares.use(framesMiddleware());  // NEW
server.middlewares.use(adoptUploadsMiddleware());
```

Ordering matters: `projectsMiddleware` owns `/api/projects/:slug/*` subresources but falls through to the next middleware when the subresource doesn't match, so placing `framesMiddleware` right after it is correct. See the "Unrecognized subresource" fallthrough comment at `studio/server/middleware/projects.ts:154-157`.

- [ ] **Step 6: Verify the full test suite still passes**

Run: `pnpm run studio:test`
Expected: all tests pass. If any pre-existing test regresses, fix before moving on.

- [ ] **Step 7: Commit**

```bash
git add studio/server/middleware/frames.ts studio/__tests__/server/frames.test.ts studio/vite.config.ts
git commit -m "feat(studio/frames): POST /api/projects/:slug/frames creates a blank frame"
```

---

## Task 3: Client API helper

**Files:**
- Modify: `studio/src/lib/api.ts`

- [ ] **Step 1: Add `createFrame` to the `api` object**

Edit `studio/src/lib/api.ts`. Add a line inside the `export const api = {` block, after `adoptUploads`:

```ts
createFrame: (slug: string) =>
  fetch(`/api/projects/${slug}/frames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).then(j<Frame>),
```

Add the `Frame` import at the top:

```ts
import type { Project, Frame } from "../../server/types";
```

- [ ] **Step 2: Verify the file typechecks**

Run: `pnpm run studio:test __tests__/ -- --run --reporter=verbose 2>&1 | head -20`
Expected: no new type errors. (The test suite runs through Vitest which uses the same TS config.)

Alternative (if you prefer a fast type-only check): `pnpm exec tsc --noEmit -p studio/`. If this isn't part of the project's existing CI, skip it and rely on the test run.

- [ ] **Step 3: Commit**

```bash
git add studio/src/lib/api.ts
git commit -m "feat(studio/api): createFrame client helper"
```

---

## Task 4: `NewFrameCard` component

Pure UI component with no fetching of its own — takes an `onClick` handler. Used in two places in Task 5.

**Files:**
- Create: `studio/src/components/viewport/NewFrameCard.tsx`
- Test: `studio/__tests__/components/new-frame-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/new-frame-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewFrameCard } from "../../src/components/viewport/NewFrameCard";

describe("NewFrameCard", () => {
  it("renders a button with a '+ New frame' label", () => {
    render(<NewFrameCard onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /new frame/i })).toBeInTheDocument();
  });

  it("calls onClick when the button is clicked", () => {
    const onClick = vi.fn();
    render(<NewFrameCard onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /new frame/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the button while busy", () => {
    render(<NewFrameCard onClick={() => {}} busy />);
    const btn = screen.getByRole("button", { name: /new frame/i });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/new-frame-card.test.tsx`
Expected: FAIL with import error.

- [ ] **Step 3: Implement the component**

Create `studio/src/components/viewport/NewFrameCard.tsx`:

```tsx
export function NewFrameCard({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <div style={{ flex: "none" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: 12,
          color: "var(--fg-neutral-medium)",
          visibility: "hidden",
        }}
      >
        {/* spacer to match FrameCard's header height so card tops align */}
        <span>New frame</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-label="New frame"
        style={{
          width: 320,
          height: "calc(100vh - 180px)",
          border: "2px dashed var(--stroke-neutral-subtle)",
          borderRadius: 12,
          background: "transparent",
          color: "var(--fg-neutral-subtle)",
          cursor: busy ? "progress" : "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          fontSize: 16,
          transition: "border-color 0.15s ease, color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (busy) return;
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--component-button-primary-bg-idle)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-neutral-prominent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--stroke-neutral-subtle)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-neutral-subtle)";
        }}
      >
        <span style={{ fontSize: 32, lineHeight: 1 }}>+</span>
        <span>New frame</span>
      </button>
    </div>
  );
}
```

The hidden spacer div matches the frame-card header so the dashed card's top aligns with neighboring `FrameCard`s. Width 320 matches the `FRAME_WIDTH_MIN` in [studio/src/components/viewport/FrameCard.tsx:6](studio/src/components/viewport/FrameCard.tsx#L6).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/new-frame-card.test.tsx`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/NewFrameCard.tsx studio/__tests__/components/new-frame-card.test.tsx
git commit -m "feat(studio/viewport): NewFrameCard component"
```

---

## Task 5: Wire the seed-prompt plumbing

Add a way to focus the chat input with pre-filled text. This is the thinnest possible imperative: a ref-like setter exposed by `ChatPane`, called by `ProjectDetail` when the viewport asks.

**Files:**
- Modify: `studio/src/components/chat/PromptInput.tsx`
- Modify: `studio/src/components/chat/ChatPane.tsx`
- Modify: `studio/src/routes/ProjectDetail.tsx`

No tests for this task — the seed behavior is verified in Task 6's integration-style test and again manually in the "Done" checks at the end of the plan. Keeping this task code-only avoids a test that would duplicate Task 6.

- [ ] **Step 1: Add a `seedRef` prop to `PromptInput`**

Edit `studio/src/components/chat/PromptInput.tsx`. Update the `PromptInputProps` interface and the component signature:

```ts
interface PromptInputProps {
  busy: boolean;
  projectSlug: string;
  onSend: (prompt: string, images: string[]) => void;
  seedRef?: React.MutableRefObject<((text: string) => void) | null>;
}
```

Inside the component body, just after `const [text, setText] = useState("");` at line 56, add:

```ts
useEffect(() => {
  if (!seedRef) return;
  seedRef.current = (seed: string) => {
    setText(seed);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(seed.length, seed.length); } catch { /* ignore */ }
    });
  };
  return () => { seedRef.current = null; };
}, [seedRef]);
```

Destructure `seedRef` from props at the top of the component signature:

```ts
export function PromptInput({ busy, projectSlug, onSend, seedRef }: PromptInputProps) {
```

Add `React` to the React import at the top if not already imported:

```ts
import {
  useState,
  useRef,
  useEffect,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
  type MutableRefObject,
} from "react";
```

And change the prop type to use the local alias:

```ts
seedRef?: MutableRefObject<((text: string) => void) | null>;
```

- [ ] **Step 2: Thread the ref through `ChatPane`**

Edit `studio/src/components/chat/ChatPane.tsx`. Update the props:

```ts
import { useEffect, useState, type MutableRefObject } from "react";

export function ChatPane({
  projectSlug,
  seedRef,
}: {
  projectSlug: string;
  seedRef?: MutableRefObject<((text: string) => void) | null>;
}) {
```

Pass the ref down to `PromptInput` at line 75:

```tsx
<PromptInput busy={state.phase === "running"} projectSlug={projectSlug} onSend={enhancedSend} seedRef={seedRef} />
```

- [ ] **Step 3: Create the ref in `ProjectDetail` and pass it to `Viewport`**

Edit `studio/src/routes/ProjectDetail.tsx`. Find where `ChatPane` is rendered and where `Viewport` is rendered. Near the top of the component body:

```ts
import { useRef } from "react";
// ... existing imports ...

const seedChatRef = useRef<((text: string) => void) | null>(null);
```

Pass to `ChatPane`:

```tsx
<ChatPane projectSlug={project.slug} seedRef={seedChatRef} />
```

Pass to `Viewport` (new prop to be added in Task 6):

```tsx
<Viewport
  project={project}
  frameWidth={frameWidth}
  onFrameWidthChange={setFrameWidth}
  zoom={zoom}
  onZoomChange={setZoom}
  onSeedChat={(text) => seedChatRef.current?.(text)}
/>
```

If `ProjectDetail.tsx` doesn't currently destructure `project.slug` to pass to `Viewport` — check the current signature of `Viewport` and match it. The only new prop added here is `onSeedChat`.

- [ ] **Step 4: Verify build**

Run: `pnpm run studio:test`
Expected: all tests pass (no new behavior yet; just plumbing).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/chat/PromptInput.tsx studio/src/components/chat/ChatPane.tsx studio/src/routes/ProjectDetail.tsx
git commit -m "feat(studio/chat): seedRef imperative to focus PromptInput with pre-filled text"
```

---

## Task 6: Wire `NewFrameCard` into the viewport

Render `NewFrameCard` at the end of the frame row. Click → `api.createFrame` → seed the chat with "Design the Untitled N screen: ".

**Files:**
- Modify: `studio/src/components/viewport/Viewport.tsx`
- Modify: `studio/src/components/viewport/EmptyViewport.tsx`
- Test: `studio/__tests__/components/viewport-new-frame.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/viewport-new-frame.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Viewport } from "../../src/components/viewport/Viewport";
import type { Project } from "../../server/types";

// Mock the api module; only createFrame matters here.
vi.mock("../../src/lib/api", () => ({
  api: {
    createFrame: vi.fn(),
  },
}));

// Mock the useFrames hook to return a deterministic list.
vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project) => ({ frames: project.frames, refresh: () => {} }),
}));

const projectWithOneFrame: Project = {
  slug: "demo",
  name: "Demo",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [
    {
      slug: "01-home",
      name: "Home",
      size: "1440",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
};

describe("Viewport + NewFrameCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the + New frame card alongside existing frames", () => {
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /new frame/i })).toBeInTheDocument();
  });

  it("creates a frame and seeds the chat on click", async () => {
    const { api } = await import("../../src/lib/api");
    (api.createFrame as any).mockResolvedValueOnce({
      slug: "02-untitled-1",
      name: "Untitled 1",
      size: "1440",
      createdAt: "2026-01-02T00:00:00Z",
    });

    const onSeedChat = vi.fn();
    render(
      <Viewport
        project={projectWithOneFrame}
        frameWidth={1440}
        onFrameWidthChange={() => {}}
        zoom={1}
        onZoomChange={() => {}}
        onSeedChat={onSeedChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /new frame/i }));

    await waitFor(() => expect(api.createFrame).toHaveBeenCalledWith("demo"));
    await waitFor(() =>
      expect(onSeedChat).toHaveBeenCalledWith("Design the Untitled 1 screen: "),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/viewport-new-frame.test.tsx`
Expected: FAIL — `onSeedChat` not in Viewport's type, or button not present.

- [ ] **Step 3: Update `Viewport.tsx`**

Edit `studio/src/components/viewport/Viewport.tsx`. Add imports:

```ts
import { useState } from "react";
import { NewFrameCard } from "./NewFrameCard";
import { api } from "../../lib/api";
```

Update the props:

```ts
export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
  zoom,
  onZoomChange,
  onSeedChat,
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  zoom: number;
  onZoomChange: (next: number) => void;
  onSeedChat: (text: string) => void;
}) {
```

Add state + click handler near the top of the function body:

```ts
const [creatingFrame, setCreatingFrame] = useState(false);

async function handleCreateFrame() {
  if (creatingFrame) return;
  setCreatingFrame(true);
  try {
    const frame = await api.createFrame(project.slug);
    onSeedChat(`Design the ${frame.name} screen: `);
  } catch (err) {
    console.warn("[Viewport] createFrame failed:", err);
  } finally {
    setCreatingFrame(false);
  }
}
```

Update the JSX. The empty-state path needs the button too, so pass down to `EmptyViewport`:

```tsx
if (!frames.length) return <EmptyViewport onCreateFrame={handleCreateFrame} busy={creatingFrame} />;

return (
  <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
    <div
      style={{
        display: "flex",
        gap: 64,
        padding: 32,
        height: "100%",
        width: "fit-content",
        minWidth: "100%",
      }}
    >
      {frames.map((f) => (
        <FrameCard
          key={f.slug}
          projectSlug={project.slug}
          frame={f}
          frameWidth={frameWidth}
          onFrameWidthChange={onFrameWidthChange}
          projectMode={project.mode}
          zoom={zoom}
        />
      ))}
      <NewFrameCard onClick={handleCreateFrame} busy={creatingFrame} />
    </div>
  </ViewportPreview>
);
```

- [ ] **Step 4: Update `EmptyViewport.tsx`**

Edit `studio/src/components/viewport/EmptyViewport.tsx`. Replace the whole file:

```tsx
import { NewFrameCard } from "./NewFrameCard";

export function EmptyViewport({
  onCreateFrame,
  busy,
}: {
  onCreateFrame: () => void;
  busy?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 24,
        color: "var(--fg-neutral-subtle)",
      }}
    >
      <div>Describe what you want to build — or drop a Figma frame into the chat.</div>
      <div style={{ fontSize: 12 }}>Or</div>
      <NewFrameCard onClick={onCreateFrame} busy={busy} />
    </div>
  );
}
```

Note: `NewFrameCard`'s current layout assumes the frame row's vertical space (`calc(100vh - 180px)`). If the empty-state version looks oversized in manual testing, we'll adjust by passing a `height` prop to `NewFrameCard` later — but only if needed. YAGNI.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/viewport-new-frame.test.tsx`
Expected: both tests PASS.

- [ ] **Step 6: Run the full suite**

Run: `pnpm run studio:test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add studio/src/components/viewport/Viewport.tsx studio/src/components/viewport/EmptyViewport.tsx studio/__tests__/components/viewport-new-frame.test.tsx
git commit -m "feat(studio/viewport): '+ New frame' card creates a blank frame and seeds chat"
```

---

## Task 7: Teach the agent about flows

Pure prompt change. The agent's behavior is verified by manual testing against a dev build; there's no automated test for prompt-level behavior.

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`

- [ ] **Step 1: Add the "When the prompt describes a flow" section**

Open `studio/templates/CLAUDE.md.tpl`. Find the section header `## Responsive design (required for every frame)` (currently around line 281). Insert a new section **above** it:

```markdown
## When the prompt describes a flow

Some prompts describe a user journey that should be split across multiple frames, not crammed into one. Before building, decide whether the prompt is flow-shaped.

**Flow signals (split applies):**
- Explicit step language: "4-step flow", "step 1 ... step 2 ...", "a wizard", "onboarding flow", "walk the user through", "checkout flow".
- Enumerated states implying separate screens: "signup -> verify email -> welcome", "empty / loading / error / success".
- A verb chain describing a user journey: "user lands, picks a plan, enters payment, confirms".

**Not a flow (build one frame):**
- Single-screen prompts: "a settings page", "a dashboard", "a login screen".
- Component-level prompts: "a button", "a modal".
- Iteration on an existing frame: "make the header bigger", "change the copy".

When unsure: build ONE frame and mention that splitting is an option. Over-detection costs the user a turn to undo; under-detection lets them ask for a split in the next turn.

### If the prompt is flow-shaped and the project has no existing frames for it

Do NOT write any frame on this turn. Reply with two sentences that:
1. Enumerate the steps you inferred.
2. Offer both paths: build as separate frames, or build as one frame.

Example:

> This looks like a 4-step onboarding flow: welcome -> signup -> verify email -> done. Want me to build each step as its own frame so you can see the whole flow side by side, or all in one frame?

Do NOT include a `### Deviations` section on this turn — nothing was built.

### If the user confirms the split (next turn)

Build ALL frames in this single turn. Name them with two-digit prefixes in flow order:
- `01-welcome`, `02-signup`, `03-verify-email`, `04-done`

Write them sequentially with separate `Write` calls. Do NOT batch into a single file or combine into one frame.

Produce ONE summary sentence + ONE `### Deviations` section covering the batch. The summary names the split ("Built 4 frames for the onboarding flow"). The Deviations section has at most 5 bullets across ALL frames (merge related deviations across frames).

### If the user declines the split

Build one frame. Normal response shape.

### If the project already has frames and the user is extending the flow

If the user prompts for additional steps ("add a confirmation step"), create frames for only the new steps, numbered after the highest existing two-digit prefix. Do NOT ask first — the user has committed to multiple frames. Normal response shape.

### Frame-targeted prompts

When a prompt names a specific frame by display name (e.g. "Design the Untitled 1 screen: a signup form", "update the Welcome frame's copy"), edit ONLY that frame's `index.tsx`. Do NOT create new frames, rename existing ones, or modify unrelated frames. This rule makes the `+ New frame` button's seed text route correctly — users click it, the chat input pre-fills with "Design the Untitled 1 screen: ", and whatever they add after should land in that specific frame.
```

- [ ] **Step 2: Verify CLAUDE.md refresh on server startup**

The server already refreshes `CLAUDE.md` for all existing projects on boot — see [studio/server/projects.ts:243](studio/server/projects.ts#L243) `refreshStaleClaudeMd()` called from `vite.config.ts:53`. No additional code needed; the next server boot will propagate the template change to every project.

- [ ] **Step 3: Smoke-test the template locally**

Start the dev server:

```bash
pnpm run studio
```

On boot you should see a log line like `[studio] refreshed CLAUDE.md for N project(s)`. Confirm one project's `CLAUDE.md` (open `~/Library/Application Support/arcade-studio/projects/<slug>/CLAUDE.md`) contains the new "When the prompt describes a flow" section.

- [ ] **Step 4: Commit**

```bash
git add studio/templates/CLAUDE.md.tpl
git commit -m "feat(studio/agent): teach the agent to split flow-shaped prompts into frames"
```

---

## Task 8: Version bump + changelog

**Files:**
- Modify: `studio/packaging/VERSION`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump version**

Read the current version: `cat studio/packaging/VERSION`. It should be `0.12.1` based on recent commits. Write `0.13.0` to the file (single line, no trailing content).

- [ ] **Step 2: Add changelog entry**

Edit `studio/CHANGELOG.md`. Add a new entry at the top (below the "# Changelog" heading, above the existing latest entry). Use today's date (2026-05-08):

```markdown
## [0.13.0] — 2026-05-08

### Added
- Agent now detects flow-shaped prompts ("4-step onboarding", "wizard", "checkout flow") and proposes splitting them into multiple frames before building.
- "+ New frame" button in the viewport and empty state. Click creates a blank frame and focuses the chat input with "Design the Untitled N screen: " pre-filled.
```

Match the keep-a-changelog style of existing entries.

- [ ] **Step 3: Commit**

```bash
git add studio/packaging/VERSION studio/CHANGELOG.md
git commit -m "chore(studio): bump to 0.13.0 — multi-frame flows"
```

---

## Done — manual verification

Before declaring the feature shipped, run through the success criteria from the spec manually in a dev build.

- [ ] **Start a clean dev build**

```bash
pnpm run studio
```

Open the app. Create a new project (theme arcade, mode light).

- [ ] **Verify flow detection asks first (do not build)**

In the chat, type: `Build a 4-step onboarding: welcome, signup, verify email, done`. Send.

Expected: Agent's response is two sentences enumerating the 4 steps and asking whether to split. Viewport stays empty. No `### Deviations` section in the response.

- [ ] **Verify the split produces N frames**

Reply: `yes, split them into separate frames`. Send.

Expected: Over the next few minutes, 4 frames appear in the viewport (`01-welcome`, `02-signup`, `03-verify-email`, `04-done`). Each renderable at a reasonable width. Chat shows one summary + one `### Deviations` section covering the batch.

- [ ] **Verify the "+ New frame" button**

Click `+ New frame` at the end of the frame row.

Expected: A new frame `05-untitled-1` (display name "Untitled 1") appears with the "This frame is blank" placeholder. Chat input is focused with `Design the Untitled 1 screen: ` pre-filled.

- [ ] **Verify frame-targeted prompt routes correctly**

Complete the prompt: `a signup form with email and password`. Send.

Expected: The agent writes only to `05-untitled-1/index.tsx`. No new frames created. Other frames untouched.

- [ ] **Verify under-detection works**

Create another new project. Type: `a settings page with two toggles`. Send.

Expected: Agent builds one frame (normal behavior). No split suggestion. Response has the normal summary + `### Deviations`.

- [ ] **Verify single-frame empty project path**

Create another new project. Before typing anything, click the `+ New frame` affordance in the empty state.

Expected: A blank `01-untitled-1` frame appears. Chat seeds `Design the Untitled 1 screen: `.

- [ ] **Ship**

If all checks pass, follow the release steps in `studio/CLAUDE.md` ("Releasing a new version"):

```bash
pnpm run studio:pack
# Then `gh release create v0.13.0 ...` per the studio/CLAUDE.md instructions
```

---

## Self-review notes

Ran the spec→plan coverage check:

- **Spec Section A (agent teaches flows):** Task 7.
- **Spec Section B (viewport + New frame button):** Tasks 2–6 (server endpoint, client helper, component, plumbing, wiring).
- **Spec Section C (proactive suggestion):** Implicit in Task 7 — the template detection rule fires on the first turn, so the agent's first response serves as the proactive suggestion. No separate task.
- **Spec's "Files touched" list:** All files in the spec's list are touched by at least one task.
- **Spec's "Success criteria":** All three bullets covered in the "Done — manual verification" section.
- **Naming:** `nextFramePrefix` used consistently across Tasks 1 and 2. `createFrame` consistent across Tasks 2 and 3. `onSeedChat` / `seedRef` consistent across Tasks 5 and 6.

No placeholders remain.
