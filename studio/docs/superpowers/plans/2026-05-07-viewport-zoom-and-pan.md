# Viewport Zoom and Pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canvas-style zoom + pan to the project viewport so beta testers on small laptops can fit wide frames on screen and navigate with familiar Figma-like gestures.

**Architecture:** CSS `transform: scale()` on a wrapper inside the existing `overflow: auto` container. Pan = writing `scrollLeft/scrollTop` directly (triggered by space-drag or middle-mouse). Zoom = discrete stops; `⌘+wheel` anchors zoom at cursor by computing the content point under the mouse, updating zoom, then restoring scroll so that point stays put. Zoom persists per project in `localStorage`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + jsdom + @testing-library/react, `@xorkavi/arcade-gen` (`Menu`, `IconButton`).

**Spec:** [`studio/docs/superpowers/specs/2026-05-07-viewport-zoom-and-pan-design.md`](../specs/2026-05-07-viewport-zoom-and-pan-design.md)

**Conventions (from `CLAUDE.md` / `studio/CLAUDE.md`):**
- Package manager is **pnpm**. Never `npm install`.
- Tests live in `studio/__tests__/`. Run with `pnpm run studio:test <path>` for a single file, `pnpm run studio:test` for all.
- Commits use Conventional Commits with `studio/<area>` scope. Use `feat(studio/viewport): ...`, `test(studio/viewport): ...`, etc.
- **Never `git add -A` or `git add .`** — stage explicit paths only.
- Vite middleware (not relevant here) does NOT hot-reload; but client `src/*` does — changes show up on save.

**File structure (new + changed):**

| File | Role |
|---|---|
| `studio/src/components/viewport/zoomSteps.ts` *(new)* | Pure helpers: `ZOOM_STEPS`, `nextStep`, `snapToNearestStep`, `formatZoomLabel`. |
| `studio/src/components/viewport/ZoomIndicator.tsx` *(new)* | Bottom-right pill + `Menu` popover with zoom controls. |
| `studio/src/components/viewport/ViewportPreview.tsx` *(rewritten)* | Scroll container + transform wrapper, wheel/key/pan handlers, `ResizeObserver`, renders `ZoomIndicator`. |
| `studio/src/components/viewport/Viewport.tsx` *(modified)* | Threads `zoom` + `onZoomChange` through. |
| `studio/src/components/viewport/FrameCard.tsx` *(modified)* | Accepts `zoom` prop; divides resize-drag delta by it. |
| `studio/src/routes/ProjectDetail.tsx` *(modified)* | Owns `zoom` state + `localStorage` (`studio:zoom:<slug>`). |
| `studio/__tests__/components/viewport/zoom-steps.test.ts` *(new)* | Pure math unit tests. |
| `studio/__tests__/components/viewport/frame-card-resize-under-zoom.test.tsx` *(new)* | Resize delta under non-1 zoom. |
| `studio/__tests__/components/viewport/viewport-zoom-persistence.test.tsx` *(new)* | localStorage read/write per slug. |

---

## Task 1: Zoom step helpers (pure module)

Foundation for everything else. Pure functions → easy to test, no React noise.

**Files:**
- Create: `studio/src/components/viewport/zoomSteps.ts`
- Test: `studio/__tests__/components/viewport/zoom-steps.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `studio/__tests__/components/viewport/zoom-steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ZOOM_STEPS,
  ZOOM_MIN,
  ZOOM_MAX,
  nextStep,
  snapToNearestStep,
  formatZoomLabel,
} from "../../../src/components/viewport/zoomSteps";

describe("ZOOM_STEPS", () => {
  it("is sorted ascending and spans 25% to 200%", () => {
    expect(ZOOM_STEPS[0]).toBe(0.25);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(2.0);
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1]);
    }
  });

  it("contains 1.0 so reset is on-step", () => {
    expect(ZOOM_STEPS).toContain(1.0);
  });

  it("exposes ZOOM_MIN and ZOOM_MAX matching the endpoints", () => {
    expect(ZOOM_MIN).toBe(ZOOM_STEPS[0]);
    expect(ZOOM_MAX).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  });
});

