# Studio Live Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Pencil.dev-style "live cursor + skeleton + reveal" effect in Studio's viewport during agent turns, decoupled from the generation pipeline.

**Architecture:** Parser emits a new `agent_cursor` `StudioEvent` alongside existing `tool_call` / `narration` events. The shared chat-stream reducer tracks per-turn cursor state (`frame`, `action`, `composites`, `narration`). A new client-only `LiveCursorLayer` paints an absolute-positioned pointer that flies between FrameCards. A new `FrameSkeleton` paints a composite-aware grey-block scaffold inside the targeted FrameCard. When the iframe `onLoad` fires during a running turn, a CSS top-down clip-path wipe reveals the real content.

**Tech Stack:** TypeScript, React, Vite, Vitest, `@xorkavi/arcade-gen` (mocked in tests). No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-05-28-studio-live-cursor-design.md`

---

## File map

| Path | Status | Responsibility |
|---|---|---|
| `studio/src/lib/streamJson.ts` | modify | Add `agent_cursor` to `StudioEvent` union; emit it in `parseStreamLineAll` after each `tool_use` |
| `studio/src/lib/agentCursor.ts` | create | `extractComposites(content)`, `mapPathToFrame(path, frames)` |
| `studio/__tests__/lib/agentCursor.test.ts` | create | Unit tests for both utils |
| `studio/__tests__/lib/streamJson.test.ts` | modify | Add cases for `agent_cursor` emission alongside existing tool_call cases |
| `studio/src/hooks/chatStreamReducer.ts` | modify | Extend `StreamState` with `agentCursor`; reduce new event |
| `studio/__tests__/lib/chatStreamReducer.test.ts` | create | Reducer tests for cursor state transitions |
| `studio/src/components/viewport/LiveCursorLayer.tsx` | create | Pointer + bubble overlay |
| `studio/__tests__/components/liveCursorLayer.test.tsx` | create | Component tests |
| `studio/src/components/viewport/skeletonShapes.ts` | create | Composite → shape map |
| `studio/src/components/viewport/FrameSkeleton.tsx` | create | Skeleton overlay |
| `studio/__tests__/components/frameSkeleton.test.tsx` | create | Component tests |
| `studio/src/components/viewport/FrameCard.tsx` | modify | Accept `agentCursor` + `phase`; render `<FrameSkeleton>`; trigger wipe on iframe `onLoad` while running |
| `studio/__tests__/components/frameCard-wipe.test.tsx` | create | Wipe behavior tests |
| `studio/src/components/viewport/Viewport.tsx` | modify | Accept `agentCursor` + `phase`; pass to FrameCard; mount `<LiveCursorLayer>` |
| `studio/src/routes/ProjectDetail.tsx` | modify | Pull `agentCursor` + `phase` from `chatStream`/spectator stream; pass to Viewport |
| `studio/src/styles/index.css` (or whichever global stylesheet currently lives there) | modify | Add `.arcade-studio-frame-wipe::before/::after` keyframes |
| `studio/CHANGELOG.md` | modify | Add per-slice entries |
| `package.json` | modify | Bump version per slice |

Slices (one PR per slice):
1. **Tasks 1–4** — parser + util + reducer (no UI)
2. **Tasks 5–7** — LiveCursorLayer cursor + bubble (visible win)
3. **Tasks 8–9** — FrameSkeleton + composite registry
4. **Tasks 10–11** — FrameCard wipe + CSS
5. **Polish (out of plan)** — click bounce, narration noun chips

Each slice ships independently with a CHANGELOG entry + version bump.

---

## Task 1: `extractComposites` util + tests

**Files:**
- Create: `studio/src/lib/agentCursor.ts`
- Test: `studio/__tests__/lib/agentCursor.test.ts`

- [ ] **Step 1: Write failing test for `extractComposites`**

Create `studio/__tests__/lib/agentCursor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractComposites } from "../../src/lib/agentCursor";