describe("nextStep", () => {
  it("moves up one step when zooming in from an on-step value", () => {
    expect(nextStep(1.0, "in")).toBe(1.1);
  });

  it("moves down one step when zooming out from an on-step value", () => {
    expect(nextStep(1.0, "out")).toBe(0.9);
  });

  it("snaps an off-step value to the next larger step when zooming in", () => {
    expect(nextStep(0.8, "in")).toBe(0.9);
  });

  it("snaps an off-step value to the next smaller step when zooming out", () => {
    expect(nextStep(0.8, "out")).toBe(0.75);
  });

  it("clamps at the max when zooming in from the max", () => {
    expect(nextStep(2.0, "in")).toBe(2.0);
  });

  it("clamps at the min when zooming out from the min", () => {
    expect(nextStep(0.25, "out")).toBe(0.25);
  });
});

describe("snapToNearestStep", () => {
  it("returns the nearest step for a value between two stops", () => {
    // 0.4 is between 0.33 and 0.5; nearer to 0.33
    expect(snapToNearestStep(0.4)).toBe(0.33);
    // 0.45 is nearer to 0.5
    expect(snapToNearestStep(0.45)).toBe(0.5);
  });

  it("clamps out-of-range values", () => {
    expect(snapToNearestStep(0.01)).toBe(0.25);
    expect(snapToNearestStep(5)).toBe(2.0);
  });

  it("returns the same value when already on a step", () => {
    expect(snapToNearestStep(1.0)).toBe(1.0);
  });
});

describe("formatZoomLabel", () => {
  it("formats as a whole-number percent", () => {
    expect(formatZoomLabel(1.0)).toBe("100%");
    expect(formatZoomLabel(0.67)).toBe("67%");
    expect(formatZoomLabel(0.33)).toBe("33%");
    expect(formatZoomLabel(0.25)).toBe("25%");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run studio:test __tests__/components/viewport/zoom-steps.test.ts`

Expected: FAIL with module-not-found on `zoomSteps`.

- [ ] **Step 3: Implement `zoomSteps.ts`**

Create `studio/src/components/viewport/zoomSteps.ts`:

```ts
export const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0,
] as const;

export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function nextStep(current: number, dir: "in" | "out"): number {
  if (dir === "in") {
    const above = ZOOM_STEPS.find((s) => s > current + 1e-6);
    return above ?? ZOOM_MAX;
  }
  // dir === "out"
  let below = ZOOM_MIN;
  for (const s of ZOOM_STEPS) {
    if (s < current - 1e-6) below = s;
    else break;
  }
  return below;
}

export function snapToNearestStep(raw: number): number {
  if (raw <= ZOOM_MIN) return ZOOM_MIN;
  if (raw >= ZOOM_MAX) return ZOOM_MAX;
  let best = ZOOM_STEPS[0];
  let bestDist = Math.abs(raw - best);
  for (const s of ZOOM_STEPS) {
    const d = Math.abs(raw - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

export function formatZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run studio:test __tests__/components/viewport/zoom-steps.test.ts`

Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/zoomSteps.ts \
       studio/__tests__/components/viewport/zoom-steps.test.ts
git commit -m "feat(studio/viewport): zoom step helpers"
```

---

## Task 2: ZoomIndicator UI component

The bottom-right pill + menu. Isolated enough to build before wiring.

**Files:**
- Create: `studio/src/components/viewport/ZoomIndicator.tsx`

- [ ] **Step 1: Implement `ZoomIndicator.tsx`**

Create `studio/src/components/viewport/ZoomIndicator.tsx`:

```tsx
import { Menu } from "@xorkavi/arcade-gen";
import {
  ZOOM_MIN,
  ZOOM_MAX,
  formatZoomLabel,
  nextStep,
} from "./zoomSteps";

export function ZoomIndicator({
  zoom,
  onZoomChange,
  onFitToScreen,
}: {
  zoom: number;
  onZoomChange: (next: number) => void;
  onFitToScreen: () => void;
}) {
  const label = formatZoomLabel(zoom);
  const canZoomIn = zoom < ZOOM_MAX - 1e-6;
  const canZoomOut = zoom > ZOOM_MIN + 1e-6;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 36,
        right: 36,
        zIndex: 3,
      }}
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={`Zoom: ${label}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              color: "var(--fg-neutral-tertiary)",
              background: "var(--surface-overlay)",
              border: "1px solid var(--stroke-neutral-subtle)",
              borderRadius: 6,
              letterSpacing: 0.4,
              cursor: "pointer",
            }}
          >
            <span>{label}</span>
            <span aria-hidden="true">▾</span>
          </button>
        </Menu.Trigger>
        <Menu.Content align="end">
          <Menu.Item
            onSelect={() => onZoomChange(nextStep(zoom, "in"))}
            disabled={!canZoomIn}
          >
            Zoom in
          </Menu.Item>
          <Menu.Item
            onSelect={() => onZoomChange(nextStep(zoom, "out"))}
            disabled={!canZoomOut}
          >
            Zoom out
          </Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(0.5)}>Zoom to 50%</Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(1.0)}>Zoom to 100%</Menu.Item>
          <Menu.Item onSelect={() => onZoomChange(2.0)}>Zoom to 200%</Menu.Item>
          <Menu.Item onSelect={onFitToScreen}>Zoom to fit</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
```

*Note*: The current `ViewportPreview` has a hard-coded `Preview` label at `bottom:36, right:36`. That label is removed in Task 4; the pill takes the same position.

- [ ] **Step 2: Verify build still compiles**

Run: `pnpm run studio:test __tests__/components/viewport/zoom-steps.test.ts`

Expected: PASS (unchanged; sanity check that adding the file didn't break module resolution).

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/viewport/ZoomIndicator.tsx
git commit -m "feat(studio/viewport): zoom indicator pill with menu"
```

---

## Task 3: `FrameCard` accepts `zoom` prop and divides resize delta

Isolated change; do this before rewriting `ViewportPreview` so wire-through is obvious.

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx`
- Test: `studio/__tests__/components/viewport/frame-card-resize-under-zoom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/viewport/frame-card-resize-under-zoom.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Match the mock pattern used elsewhere in the suite — keep minimal; FrameCard
// only uses a few pieces from arcade-gen.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  return {
    IconButton: passthrough("button"),
    ArrowUpRightSmall: () => null,
    Tooltip: ({ children }: any) => children,
    useToast: () => ({ toast: () => {} }),
  };
});

import { FrameCard } from "../../../src/components/viewport/FrameCard";
import { TargetSelectionProvider } from "../../../src/hooks/targetSelectionContext";

beforeEach(() => {
  cleanup();
});

function renderCard(zoom: number, onFrameWidthChange: (n: number) => void) {
  return render(
    <TargetSelectionProvider>
      <FrameCard
        projectSlug="slug"
        frame={{ slug: "f", name: "Frame", path: "", width: 1440, height: 900 } as any}
        frameWidth={1000}
        onFrameWidthChange={onFrameWidthChange}
        projectMode="light"
        zoom={zoom}
      />
    </TargetSelectionProvider>,
  );
}

describe("FrameCard resize under zoom", () => {
  it("at zoom=1, 100px of mouse travel adds 100px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(1.0, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;
    expect(handle).toBeTruthy();

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1100);
  });

  it("at zoom=0.5, 100px of mouse travel adds 200px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(0.5, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1200);
  });

  it("at zoom=2, 100px of mouse travel adds 50px of frame width", () => {
    const onChange = vi.fn();
    const { container } = renderCard(2.0, onChange);
    const handle = container.querySelector('[aria-label="Resize frame"]') as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 600 });

    expect(onChange).toHaveBeenLastCalledWith(1050);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/viewport/frame-card-resize-under-zoom.test.tsx`

Expected: FAIL — `zoom` prop isn't accepted yet; test will fail TypeScript or at runtime the delta won't be divided.

- [ ] **Step 3: Modify `FrameCard.tsx`**

Edit `studio/src/components/viewport/FrameCard.tsx`:

Change the props type to include `zoom`:

```tsx
export function FrameCard({
  projectSlug,
  frame,
  frameWidth,
  onFrameWidthChange,
  projectMode,
  zoom,
}: {
  projectSlug: string;
  frame: Frame;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  projectMode: "light" | "dark";
  zoom: number;
}) {
```

Change the resize `onMove` handler to divide the delta by `zoom`. Locate this block (currently at ~lines 54-62):

```tsx
    function onMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
      const next = s.startWidth + (e.clientX - s.startX);
      onFrameWidthChange(
        Math.min(FRAME_WIDTH_MAX, Math.max(FRAME_WIDTH_MIN, next)),
      );
    }