describe("extractComposites", () => {
  it("returns [] for empty input", () => {
    expect(extractComposites("")).toEqual([]);
  });

  it("returns [] when no composite imports are present", () => {
    expect(extractComposites('import { useState } from "react";')).toEqual([]);
  });

  it("extracts named imports from @xorkavi/arcade-gen", () => {
    const src = `import { Button, Input as Field } from "@xorkavi/arcade-gen";`;
    expect(extractComposites(src)).toEqual(["Button", "Input"]);
  });

  it("extracts default and named imports from a relative composites path", () => {
    const src = [
      `import Hero from "../prototype-kit/composites/Hero";`,
      `import { Card, Footer } from "../../prototype-kit/composites/CardKit";`,
    ].join("\n");
    expect(extractComposites(src).sort()).toEqual(["Card", "Footer", "Hero"]);
  });

  it("dedupes repeated identifiers", () => {
    const src = [
      `import { Button } from "@xorkavi/arcade-gen";`,
      `import { Button } from "@xorkavi/arcade-gen";`,
    ].join("\n");
    expect(extractComposites(src)).toEqual(["Button"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/agentCursor.test.ts`
Expected: FAIL — module `../../src/lib/agentCursor` not found.

- [ ] **Step 3: Implement `extractComposites`**

Create `studio/src/lib/agentCursor.ts`:

```ts
/**
 * Extract composite identifiers from a code snippet so the live-cursor
 * skeleton can draw shape hints. Recognizes:
 *   - import { A, B as C } from "@xorkavi/arcade-gen"
 *   - import Foo from "<path>/composites/<Name>"
 *   - import { A, B } from "<path>/composites/<Name>"
 *
 * Returns a deduped, insertion-ordered array. Returns [] for content
 * that doesn't match — callers fall back to a generic skeleton shape.
 */
export function extractComposites(content: string): string[] {
  const out = new Set<string>();

  const reArcadeGen = /import\s*\{([^}]+)\}\s*from\s*['"]@xorkavi\/arcade-gen['"]/g;
  for (let m = reArcadeGen.exec(content); m; m = reArcadeGen.exec(content)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }

  const reCompositesNamed =
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (let m = reCompositesNamed.exec(content); m; m = reCompositesNamed.exec(content)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }

  const reCompositesDefault =
    /import\s+(\w+)\s+from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (let m = reCompositesDefault.exec(content); m; m = reCompositesDefault.exec(content)) {
    out.add(m[1]);
  }

  return Array.from(out);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/lib/agentCursor.test.ts`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/agentCursor.ts studio/__tests__/lib/agentCursor.test.ts
git commit -m "feat(studio/live-cursor): add extractComposites util"
```

---

## Task 2: `mapPathToFrame` util + tests

**Files:**
- Modify: `studio/src/lib/agentCursor.ts`
- Modify: `studio/__tests__/lib/agentCursor.test.ts`

- [ ] **Step 1: Add failing tests for `mapPathToFrame`**

Append to `studio/__tests__/lib/agentCursor.test.ts`:

```ts
import { mapPathToFrame } from "../../src/lib/agentCursor";

const FRAMES = [
  { slug: "home", name: "Home" },
  { slug: "details", name: "Details" },
] as { slug: string; name: string }[];

describe("mapPathToFrame", () => {
  it("returns null for an empty path", () => {
    expect(mapPathToFrame("", FRAMES)).toBeNull();
  });

  it("returns null when the path has no /frames/ segment", () => {
    expect(mapPathToFrame("/Users/x/projects/app/index.tsx", FRAMES)).toBeNull();
  });

  it("returns the slug when the path contains /frames/<slug>/...", () => {
    expect(
      mapPathToFrame(
        "/Users/x/projects/app/frames/home/index.tsx",
        FRAMES,
      ),
    ).toBe("home");
  });

  it("returns null when the slug is not in the frames list", () => {
    expect(
      mapPathToFrame(
        "/Users/x/projects/app/frames/about/index.tsx",
        FRAMES,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/agentCursor.test.ts`
Expected: FAIL — `mapPathToFrame` is not exported.

- [ ] **Step 3: Implement `mapPathToFrame`**

Append to `studio/src/lib/agentCursor.ts`:

```ts
/**
 * Resolve a tool_call file_path to a frame slug. Returns the slug when
 * the path contains `/frames/<slug>/...` AND `<slug>` is in the project's
 * frame list. Returns null otherwise — caller parks the cursor.
 *
 * Frame slugs are constrained to [a-z0-9-]+ server-side
 * (see projectSchema in server/types.ts).
 */
export function mapPathToFrame(
  path: string,
  frames: ReadonlyArray<{ slug: string }>,
): string | null {
  if (!path) return null;
  const m = /\/frames\/([a-z0-9-]+)\//i.exec(path);
  if (!m) return null;
  const slug = m[1];
  return frames.some((f) => f.slug === slug) ? slug : null;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/lib/agentCursor.test.ts`
Expected: PASS — 9/9.

- [ ] **Step 5: Commit**

```bash
git add studio/src/lib/agentCursor.ts studio/__tests__/lib/agentCursor.test.ts
git commit -m "feat(studio/live-cursor): add mapPathToFrame util"
```

---

## Task 3: `agent_cursor` event + parser emission

**Files:**
- Modify: `studio/src/lib/streamJson.ts`
- Modify: `studio/__tests__/lib/streamJson.test.ts`

- [ ] **Step 1: Add failing tests for new event emission**

Append to `studio/__tests__/lib/streamJson.test.ts`:

```ts
import { parseStreamLineAll } from "../../src/lib/streamJson";

describe("parseStreamLineAll: agent_cursor", () => {
  it("emits agent_cursor reading after a Read tool_call", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/p/frames/home/index.tsx" },
          },
        ],
      },
    }));
    expect(events).toEqual([
      expect.objectContaining({ kind: "tool_call", tool: "Read" }),
      {
        kind: "agent_cursor",
        frame: null,
        action: "reading",
        filePath: "/p/frames/home/index.tsx",
      },
    ]);
  });

  it("emits agent_cursor writing with composites for Write", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Write",
            input: {
              file_path: "/p/frames/home/index.tsx",
              content: 'import { Button } from "@xorkavi/arcade-gen";',
            },
          },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Button"],
    });
  });

  it("emits agent_cursor editing with composites for Edit", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: {
              file_path: "/p/frames/home/index.tsx",
              new_string: 'import { Card } from "@xorkavi/arcade-gen";',
            },
          },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({
      kind: "agent_cursor",
      frame: null,
      action: "editing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Card"],
    });
  });

  it("emits agent_cursor thinking with frame=null for Bash", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    }));
    const cursor = events.find((e) => e.kind === "agent_cursor");
    expect(cursor).toEqual({ kind: "agent_cursor", frame: null, action: "thinking" });
  });

  it("does not emit agent_cursor for plain narration", () => {
    const events = parseStreamLineAll(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Building Home" }] },
    }));
    expect(events.find((e) => e.kind === "agent_cursor")).toBeUndefined();
    expect(events.find((e) => e.kind === "narration")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/streamJson.test.ts`
Expected: FAIL — `agent_cursor` events not emitted.

- [ ] **Step 3: Extend `StudioEvent` union**

In `studio/src/lib/streamJson.ts`, add to the `StudioEvent` union (after the existing `tool_result` member, before `end`):

```ts
  | {
      kind: "agent_cursor";
      /** Frame slug being targeted, or null = parked (no clear target).
       *  Parser leaves this as null; client resolves via mapPathToFrame. */
      frame: string | null;
      action: "reading" | "writing" | "editing" | "thinking";
      filePath?: string;
      composites?: string[];
    }
```

- [ ] **Step 4: Emit `agent_cursor` from `parseStreamLineAll`**

In `studio/src/lib/streamJson.ts`, locate the `assistant` branch (the loop over `ev.message.content`) and add cursor emission alongside tool_call. Replace the existing `else if (c.type === "tool_use")` block with:

```ts
      } else if (c.type === "tool_use") {
        const pr = prettyTool(c.name, c.input);
        out.push({ kind: "tool_call", ...pr });
        out.push(toolUseToCursor(c.name, c.input));
      }
```

Then add a helper at the bottom of the file (after `basename`, before `parseStreamLine`):

```ts
function toolUseToCursor(name: string, input: any): StudioEvent {
  if (name === "Read") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "reading",
      filePath: input?.file_path ? String(input.file_path) : undefined,
    };
  }
  if (name === "Write") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: input?.file_path ? String(input.file_path) : undefined,
      composites: extractComposites(String(input?.content ?? "")),
    };
  }
  if (name === "Edit") {
    return {
      kind: "agent_cursor",
      frame: null,
      action: "editing",
      filePath: input?.file_path ? String(input.file_path) : undefined,
      composites: extractComposites(String(input?.new_string ?? "")),
    };
  }
  return { kind: "agent_cursor", frame: null, action: "thinking" };
}
```

Add this import at the top:

```ts
import { extractComposites } from "./agentCursor";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/lib/streamJson.test.ts`
Expected: PASS — all new tests + existing 8 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add studio/src/lib/streamJson.ts studio/__tests__/lib/streamJson.test.ts
git commit -m "feat(studio/live-cursor): emit agent_cursor events from parser"
```

---

## Task 4: Reducer state for `agentCursor`

**Files:**
- Modify: `studio/src/hooks/chatStreamReducer.ts`
- Create: `studio/__tests__/lib/chatStreamReducer.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `studio/__tests__/lib/chatStreamReducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  applyStudioEvent,
  INITIAL_STREAM_STATE,
} from "../../src/hooks/chatStreamReducer";

describe("chatStreamReducer: agentCursor", () => {
  it("starts with agentCursor: null", () => {
    expect(INITIAL_STREAM_STATE.agentCursor).toBeNull();
  });

  it("agent_cursor event sets cursor state", () => {
    const next = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    expect(next.agentCursor).toMatchObject({
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    expect(typeof next.agentCursor!.updatedAt).toBe("number");
  });

  it("agent_cursor preserves narration when one already exists", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "narration",
      text: "Let me start with the home screen",
    });
    s = applyStudioEvent(s, {
      kind: "agent_cursor",
      frame: null,
      action: "reading",
      filePath: "/p/frames/home/index.tsx",
    });
    expect(s.agentCursor?.narration).toBe("Let me start with the home screen");
    expect(s.agentCursor?.action).toBe("reading");
  });

  it("narration updates bubble text without overwriting frame/action", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
      filePath: "/p/frames/home/index.tsx",
      composites: ["Hero"],
    });
    s = applyStudioEvent(s, { kind: "narration", text: "Adding hero" });
    expect(s.agentCursor?.narration).toBe("Adding hero");
    expect(s.agentCursor?.action).toBe("writing");
    expect(s.agentCursor?.composites).toEqual(["Hero"]);
  });

  it("narration before any cursor event hydrates a thinking cursor", () => {
    const s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "narration",
      text: "Reading existing frames",
    });
    expect(s.agentCursor).toMatchObject({
      frame: null,
      action: "thinking",
      narration: "Reading existing frames",
    });
  });

  it("end event clears agentCursor", () => {
    let s = applyStudioEvent(INITIAL_STREAM_STATE, {
      kind: "agent_cursor",
      frame: null,
      action: "writing",
    });
    s = applyStudioEvent(s, { kind: "end", ok: true });
    expect(s.agentCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/lib/chatStreamReducer.test.ts`
Expected: FAIL — `agentCursor` not on `StreamState`.

- [ ] **Step 3: Extend `StreamState` and `INITIAL_STREAM_STATE`**

In `studio/src/hooks/chatStreamReducer.ts`, add inside the `StreamState` interface (after `turnEndedAt`):

```ts
  /** Live cursor state derived from agent_cursor + narration events.
   *  Null when no turn is running or when a turn just ended. */
  agentCursor: {
    frame: string | null;
    action: "reading" | "writing" | "editing" | "thinking";
    filePath?: string;
    composites: string[];
    narration?: string;
    updatedAt: number;
  } | null;
```

In `INITIAL_STREAM_STATE`, add:

```ts
  agentCursor: null,
```

- [ ] **Step 4: Reduce `agent_cursor` events**

In `applyStudioEvent`, before the final `return { ...s, lastEvent: ev };`, add:

```ts
  if (ev.kind === "agent_cursor") {
    return {
      ...s,
      lastEvent: ev,
      agentCursor: {
        frame: ev.frame,
        action: ev.action,
        filePath: ev.filePath,
        composites: ev.composites ?? [],
        narration: s.agentCursor?.narration,
        updatedAt: Date.now(),
      },
    };
  }
```

- [ ] **Step 5: Update the `narration` branch to mirror text into `agentCursor`**

Replace the existing `narration` branch in `applyStudioEvent` with:

```ts
  if (ev.kind === "narration") {
    const cursor = s.agentCursor
      ? { ...s.agentCursor, narration: ev.text, updatedAt: Date.now() }
      : {
          frame: null,
          action: "thinking" as const,
          composites: [],
          narration: ev.text,
          updatedAt: Date.now(),
        };
    return {
      ...s,
      lastEvent: ev,
      narrations: [...s.narrations, ev.text],
      items: appendItem(s.items, { kind: "narration", text: ev.text }),
      agentCursor: cursor,
    };
  }
```

- [ ] **Step 6: Clear `agentCursor` on `end`**

In each `if (ev.kind === "end")` branch (success, cancelled, error), add `agentCursor: null` to the returned state. Three returns to update — verify all three.

- [ ] **Step 7: Run reducer tests, verify pass**

Run: `pnpm run studio:test studio/__tests__/lib/chatStreamReducer.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 8: Run full suite to confirm no regressions**

Run: `pnpm run studio:test`
Expected: PASS — full suite green.

- [ ] **Step 9: Commit**

```bash
git add studio/src/hooks/chatStreamReducer.ts studio/__tests__/lib/chatStreamReducer.test.ts
git commit -m "feat(studio/live-cursor): track agent cursor + narration in reducer"
```

---

## Task 4b: Slice 1 release — version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Read current version**

Run: `node -p "require('./package.json').version"`
Note the current version (call it `X.Y.Z`).

- [ ] **Step 2: Bump minor version**

Edit `package.json`'s `version` field to `X.(Y+1).0`.

- [ ] **Step 3: Add CHANGELOG entry**

Prepend to `studio/CHANGELOG.md` under the top heading:

```markdown
## [X.(Y+1).0] — 2026-05-28

### Added
- Internal `agent_cursor` events emitted by the chat-stream parser, plus
  `StreamState.agentCursor` reducer state. Foundation for the live-cursor
  effect — no UI yet.
```

(Substitute the actual version computed in Step 2.)

- [ ] **Step 4: Commit**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump version + changelog for live-cursor slice 1"
```

---

## Task 5: Stub `LiveCursorLayer` + test that it renders the pointer at a frame

**Files:**
- Create: `studio/src/components/viewport/LiveCursorLayer.tsx`
- Create: `studio/__tests__/components/liveCursorLayer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `studio/__tests__/components/liveCursorLayer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import {
  LiveCursorLayer,
  targetPointFor,
} from "../../src/components/viewport/LiveCursorLayer";

vi.mock("@xorkavi/arcade-gen", () => ({}));

function Harness(props: {
  agentCursor: any;
  phase: any;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} style={{ position: "relative", width: 800, height: 600 }}>
      <div data-frame-slug="home" style={{ position: "absolute", left: 100, top: 50, width: 400, height: 300 }} />
      <LiveCursorLayer
        agentCursor={props.agentCursor}
        phase={props.phase}
        containerRef={ref as RefObject<HTMLDivElement>}
        frames={[{ slug: "home", name: "Home" }] as any}
      />
    </div>
  );
}

describe("targetPointFor", () => {
  const containerRect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
  const frameRect = { left: 100, top: 50, width: 400, height: 300 } as DOMRect;

  it("reading sits at top-left inset by 24px", () => {
    expect(targetPointFor(frameRect, containerRect, "reading")).toEqual({
      x: 124,
      y: 74,
    });
  });

  it("writing returns a point inside the upper third of the frame", () => {
    const p = targetPointFor(frameRect, containerRect, "writing", "/p/frames/home/index.tsx");
    expect(p.x).toBeGreaterThanOrEqual(124);
    expect(p.x).toBeLessThan(100 + 400);
    expect(p.y).toBeGreaterThanOrEqual(74);
    expect(p.y).toBeLessThan(50 + 300 / 3 + 24);
  });

  it("thinking parks at frame center", () => {
    expect(targetPointFor(frameRect, containerRect, "thinking")).toEqual({
      x: 300, // 100 + 400/2
      y: 200, // 50  + 300/2
    });
  });

  it("subtracts container offset so coords are layer-local", () => {
    const offset = { left: 30, top: 20, width: 800, height: 600 } as DOMRect;
    const p = targetPointFor(frameRect, offset, "reading");
    expect(p).toEqual({ x: 124 - 30, y: 74 - 20 });
  });
});

describe("LiveCursorLayer", () => {
  it("renders nothing when phase is idle", () => {
    const { container } = render(<Harness phase="idle" agentCursor={null} />);
    expect(container.querySelector('[data-testid="live-cursor"]')).toBeNull();
  });

  it("renders a pointer when phase is running and a cursor state is set", () => {
    const { container } = render(
      <Harness
        phase="running"
        agentCursor={{
          frame: null,
          action: "thinking",
          composites: [],
          updatedAt: Date.now(),
        }}
      />,
    );
    expect(container.querySelector('[data-testid="live-cursor"]')).not.toBeNull();
  });

  it("renders a bubble when narration is present", () => {
    const { container } = render(
      <Harness
        phase="running"
        agentCursor={{
          frame: null,
          action: "thinking",
          composites: [],
          narration: "Reading existing frames",
          updatedAt: Date.now(),
        }}
      />,
    );
    const bubble = container.querySelector(
      '[data-testid="live-cursor-bubble"]',
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("Reading");
  });
});
```

Note: the rendered-transform values can't be asserted in jsdom because
`getBoundingClientRect` returns zeros without a layout engine. Position
correctness is covered by the `targetPointFor` pure-function tests above.

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/liveCursorLayer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LiveCursorLayer`**

Create `studio/src/components/viewport/LiveCursorLayer.tsx`:

```tsx
import { useEffect, useState, type RefObject } from "react";
import type { Frame } from "../../../server/types";
import type { StreamState, TurnPhase } from "../../hooks/chatStreamReducer";
import { mapPathToFrame } from "../../lib/agentCursor";

const POINTER_SIZE = 18;

/**
 * Pure: given a frame's rect and the layer's container rect, decide where
 * to place the pointer for the current action. Exported so tests can hit
 * the math directly — jsdom doesn't lay elements out, so the rendered
 * transform isn't observable in tests.
 */
export function targetPointFor(
  rect: DOMRect,
  containerRect: DOMRect,
  action: "reading" | "writing" | "editing" | "thinking",
  filePath?: string,
): { x: number; y: number } {
  const left = rect.left - containerRect.left;
  const top = rect.top - containerRect.top;
  if (action === "reading") {
    return { x: left + 24, y: top + 24 };
  }
  if (action === "writing" || action === "editing") {
    // Stable hash of filePath into a point in the upper third.
    let h = 0;
    for (let i = 0; i < (filePath?.length ?? 0); i += 1) {
      h = (h * 31 + filePath!.charCodeAt(i)) | 0;
    }
    const fx = Math.abs(h) % Math.max(1, Math.floor(rect.width - 48));
    const fy = Math.abs(h >> 8) % Math.max(1, Math.floor(rect.height / 3));
    return { x: left + 24 + fx, y: top + 24 + fy };
  }
  // thinking: park near the center of the frame.
  return { x: left + rect.width / 2, y: top + rect.height / 2 };
}

export function LiveCursorLayer({
  agentCursor,
  phase,
  containerRef,
  frames,
}: {
  agentCursor: StreamState["agentCursor"];
  phase: TurnPhase;
  containerRef: RefObject<HTMLDivElement>;
  frames: Frame[];
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const slug =
    agentCursor && (agentCursor.frame ?? mapPathToFrame(agentCursor.filePath ?? "", frames));

  useEffect(() => {
    if (phase !== "running" || !agentCursor) {
      setPos(null);
      return;
    }
    function recompute() {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      if (!slug) {
        setPos({ x: containerRect.width / 2, y: containerRect.height / 2 });
        return;
      }
      const el = container.querySelector(`[data-frame-slug="${CSS.escape(slug)}"]`);
      if (!el) {
        setPos({ x: containerRect.width / 2, y: containerRect.height / 2 });
        return;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      setPos(targetPointFor(rect, containerRect, agentCursor!.action, agentCursor!.filePath));
    }
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [phase, agentCursor, slug, containerRef]);

  if (phase !== "running" || !agentCursor || !pos) return null;

  const bubbleText = agentCursor.narration?.slice(0, 80) ?? "";

  return (
    <>
      <div
        data-testid="live-cursor"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: POINTER_SIZE,
          height: POINTER_SIZE,
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <svg
          width={POINTER_SIZE}
          height={POINTER_SIZE}
          viewBox="0 0 18 18"
          aria-hidden="true"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }}
        >
          <path
            d="M2 2 L2 14 L6 11 L9 16 L12 14 L9 9 L14 9 Z"
            fill="white"
            stroke="black"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {bubbleText && (
        <div
          data-testid="live-cursor-bubble"
          title={agentCursor.narration ?? ""}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate(${pos.x + 16}px, ${pos.y - 8}px)`,
            transition: "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: "var(--surface-overlay)",
            color: "var(--fg-neutral-medium)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 8,
            padding: "4px 8px",
            fontSize: 12,
            maxWidth: 240,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {bubbleText}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/components/liveCursorLayer.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/LiveCursorLayer.tsx studio/__tests__/components/liveCursorLayer.test.tsx
git commit -m "feat(studio/live-cursor): add LiveCursorLayer overlay"
```

---

## Task 6: Wire `LiveCursorLayer` into `Viewport`

**Files:**
- Modify: `studio/src/components/viewport/Viewport.tsx`

- [ ] **Step 1: Add `agentCursor` + `phase` props to Viewport**

In `Viewport.tsx`, extend the props type to include:

```ts
  agentCursor: import("../../hooks/chatStreamReducer").StreamState["agentCursor"];
  phase: import("../../hooks/chatStreamReducer").TurnPhase;
```

Update the destructured signature accordingly.

- [ ] **Step 2: Mount LiveCursorLayer**

Add an import at the top of `Viewport.tsx`:

```ts
import { LiveCursorLayer } from "./LiveCursorLayer";
import { useRef } from "react";
```

(Adjust the existing react import if `useRef` is not already imported.)

In the `return (...)` block, inside `<ViewportPreview>`, wrap the existing `<div>` (the one at line ~167 with `display: flex; gap: 64; ...`) so that:
- The wrapping `<div>` becomes a `position: relative` container we can attach `containerRef` to
- `<LiveCursorLayer>` is mounted as a sibling of the FrameCard list

```tsx
<ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
  {(() => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    return (
      <div
        ref={containerRef}
        style={{
          position: "relative",
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
            highlighted={highlight?.slug === f.slug ? highlight.kind : null}
            readonly={isReadonly}
            srcOverride={frameSrcOverride}
          />
        ))}
        {!isReadonly && (
          <NewFrameCard onClick={handleCreateFrame} busy={creatingFrame} />
        )}
        <LiveCursorLayer
          agentCursor={agentCursor}
          phase={phase}
          containerRef={containerRef}
          frames={frames}
        />
      </div>
    );
  })()}
</ViewportPreview>
```

The IIFE keeps `useRef` colocated; if Viewport's existing structure makes this awkward, hoist `containerRef` into the component body and use a regular block — equivalent.

**Cleaner alternative**: hoist `containerRef = useRef(...)` to the top of `Viewport`, drop the IIFE, and render normally:

```tsx
const containerRef = useRef<HTMLDivElement | null>(null);
// ...
return (
  <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: "flex",
        gap: 64,
        padding: 32,
        height: "100%",
        width: "fit-content",
        minWidth: "100%",
      }}
    >
      {frames.map((f) => (/* unchanged */))}
      {!isReadonly && (/* unchanged */)}
      <LiveCursorLayer
        agentCursor={agentCursor}
        phase={phase}
        containerRef={containerRef}
        frames={frames}
      />
    </div>
  </ViewportPreview>
);
```

Use the cleaner alternative.

- [ ] **Step 3: Run viewport tests to confirm no regression**

Run: `pnpm run studio:test studio/__tests__/components/viewport-frame-link-nav.test.tsx studio/__tests__/components/viewport-readonly.test.tsx studio/__tests__/components/viewport-new-frame.test.tsx`
Expected: PASS — existing 3 viewport tests still green.

If a test breaks because Viewport's prop list changed, update the test harness to pass `agentCursor={null}` and `phase="idle"`.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/viewport/Viewport.tsx studio/__tests__/components/viewport-*.test.tsx
git commit -m "feat(studio/live-cursor): mount LiveCursorLayer in viewport"
```

---

## Task 7: Wire cursor state through `ProjectDetail`

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`

- [ ] **Step 1: Locate Viewport mount point**

Open `studio/src/routes/ProjectDetail.tsx`. The Viewport mount lives near line 468 (per grep). The chat-stream context provides `state.agentCursor` and `state.phase`.

- [ ] **Step 2: Pull cursor + phase from chat-stream context near the Viewport mount**

If the route already destructures from a `chatStream` source object (line 230 references `chatStream.state` indirectly), pull `agentCursor` + `phase` from that same source:

```tsx
const agentCursor = chatStream.state.agentCursor;
const phase = chatStream.state.phase;
```

If the spectator branch uses a different source object, do the same destructure there. (Inspect the file before editing — both branches should already expose a `state` field of `StreamState` shape.)

- [ ] **Step 3: Pass props to Viewport**

Update the `<Viewport ... />` JSX to include:

```tsx
agentCursor={agentCursor}
phase={phase}
```

- [ ] **Step 4: Run full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 5: Manual smoke (UI verification)**

Run the dev server: `pnpm run studio`
- Open a project, type a prompt, observe a turn
- Confirm: pointer appears in viewport, flies between FrameCards as the agent reads/writes files mapped to those frames
- Confirm: bubble shows truncated narration text
- Confirm: pointer disappears at end of turn
- Confirm: no console errors; no regression in chat or frame editing

If the cursor is invisible: check z-index against modals/toasts (grep `z-index` in `studio/src/`) and bump the layer's `zIndex` if needed.

- [ ] **Step 6: Commit**

```bash
git add studio/src/routes/ProjectDetail.tsx
git commit -m "feat(studio/live-cursor): pass cursor state from ProjectDetail"
```

---

## Task 7b: Slice 2 release — version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump minor version**

Bump `package.json`'s `version` to the next minor.

- [ ] **Step 2: CHANGELOG entry**

Prepend to `studio/CHANGELOG.md`:

```markdown
## [X.Y.Z] — 2026-05-28

### Added
- Live cursor in the viewport during agent turns: an anonymous pointer
  flies between FrameCards based on which file the agent is reading,
  writing, or editing. A small bubble next to the cursor shows the
  agent's narration. Spectators see the cursor automatically through
  the existing event-replay pipeline.
```

- [ ] **Step 3: Commit**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump version + changelog for live-cursor slice 2"
```

---

## Task 8: `skeletonShapes` registry

**Files:**
- Create: `studio/src/components/viewport/skeletonShapes.ts`

- [ ] **Step 1: Create registry**

Create `studio/src/components/viewport/skeletonShapes.ts`:

```ts
/**
 * Static map of composite name → skeleton shape for the live cursor's
 * pre-paint scaffold. Keys must match the component identifiers users
 * import from `@xorkavi/arcade-gen` or the local `prototype-kit/composites/`.
 *
 * Adding a new composite to prototype-kit? Add an entry here too. Missing
 * entries are silently ignored (caller falls back to a generic block).
 */
export type SkeletonShape =
  | { kind: "block";    height: string }
  | { kind: "bar";      height: string; anchor: "top" | "bottom" }
  | { kind: "rail";     width:  string; anchor: "left" | "right" }
  | { kind: "tile";     aspect: string; repeat: number }
  | { kind: "centered"; width:  string; height: string };

export const SHAPES: Readonly<Record<string, SkeletonShape>> = {
  Hero:    { kind: "block",    height: "30%" },
  Header:  { kind: "bar",      height: "8%",  anchor: "top"    },
  Footer:  { kind: "bar",      height: "8%",  anchor: "bottom" },
  Sidebar: { kind: "rail",     width:  "20%", anchor: "left"   },
  Card:    { kind: "tile",     aspect: "4/3", repeat: 3        },
  Modal:   { kind: "centered", width:  "60%", height: "50%"    },
};
```

- [ ] **Step 2: Commit**

```bash
git add studio/src/components/viewport/skeletonShapes.ts
git commit -m "feat(studio/live-cursor): add skeletonShapes registry"
```

---

## Task 9: `FrameSkeleton` component + tests

**Files:**
- Create: `studio/src/components/viewport/FrameSkeleton.tsx`
- Create: `studio/__tests__/components/frameSkeleton.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `studio/__tests__/components/frameSkeleton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FrameSkeleton } from "../../src/components/viewport/FrameSkeleton";

vi.mock("@xorkavi/arcade-gen", () => ({}));

describe("FrameSkeleton", () => {
  it("renders nothing when visible is false", () => {
    const { container } = render(<FrameSkeleton visible={false} composites={["Hero"]} />);
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });

  it("renders generic 4-block fallback when composites is empty", () => {
    const { container } = render(<FrameSkeleton visible composites={[]} />);
    const blocks = container.querySelectorAll('[data-skeleton-block]');
    expect(blocks).toHaveLength(4);
  });

  it("renders one block per known composite", () => {
    const { container } = render(<FrameSkeleton visible composites={["Header", "Hero", "Footer"]} />);
    const blocks = container.querySelectorAll('[data-skeleton-block]');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("ignores unknown composites without crashing", () => {
    const { container } = render(<FrameSkeleton visible composites={["TotallyMadeUp"]} />);
    expect(container.querySelector('[data-testid="frame-skeleton"]')).not.toBeNull();
  });

  it("renders Card with the registry repeat count", () => {
    const { container } = render(<FrameSkeleton visible composites={["Card"]} />);
    const cardBlocks = container.querySelectorAll('[data-skeleton-block="Card"]');
    expect(cardBlocks).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/frameSkeleton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FrameSkeleton`**

Create `studio/src/components/viewport/FrameSkeleton.tsx`:

```tsx
import { SHAPES, type SkeletonShape } from "./skeletonShapes";

const FALLBACK: Array<{ name: string; shape: SkeletonShape }> = [
  { name: "Header", shape: SHAPES.Header },
  { name: "block-a", shape: { kind: "block", height: "30%" } },
  { name: "block-b", shape: { kind: "block", height: "30%" } },
  { name: "Footer", shape: SHAPES.Footer },
];

function blockStyle(): React.CSSProperties {
  return {
    background: "var(--surface-overlay-2, rgba(255,255,255,0.08))",
    borderRadius: 8,
    animation: "arcade-studio-skeleton-pulse 1.6s ease-in-out infinite alternate",
  };
}

export function FrameSkeleton({
  composites,
  visible,
}: {
  composites: string[];
  visible: boolean;
}) {
  if (!visible) return null;

  const known = composites
    .map((name) => ({ name, shape: SHAPES[name] }))
    .filter((entry): entry is { name: string; shape: SkeletonShape } => Boolean(entry.shape));

  const entries = known.length > 0 ? known : FALLBACK;

  const top = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "top");
  const bottom = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "bottom");
  const left = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "left");
  const right = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "right");
  const center = entries.filter((e) =>
    e.shape.kind !== "bar" && e.shape.kind !== "rail",
  );

  return (
    <div
      data-testid="frame-skeleton"
      style={{
        position: "absolute",
        inset: 0,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      {top.map((e, i) => (
        <div
          key={`top-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(), height: (e.shape as any).height }}
        />
      ))}
      <div style={{ flex: 1, display: "flex", gap: 16 }}>
        {left.map((e, i) => (
          <div
            key={`left-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(), width: (e.shape as any).width }}
          />
        ))}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {center.flatMap((e, i) => {
            if (e.shape.kind === "tile") {
              const tiles = Array.from({ length: e.shape.repeat }).map((_, j) => (
                <div
                  key={`tile-${e.name}-${i}-${j}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(),
                    aspectRatio: e.shape.aspect,
                    flex: 1,
                  }}
                />
              ));
              return [
                <div
                  key={`tile-row-${i}`}
                  style={{ display: "flex", gap: 16, flex: 1 }}
                >
                  {tiles}
                </div>,
              ];
            }
            if (e.shape.kind === "centered") {
              return [
                <div
                  key={`center-${e.name}-${i}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(),
                    width: e.shape.width,
                    height: e.shape.height,
                    alignSelf: "center",
                    margin: "auto",
                  }}
                />,
              ];
            }
            return [
              <div
                key={`block-${e.name}-${i}`}
                data-skeleton-block={e.name}
                style={{ ...blockStyle(), height: (e.shape as any).height ?? "100%" }}
              />,
            ];
          })}
        </div>
        {right.map((e, i) => (
          <div
            key={`right-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(), width: (e.shape as any).width }}
          />
        ))}
      </div>
      {bottom.map((e, i) => (
        <div
          key={`bottom-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(), height: (e.shape as any).height }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the pulse keyframe to the global stylesheet**

Find the active global stylesheet (`grep -l 'tailwind' studio/src/styles/*.css` or check `studio/src/main.tsx` for a `import "./styles/..."`). Append:

```css
@keyframes arcade-studio-skeleton-pulse {
  from { opacity: 0.6; }
  to   { opacity: 0.9; }
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/components/frameSkeleton.test.tsx`
Expected: PASS — 5/5.

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/viewport/FrameSkeleton.tsx studio/__tests__/components/frameSkeleton.test.tsx studio/src/styles/
git commit -m "feat(studio/live-cursor): add FrameSkeleton scaffold"
```

---

## Task 9b: Wire `FrameSkeleton` into `FrameCard`

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Modify: `studio/src/components/viewport/Viewport.tsx`

- [ ] **Step 1: Add `agentCursor` + `phase` props to FrameCard**

In `FrameCard.tsx`, extend the props type:

```ts
  agentCursor?: import("../../hooks/chatStreamReducer").StreamState["agentCursor"];
  phase?: import("../../hooks/chatStreamReducer").TurnPhase;
```

- [ ] **Step 2: Render `FrameSkeleton` inside iframe wrapper**

Add an import:

```ts
import { FrameSkeleton } from "./FrameSkeleton";
```

Compute targeting:

```ts
const isTargeted =
  phase === "running" && agentCursor?.frame === frame.slug;
const composites = agentCursor?.composites ?? [];
```

Inside the iframe wrapper `<div>` (the one that already wraps the iframe with `position: absolute; inset: 0; ...`), place the skeleton as a sibling of the `<iframe>`, **before** the iframe in DOM order so it sits behind it visually only when iframe content is transparent — but mainly so we control z-index explicitly:

```tsx
<FrameSkeleton visible={isTargeted} composites={composites} />
<iframe ... />
```

(`FrameSkeleton`'s outer div is `position: absolute; inset: 0; pointer-events: none;`, so it overlays the iframe area.)

- [ ] **Step 3: Pass props from Viewport to FrameCard**

In `Viewport.tsx`, pass `agentCursor={agentCursor}` and `phase={phase}` to each `<FrameCard>`.

- [ ] **Step 4: Run viewport + framecard tests**

Run: `pnpm run studio:test studio/__tests__/components/viewport- studio/__tests__/components/frame`
Expected: PASS — no regressions.

- [ ] **Step 5: Manual smoke**

Run `pnpm run studio`. Trigger a turn that creates a new frame. Confirm:
- Skeleton appears inside the targeted FrameCard while agent works
- Skeleton disappears when iframe loads new content
- No layout breakage in non-running state

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/viewport/FrameCard.tsx studio/src/components/viewport/Viewport.tsx
git commit -m "feat(studio/live-cursor): show FrameSkeleton on targeted frames"
```

---

## Task 9c: Slice 3 release — version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump minor version**

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [X.Y.Z] — 2026-05-28

### Added
- Composite-aware skeleton scaffold inside the targeted FrameCard while
  the agent writes or edits its file. Falls back to a 4-block generic
  scaffold when no recognized composites are imported yet.
```

- [ ] **Step 3: Commit**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump version + changelog for live-cursor slice 3"
```

---

## Task 10: Top-down wipe CSS + `FrameCard` wipe trigger

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Modify: `studio/src/styles/index.css` (or active global stylesheet identified earlier)
- Create: `studio/__tests__/components/frameCard-wipe.test.tsx`

- [ ] **Step 1: Add CSS keyframes + class**

Append to the global stylesheet:

```css
.arcade-studio-frame-wipe { position: relative; overflow: hidden; }
.arcade-studio-frame-wipe::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--surface-overlay);
  clip-path: inset(0 0 100% 0);
  animation: arcade-studio-wipe 450ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  pointer-events: none;
  z-index: 1;
}
.arcade-studio-frame-wipe::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--component-button-primary-bg-idle);
  box-shadow: 0 0 12px var(--component-button-primary-bg-idle);
  animation: arcade-studio-wipe-edge 450ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  pointer-events: none;
  z-index: 2;
}
@keyframes arcade-studio-wipe {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(100% 0 0 0); }
}
@keyframes arcade-studio-wipe-edge {
  from { top: 0; opacity: 1; }
  to   { top: 100%; opacity: 0; }
}
```

- [ ] **Step 2: Write failing test for wipe behavior**

Create `studio/__tests__/components/frameCard-wipe.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { FrameCard } from "../../src/components/viewport/FrameCard";

vi.mock("@xorkavi/arcade-gen", () => ({
  ArrowUpRightSmall: () => null,
  IconButton: (p: any) => <button {...p}>{p.children}</button>,
  Tooltip: (p: any) => <>{p.children}</>,
  useToast: () => ({ toast: () => {} }),
}));

vi.mock("../../src/hooks/targetSelectionContext", () => ({
  useTargetSelection: () => ({ target: null, setTarget: () => {} }),
}));

const FRAME = { slug: "home", name: "Home" } as any;

describe("FrameCard wipe", () => {
  it("adds wipe class on iframe load while turn is running", () => {
    const { container } = render(
      <FrameCard
        projectSlug="proj"
        frame={FRAME}
        frameWidth={400}
        onFrameWidthChange={() => {}}
        projectMode="dark"
        zoom={1}
        phase="running"
        agentCursor={{ frame: "home", action: "writing", composites: [], updatedAt: 0 } as any}
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(true);
  });

  it("does NOT add wipe class on iframe load when phase is not running", () => {
    const { container } = render(
      <FrameCard
        projectSlug="proj"
        frame={FRAME}
        frameWidth={400}
        onFrameWidthChange={() => {}}
        projectMode="dark"
        zoom={1}
        phase="idle"
        agentCursor={null}
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(false);
  });

  it("removes wipe class on animationend", () => {
    const { container } = render(
      <FrameCard
        projectSlug="proj"
        frame={FRAME}
        frameWidth={400}
        onFrameWidthChange={() => {}}
        projectMode="dark"
        zoom={1}
        phase="running"
        agentCursor={{ frame: "home", action: "writing", composites: [], updatedAt: 0 } as any}
      />,
    );
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    const wrapper = iframe.parentElement!;
    fireEvent.animationEnd(wrapper);
    expect(wrapper.classList.contains("arcade-studio-frame-wipe")).toBe(false);
  });

  it("hides skeleton after iframe load", () => {
    const { container } = render(
      <FrameCard
        projectSlug="proj"
        frame={FRAME}
        frameWidth={400}
        onFrameWidthChange={() => {}}
        projectMode="dark"
        zoom={1}
        phase="running"
        agentCursor={{ frame: "home", action: "writing", composites: ["Hero"], updatedAt: 0 } as any}
      />,
    );
    expect(container.querySelector('[data-testid="frame-skeleton"]')).not.toBeNull();
    const iframe = container.querySelector("iframe")!;
    fireEvent.load(iframe);
    expect(container.querySelector('[data-testid="frame-skeleton"]')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm run studio:test studio/__tests__/components/frameCard-wipe.test.tsx`
Expected: FAIL — wipe behavior not implemented.

- [ ] **Step 4: Implement wipe trigger in FrameCard**

In `FrameCard.tsx`, add to imports:

```ts
import { useState as useStateBase, useRef as useRefBase } from "react";
```

(Or merge with existing react imports.)

Inside the component, add:

```ts
const wipeWrapperRef = useRef<HTMLDivElement | null>(null);
const [justWiped, setJustWiped] = useState(false);

function onIframeLoad() {
  if (phase !== "running") return;
  const wrapper = wipeWrapperRef.current;
  if (!wrapper) return;
  // Restart animation cleanly if a previous wipe is still mid-flight.
  wrapper.classList.remove("arcade-studio-frame-wipe");
  // Force reflow so adding the class restarts the animation.
  void wrapper.offsetWidth;
  wrapper.classList.add("arcade-studio-frame-wipe");
  setJustWiped(true);
}

function onWrapperAnimationEnd() {
  wipeWrapperRef.current?.classList.remove("arcade-studio-frame-wipe");
  setJustWiped(false);
}
```

Attach the ref + handler on the iframe wrapper div (the one currently styled with `position: absolute; inset: 0; ... overflow: hidden; ...`):

```tsx
<div
  ref={wipeWrapperRef}
  onAnimationEnd={onWrapperAnimationEnd}
  style={{ /* unchanged */ }}
>
  <FrameSkeleton visible={isTargeted && !justWiped} composites={composites} />
  <iframe
    ref={iframeRef}
    key={projectMode}
    title={frame.name}
    src={frameUrl}
    onLoad={onIframeLoad}
    style={{ /* unchanged */ }}
  />
</div>
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm run studio:test studio/__tests__/components/frameCard-wipe.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 6: Run full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 7: Manual smoke**

Run `pnpm run studio`. Trigger a turn that writes a frame. Confirm:
- Skeleton paints
- Wipe runs top-down on iframe load
- Real iframe content visible after wipe
- No frozen overlay (wipe class clears)

- [ ] **Step 8: Commit**

```bash
git add studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/frameCard-wipe.test.tsx studio/src/styles/
git commit -m "feat(studio/live-cursor): top-down wipe on iframe load"
```

---

## Task 11: Slice 4 release — version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `studio/CHANGELOG.md`

- [ ] **Step 1: Bump minor version**

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [X.Y.Z] — 2026-05-28

### Added
- Top-down wipe animation when an iframe reloads during a running turn,
  revealing the real frame contents over the skeleton scaffold. Completes
  the live-cursor effect (cursor + skeleton + reveal).
```

- [ ] **Step 3: Commit**

```bash
git add package.json studio/CHANGELOG.md
git commit -m "chore(studio): bump version + changelog for live-cursor slice 4"
```

---

## Verification checklist

Before merging the final slice:

- [ ] `pnpm run studio:test` passes (full suite, no skips)
- [ ] No new runtime deps added to `package.json`
- [ ] Manual: cursor + skeleton + wipe play during a turn that creates a new frame
- [ ] Manual: cursor + skeleton + wipe play during a turn that edits an existing frame
- [ ] Manual: spectator (open shared project link in second tab) sees the same effect
- [ ] Manual: turning OFF the dev server mid-turn does not leave a stuck wipe overlay
- [ ] Manual: cancelling a turn (Stop button) clears cursor + skeleton instantly
- [ ] Manual: Bedrock auth-expiry error path still surfaces the auth banner; no live-cursor leakage

## Out of scope (do NOT implement here)

- Click-bounce animation on action change
- Narration noun chips inside skeleton blocks
- Stale-state cursor fade after >8s
- `cursorFrames` turn-end telemetry
- Pivot to structured-canvas generation (Pencil-style MCP)

These are listed in the spec as future polish. Open a separate plan if/when prioritized.