```

Replace with:

```tsx
    function onMove(e: MouseEvent) {
      const s = resizeRef.current;
      if (!s) return;
      const zoomSafe = zoom > 0 ? zoom : 1;
      const next = s.startWidth + (e.clientX - s.startX) / zoomSafe;
      onFrameWidthChange(
        Math.min(FRAME_WIDTH_MAX, Math.max(FRAME_WIDTH_MIN, next)),
      );
    }
```

Add `zoom` to the `useEffect` dependency array for the resize handler (the one that depends on `resizing` and `onFrameWidthChange`):

```tsx
  }, [resizing, onFrameWidthChange, zoom]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/viewport/frame-card-resize-under-zoom.test.tsx`

Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/viewport/FrameCard.tsx \
       studio/__tests__/components/viewport/frame-card-resize-under-zoom.test.tsx
git commit -m "feat(studio/viewport): adjust frame resize delta by zoom"
```

---

## Task 4: Rewrite `ViewportPreview` — transform wrapper + ZoomIndicator

This is the structural change. No pan/zoom *gestures* yet — just the wrapper, the ResizeObserver, the prop threading, and the indicator. Keeps the diff reviewable.

**Files:**
- Modify: `studio/src/components/viewport/ViewportPreview.tsx`
- Modify: `studio/src/components/viewport/Viewport.tsx`

- [ ] **Step 1: Rewrite `ViewportPreview.tsx`**

Replace `studio/src/components/viewport/ViewportPreview.tsx` entirely with:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ZoomIndicator } from "./ZoomIndicator";

export function ViewportPreview({
  children,
  zoom,
  onZoomChange,
}: {
  children: ReactNode;
  zoom: number;
  onZoomChange: (next: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });

  // Track unscaled content size so the wrapper can expand to match scaled bounds.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setContentSize({
        width: el.scrollWidth,
        height: el.scrollHeight,
      });
    });
    observer.observe(el);
    // Initial measurement.
    setContentSize({ width: el.scrollWidth, height: el.scrollHeight });
    return () => observer.disconnect();
  }, []);

  function fitToScreen() {
    const scroll = scrollRef.current;
    if (!scroll || contentSize.width === 0 || contentSize.height === 0) return;
    const vw = scroll.clientWidth;
    const vh = scroll.clientHeight;
    const fitX = vw / contentSize.width;
    const fitY = vh / contentSize.height;
    const raw = Math.min(fitX, fitY) * 0.95;
    // Import at call site to avoid pulling unused symbols into wrapper hot path.
    import("./zoomSteps").then(({ snapToNearestStep }) => {
      const next = snapToNearestStep(raw);
      onZoomChange(next);
      requestAnimationFrame(() => {
        const s = scrollRef.current;
        if (!s) return;
        s.scrollLeft = (contentSize.width * next - vw) / 2;
        s.scrollTop = (contentSize.height * next - vh) / 2;
      });
    });
  }

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--surface-shallow)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentSize.width * zoom,
          height: contentSize.height * zoom,
        }}
      >
        <div ref={contentRef} style={{ width: "fit-content", minWidth: "100%" }}>
          {children}
        </div>
      </div>
      <ZoomIndicator
        zoom={zoom}
        onZoomChange={onZoomChange}
        onFitToScreen={fitToScreen}
      />
    </div>
  );
}
```

*Note*: The `Preview` label is gone — the zoom pill replaces it in the same slot. The outer container no longer has a flex layout; the scaled wrapper sizes itself to the content.

- [ ] **Step 2: Update `Viewport.tsx` to thread `zoom`**

Edit `studio/src/components/viewport/Viewport.tsx`. Change the props signature and pass `zoom` / `onZoomChange` to `ViewportPreview` and `FrameCard`. Full replacement:

```tsx
import { useEffect } from "react";
import type { Project } from "../../../server/types";
import { useFrames } from "../../hooks/useFrames";
import { FrameCard } from "./FrameCard";
import { EmptyViewport } from "./EmptyViewport";
import { ViewportPreview } from "./ViewportPreview";

export function Viewport({
  project,
  frameWidth,
  onFrameWidthChange,
  zoom,
  onZoomChange,
}: {
  project: Project;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  zoom: number;
  onZoomChange: (next: number) => void;
}) {
  const { frames } = useFrames(project);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "arcade-studio:frame-error"
      ) {
        return;
      }
      const payload = data as { slug?: string; frame?: string; message?: string };
      if (payload.slug !== project.slug) return;
      void fetch("/api/runtime-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: payload.slug,
          frame: payload.frame,
          message: payload.message,
        }),
      }).catch(() => {
        // non-critical; the UI already shows the error
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [project.slug]);

  if (!frames.length) return <EmptyViewport />;

  return (
    <ViewportPreview zoom={zoom} onZoomChange={onZoomChange}>
      <div
        style={{
          display: "flex",
          gap: 64,
          padding: 32,
          background: "var(--bg-neutral-soft)",
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
      </div>
    </ViewportPreview>
  );
}
```

- [ ] **Step 3: Run full viewport tests**

Run: `pnpm run studio:test __tests__/components/viewport/`

Expected: PASS (Task 3's resize-under-zoom test still passes; no regressions).

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/viewport/ViewportPreview.tsx \
       studio/src/components/viewport/Viewport.tsx
git commit -m "feat(studio/viewport): transform wrapper and zoom indicator"
```

---

## Task 5: Wire `zoom` state in `ProjectDetail` with localStorage persistence

Connects the app so the UI actually uses zoom end-to-end.

**Files:**
- Modify: `studio/src/routes/ProjectDetail.tsx`
- Test: `studio/__tests__/components/viewport/viewport-zoom-persistence.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/viewport/viewport-zoom-persistence.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

// Mock arcade-gen pieces used by ProjectDetail's subtree. Minimal passthroughs.
vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement(tag, { ...props, ref }),
    );
  const Menu: any = {
    Root: ({ children }: any) => React.createElement("div", null, children),
    Trigger: ({ children }: any) => React.createElement("div", null, children),
    Content: ({ children }: any) => React.createElement("div", null, children),
    Item: ({ children, ...rest }: any) =>
      React.createElement("button", rest, children),
  };
  return {
    Button: passthrough("button"),
    IconButton: passthrough("button"),
    Tooltip: ({ children }: any) => children,
    useToast: () => ({ toast: () => {} }),
    Menu,
    ArrowUpRightSmall: () => null,
    ThreeDotsHorizontal: () => null,
  };
});

// Mock the chat pane and dev-mode panel so we don't pull the full chat stack.
vi.mock("../../../src/components/chat/ChatPane", () => ({
  ChatPane: () => null,
}));
vi.mock("../../../src/components/devmode/DevModePanel", () => ({
  DevModePanel: () => null,
}));
vi.mock("../../../src/components/shell/StudioHeader", () => ({
  StudioHeader: ({ title, right }: any) => (
    <div>{title}{right}</div>
  ),
}));
vi.mock("../../../src/components/shell/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));
vi.mock("../../../src/components/shell/ShareButton", () => ({
  ShareButton: () => null,
}));
vi.mock("../../../src/components/shell/CanvasToggle", () => ({
  CanvasToggle: () => null,
}));
vi.mock("../../../src/components/shell/ChatToggle", () => ({
  ChatToggle: () => null,
}));
vi.mock("../../../src/components/shell/ProjectPicker", () => ({
  ProjectPicker: () => null,
}));

import { ProjectDetail } from "../../../src/routes/ProjectDetail";

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/projects/my-slug")) {
      return new Response(
        JSON.stringify({ slug: "my-slug", name: "My", mode: "light", updatedAt: 0 }),
        { status: 200 },
      );
    }
    if (url.includes("/api/frames/")) {
      return new Response(JSON.stringify({ frames: [] }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as any;
});

afterEach(() => cleanup());

describe("ProjectDetail zoom persistence", () => {
  it("reads zoom from localStorage on mount, keyed by slug", async () => {
    window.localStorage.setItem("studio:zoom:my-slug", "0.5");
    render(
      <ProjectDetail slug="my-slug" onBack={() => {}} onOpenProject={() => {}} />,
    );
    await waitFor(() => {
      // The viewport wraps content in a transform scale(0.5). Assert the style
      // reflects the stored value.
      const scaled = document.querySelector<HTMLElement>('[style*="scale(0.5)"]');
      expect(scaled).toBeTruthy();
    });
  });

  it("defaults to 1.0 when nothing is stored", async () => {
    render(
      <ProjectDetail slug="my-slug" onBack={() => {}} onOpenProject={() => {}} />,
    );
    await waitFor(() => {
      const scaled = document.querySelector<HTMLElement>('[style*="scale(1)"]');
      expect(scaled).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/viewport/viewport-zoom-persistence.test.tsx`

Expected: FAIL — `ProjectDetail` doesn't pass `zoom` yet; no `scale(...)` will appear.

- [ ] **Step 3: Modify `ProjectDetail.tsx`**

Edit `studio/src/routes/ProjectDetail.tsx`. Add the zoom constants and state, persist on change, and pass to `Viewport`.

Just below the existing `FRAME_WIDTH_DEFAULT` constant, add:

```tsx
const ZOOM_STORAGE_PREFIX = "studio:zoom:";
const ZOOM_DEFAULT = 1.0;
```

Below the existing `frameWidth` state declaration (the `useState<number>(() => { ... })` block around lines 35-41), add:

```tsx
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === "undefined") return ZOOM_DEFAULT;
    const stored = window.localStorage.getItem(`${ZOOM_STORAGE_PREFIX}${slug}`);
    const parsed = stored ? Number(stored) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return ZOOM_DEFAULT;
    return parsed;
  });
```

Below the existing `useEffect` that writes `frameWidth` to localStorage, add:

```tsx
  useEffect(() => {
    window.localStorage.setItem(`${ZOOM_STORAGE_PREFIX}${slug}`, String(zoom));
  }, [slug, zoom]);
```

Change the `<Viewport>` call site (currently `<Viewport project={project} frameWidth={frameWidth} onFrameWidthChange={setFrameWidth} />`) to:

```tsx
          <Viewport
            project={project}
            frameWidth={frameWidth}
            onFrameWidthChange={setFrameWidth}
            zoom={zoom}
            onZoomChange={setZoom}
          />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/viewport/viewport-zoom-persistence.test.tsx`

Expected: PASS (both cases).

- [ ] **Step 5: Run the full viewport directory**

Run: `pnpm run studio:test __tests__/components/viewport/`

Expected: PASS (all three viewport tests).

- [ ] **Step 6: Commit**

```bash
git add studio/src/routes/ProjectDetail.tsx \
       studio/__tests__/components/viewport/viewport-zoom-persistence.test.tsx
git commit -m "feat(studio/viewport): persist zoom per project"
```

---

## Task 6: Cursor-anchored wheel zoom

Adds the ⌘/ctrl+wheel gesture. Wired as a native `wheel` listener with `{ passive: false }` so `preventDefault()` works.

**Files:**
- Modify: `studio/src/components/viewport/ViewportPreview.tsx`

- [ ] **Step 1: Add the wheel handler in `ViewportPreview`**

Edit `studio/src/components/viewport/ViewportPreview.tsx`. Add the import:

```tsx
import { nextStep } from "./zoomSteps";
```

Below the existing `useEffect` that sets up the `ResizeObserver`, add a new `useEffect`:

```tsx
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    function onWheel(e: WheelEvent) {
      // Only intercept when ⌘ (mac) or ctrl (other / trackpad pinch) is held.
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      const s = scrollRef.current;
      if (!s) return;
      const rect = s.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + s.scrollLeft;
      const cursorY = e.clientY - rect.top + s.scrollTop;
      const contentX = cursorX / zoom;
      const contentY = cursorY / zoom;

      const dir: "in" | "out" = e.deltaY < 0 ? "in" : "out";
      const next = nextStep(zoom, dir);
      if (next === zoom) return;
      onZoomChange(next);

      requestAnimationFrame(() => {
        const s2 = scrollRef.current;
        if (!s2) return;
        s2.scrollLeft = contentX * next - (e.clientX - rect.left);
        s2.scrollTop = contentY * next - (e.clientY - rect.top);
      });
    }

    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [zoom, onZoomChange]);
```

- [ ] **Step 2: Manual smoke test in the dev server**

Run: `pnpm run studio`

Open a project with at least one frame. Verify:
- `⌘+scroll-up` zooms in one step at a time; the point under the cursor stays put.
- `⌘+scroll-down` zooms out similarly.
- Plain scroll (no modifier) still scrolls the viewport.
- The ZoomIndicator pill updates in real time.

Report any visible drift.

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/viewport/ViewportPreview.tsx
git commit -m "feat(studio/viewport): cursor-anchored wheel zoom"
```

---

## Task 7: Keyboard shortcuts (⌘+/-/0/1)

**Files:**
- Modify: `studio/src/components/viewport/ViewportPreview.tsx`

- [ ] **Step 1: Add the keyboard shortcut `useEffect`**

Edit `studio/src/components/viewport/ViewportPreview.tsx`. Below the wheel handler effect, add:

```tsx
  useEffect(() => {
    function isTextTargetActive(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTextTargetActive()) return;

      // ⌘+ (with or without shift) and ⌘=
      if (e.key === "+" || e.key === "=") {
        const next = nextStep(zoom, "in");
        if (next !== zoom) {
          e.preventDefault();
          onZoomChange(next);
        }
        return;
      }
      if (e.key === "-") {
        const next = nextStep(zoom, "out");
        if (next !== zoom) {
          e.preventDefault();
          onZoomChange(next);
        }
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        onZoomChange(1.0);
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        fitToScreen();
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // fitToScreen is re-created every render, but it closes over refs/state
    // we want fresh each time — so depend on the stable inputs.
  }, [zoom, onZoomChange, contentSize.width, contentSize.height]);
```

*Note*: We reference `fitToScreen` from inside the effect. That's fine — `fitToScreen` is defined in the same component render and reads refs + `contentSize`, which is a dependency. The closure captures the current render's copy; that's sufficient.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm run studio`

Verify:
- `⌘+=` zooms in, `⌘+-` zooms out, `⌘+0` resets to 100%, `⌘+1` fits to screen.
- Typing in the chat input with `⌘+=` does NOT change zoom (text target is active).
- Indicator pill reflects each change.

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/viewport/ViewportPreview.tsx
git commit -m "feat(studio/viewport): keyboard shortcuts for zoom"
```

---

## Task 8: Space-drag and middle-mouse pan

**Files:**
- Modify: `studio/src/components/viewport/ViewportPreview.tsx`

- [ ] **Step 1: Add pan state + handlers**

Edit `studio/src/components/viewport/ViewportPreview.tsx`.

Add state below the existing `contentSize` state:

```tsx
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);
```

Add a `useEffect` for tracking space key (below the keyboard-shortcut effect):

```tsx
  useEffect(() => {
    function isTextTargetActive(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (isTextTargetActive()) return;
      if (!spaceHeld) {
        e.preventDefault(); // prevent page scroll
        setSpaceHeld(true);
      }
    }
    function onUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [spaceHeld]);
```

Add a `useEffect` for the pan drag lifecycle:

```tsx
  useEffect(() => {
    if (!panning) return;
    function onMove(e: MouseEvent) {
      const s = scrollRef.current;
      const st = panStateRef.current;
      if (!s || !st) return;
      s.scrollLeft = st.startScrollLeft - (e.clientX - st.startX);
      s.scrollTop = st.startScrollTop - (e.clientY - st.startY);
    }
    function onUp() {
      setPanning(false);
      panStateRef.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [panning]);

  function startPan(e: React.MouseEvent) {
    const s = scrollRef.current;
    if (!s) return;
    e.preventDefault();
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: s.scrollLeft,
      startScrollTop: s.scrollTop,
    };
    setPanning(true);
  }
```

Update the scroll container's outer `<div>` to wire `onMouseDown`, set the cursor, and add `pointer-events: none` on the wrapper during panning. Change:

```tsx
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--surface-shallow)",
        overflow: "auto",
      }}
    >
```

to:

```tsx
    <div
      ref={scrollRef}
      role="region"
      aria-label="Design viewport"
      onMouseDown={(e) => {
        // Middle mouse → always pan. Space held + primary button → pan.
        if (e.button === 1 || (e.button === 0 && spaceHeld)) {
          startPan(e);
        }
      }}
      style={{
        display: "block",
        height: "100%",
        position: "relative",
        background: "var(--surface-shallow)",
        overflow: "auto",
        cursor: panning ? "grabbing" : spaceHeld ? "grab" : undefined,
      }}
    >
```

Change the zoom wrapper `<div>` to add `pointer-events: none` while panning:

```tsx
      <div
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentSize.width * zoom,
          height: contentSize.height * zoom,
          pointerEvents: panning ? "none" : "auto",
        }}
      >
```

- [ ] **Step 2: Manual smoke test**

Run: `pnpm run studio`

Verify:
- Hold space → cursor turns to grab → drag the viewport → content scrolls. Release mouse; release space → cursor returns.
- Middle-mouse drag pans without space.
- Clicking inside a frame iframe while *not* holding space still works normally (no pan triggered).
- Space+drag across an iframe pans instead of the iframe swallowing the drag (thanks to `pointer-events: none` during pan).
- Typing space in the chat input does NOT start a pan (text target skip).

- [ ] **Step 3: Commit**

```bash
git add studio/src/components/viewport/ViewportPreview.tsx
git commit -m "feat(studio/viewport): space-drag and middle-mouse pan"
```

---

## Task 9: Full test suite + packaging smoke

Final pass to make sure nothing elsewhere broke.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`

Expected: all tests pass. The suite was at 173 tests as of 0.3.0; we added 3 files worth. If any pre-existing test fails, investigate — don't mark this task complete.

- [ ] **Step 2: Manual end-to-end check in the packaged context**

Run: `pnpm run studio`

Walk through the full flow with an existing project:
1. Frames render at 100% zoom by default.
2. `⌘+scroll` zooms; indicator updates; cursor anchor holds.
3. `⌘+0` resets; `⌘+1` fits; `⌘+/-` step up/down.
4. Space-drag pans. Middle-mouse pans.
5. Frame resize drag: at 50% zoom, the frame width changes by the mouse-delta distance (feels 1:1 in content pixels, not screen pixels).
6. Close project, reopen — zoom restores from localStorage.
7. Switch to another project — that project has its own zoom.
8. Element picker (crosshair icon per frame) still works.

- [ ] **Step 3: Update `CHANGELOG.md` in a separate commit**

Add an entry at the top of `studio/CHANGELOG.md` under a new `[0.x.0] — 2026-05-07` section (use the next unreleased semver). Bump `studio/packaging/VERSION` to match.

Example entry body:

```markdown
## [0.12.0] — 2026-05-07

### Added
- Viewport zoom + pan: ⌘+wheel zooms at the cursor, space-drag or middle-mouse pans. ⌘+0 resets to 100%, ⌘+1 fits to screen. Zoom persists per project. A new zoom indicator pill in the bottom-right replaces the old "Preview" label.
```

Commit:

```bash
git add studio/CHANGELOG.md studio/packaging/VERSION
git commit -m "chore(studio): bump to 0.12.0 — viewport zoom and pan"
```

- [ ] **Step 4: Final commit verification**

Run: `git log --oneline -10`

Expected: a clean sequence of `feat(studio/viewport): ...` commits ending with the `chore(studio): bump to 0.12.0` version bump. The tree is clean (`git status` shows no staged or unstaged changes beyond untracked screenshots).

---

## Done

At this point the feature is complete, tested, and changelog-documented. Packaging and release (the `gh release create ...` step from `studio/CLAUDE.md`) is a separate operation the user will invoke when ready.
