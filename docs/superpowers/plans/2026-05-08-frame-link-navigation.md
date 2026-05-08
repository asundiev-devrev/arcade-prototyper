# FrameLink Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users in a multi-frame prototype click an element in one frame and have the viewport scroll to a target frame with a highlight flash — wiring the interactions the agent reads from the user's prompt.

**Architecture:** New prototype-kit composite `<FrameLink target="02-slug">` posts a `window.parent.postMessage({ type: "arcade-studio:navigate", target, source })` on click. The parent's `Viewport.tsx` listens, finds the target `FrameCard` via a new `data-frame-slug` attribute, scrolls it into view, and toggles a CSS highlight class for ~1s. Agent template teaches the agent to wrap only elements the prompt explicitly names as triggers.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library, pnpm. All three pieces follow existing conventions (composite shape matches `prototype-kit/composites/*`; message shape matches the `arcade-studio:*` convention already used by `gestureForwarder.ts`; template prose matches the 0.13.0 "When the prompt describes a flow" section).

---

## File Structure

**New files:**
- `studio/prototype-kit/composites/FrameLink.tsx` — the primitive.
- `studio/__tests__/prototype-kit/frame-link.test.tsx` — unit tests for the primitive.
- `studio/__tests__/components/viewport-frame-link-nav.test.tsx` — integration test: Viewport receives navigate message, scrolls + highlights.

**Modified files:**
- `studio/prototype-kit/index.ts` — export `FrameLink`.
- `studio/prototype-kit/KIT-MANIFEST.md` — add a `FrameLink` entry so the agent has a reference.
- `studio/src/components/viewport/Viewport.tsx` — add the `message` listener + scroll/highlight logic.
- `studio/src/components/viewport/FrameCard.tsx` — add `data-frame-slug` attribute + accept a `highlighted` prop and apply the highlight class.
- `studio/templates/CLAUDE.md.tpl` — new "Wiring the flow" subsection + anti-pattern row.
- `studio/CHANGELOG.md` — 0.14.0 entry.
- `studio/packaging/VERSION` — bump to 0.14.0.

Each file has one responsibility. `FrameLink` is presentation + one postMessage call. `Viewport` owns the listener and scroll state. `FrameCard` owns the visual highlight. Template owns the agent-side rules.

---

## Task 1: `FrameLink` component

The smallest, most-testable unit. Pure presentation + one postMessage call. Stand-alone — later tasks build on top but this task produces a working exported component.

**Files:**
- Create: `studio/prototype-kit/composites/FrameLink.tsx`
- Test: `studio/__tests__/prototype-kit/frame-link.test.tsx`

### Step 1: Write the failing test

Create `studio/__tests__/prototype-kit/frame-link.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FrameLink } from "../../prototype-kit/composites/FrameLink";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrameLink", () => {
  it("renders its children", () => {
    render(
      <FrameLink target="02-modal">
        <span>Open modal</span>
      </FrameLink>,
    );
    expect(screen.getByText("Open modal")).toBeTruthy();
  });

  it("applies role='button' and tabIndex=0 so keyboard users can activate it", () => {
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    const link = screen.getByRole("button");
    expect(link.getAttribute("tabindex")).toBe("0");
  });

  it("posts a navigate message to window.parent on click", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [msg] = postMessage.mock.calls[0];
    expect(msg.type).toBe("arcade-studio:navigate");
    expect(msg.target).toBe("02-modal");
  });

  it("posts a navigate message when Enter is pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("posts a navigate message when Space is pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not post a message when other keys are pressed", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    render(
      <FrameLink target="02-modal">
        <span>Open</span>
      </FrameLink>,
    );
    fireEvent.keyDown(screen.getByRole("button"), { key: "a" });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm run studio:test __tests__/prototype-kit/frame-link.test.tsx`
Expected: FAIL — `FrameLink` import cannot be resolved.

### Step 3: Implement `FrameLink`

Create `studio/prototype-kit/composites/FrameLink.tsx`:

```tsx
import type { ReactNode, KeyboardEvent } from "react";

export interface FrameLinkProps {
  /** Target frame slug (e.g. "02-skill-modal"). Must exist in the project. */
  target: string;
  children: ReactNode;
}

/**
 * Wraps an element and makes clicking (or pressing Enter/Space on) the wrapped
 * content navigate to another frame in the same prototype. Uses postMessage to
 * signal the parent viewport; the parent handles scrolling and highlighting.
 *
 * Invisible by design — adds only a pointer cursor. The wrapped element keeps
 * its own appearance.
 */
export function FrameLink({ target, children }: FrameLinkProps) {
  function navigate() {
    try {
      window.parent?.postMessage(
        { type: "arcade-studio:navigate", target },
        "*",
      );
    } catch {
      // Cross-origin guard. Studio's iframes are always same-origin, so in
      // practice this never throws; swallow defensively for safety.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={onKeyDown}
      style={{ cursor: "pointer", display: "contents" }}
    >
      {children}
    </div>
  );
}
```

Note on `display: contents`: this makes the wrapper element itself render as if it isn't there from a layout perspective — the wrapped child keeps its natural flow. All modern evergreen browsers support it (Chrome 65+, Firefox 37+, Safari 11.1+). If manual QA reveals layout or click-handling issues, fall back to inline handling — but ship with `display: contents` first. The automated tests do not verify click geometry (jsdom doesn't render layout), so the layout behavior is strictly manual-QA territory.

### Step 4: Run test to verify it passes

Run: `pnpm run studio:test __tests__/prototype-kit/frame-link.test.tsx`
Expected: all 6 tests PASS.

### Step 5: Export from `index.ts`

Edit `studio/prototype-kit/index.ts`. Add this line alongside the other composite exports (e.g. after the `VistaPagination` export around line 27):

```ts
export { FrameLink } from "./composites/FrameLink.js";
```

(The `.js` suffix matches the convention used by every other export in the file.)

### Step 6: Run the full test suite to catch regressions

Run: `pnpm run studio:test`
Expected: all tests pass.

### Step 7: Commit

```bash
git add studio/prototype-kit/composites/FrameLink.tsx studio/prototype-kit/index.ts studio/__tests__/prototype-kit/frame-link.test.tsx
git commit -m "feat(studio/prototype-kit): FrameLink primitive for inter-frame navigation"
```

---

## Task 2: Viewport parent-side listener

Now that `FrameLink` posts messages, the parent needs to handle them. This task wires up: the `data-frame-slug` attribute on `FrameCard`, the message listener on `Viewport`, scroll-into-view, and the highlight state.

**Files:**
- Modify: `studio/src/components/viewport/FrameCard.tsx` — add `data-frame-slug` attribute + `highlighted` prop
- Modify: `studio/src/components/viewport/Viewport.tsx` — add the listener + state
- Test: `studio/__tests__/components/viewport-frame-link-nav.test.tsx`

### Step 1: Write the failing test

Create `studio/__tests__/components/viewport-frame-link-nav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { Viewport } from "../../src/components/viewport/Viewport";
import type { Project } from "../../server/types";

vi.mock("../../src/lib/api", () => ({
  api: { createFrame: vi.fn() },
}));

vi.mock("../../src/hooks/useFrames", () => ({
  useFrames: (project: Project) => ({ frames: project.frames, refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const threeFrameProject: Project = {
  slug: "demo",
  name: "Demo",
  theme: "arcade",
  mode: "light",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  frames: [
    { slug: "01-gallery", name: "Gallery", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
    { slug: "02-modal", name: "Modal", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
    { slug: "03-settings", name: "Settings", size: "1440", createdAt: "2026-01-01T00:00:00Z" },
  ],
};

function renderViewport() {
  return render(
    <Viewport
      project={threeFrameProject}
      frameWidth={1440}
      onFrameWidthChange={() => {}}
      zoom={1}
      onZoomChange={() => {}}
      onSeedChat={() => {}}
    />,
  );
}

describe("Viewport navigate-message handling", () => {
  it("renders a data-frame-slug attribute on each FrameCard", () => {
    const { container } = renderViewport();
    expect(container.querySelector('[data-frame-slug="01-gallery"]')).toBeTruthy();
    expect(container.querySelector('[data-frame-slug="02-modal"]')).toBeTruthy();
    expect(container.querySelector('[data-frame-slug="03-settings"]')).toBeTruthy();
  });

  it("scrolls the target frame into view when a navigate message arrives", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "02-modal" },
        }),
      );
    });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "smooth",
        inline: "center",
      }),
    );
  });

  it("applies a highlight data attribute to the target frame", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    target.scrollIntoView = vi.fn();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "02-modal" },
        }),
      );
    });

    // The Viewport toggles data-nav-highlight on the target frame for ~1s.
    // We assert the presence of the attribute synchronously after dispatch;
    // the fade-out timing is a visual concern verified in manual QA.
    expect(target.getAttribute("data-nav-highlight")).toBe("target");
  });

  it("highlights the source frame with 'missing' when the target does not exist", () => {
    const { container } = renderViewport();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:navigate", target: "99-does-not-exist", source: "01-gallery" },
        }),
      );
    });

    const source = container.querySelector('[data-frame-slug="01-gallery"]') as HTMLElement;
    expect(source.getAttribute("data-nav-highlight")).toBe("missing");
  });

  it("ignores unrelated messages", () => {
    const { container } = renderViewport();
    const target = container.querySelector('[data-frame-slug="02-modal"]') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "arcade-studio:canvas-wheel", deltaY: 10 },
        }),
      );
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
```

Note on `source` in the "missing target" test: the earlier spec said `FrameLink` posts `{ type, target, source }`. The unit test for `FrameLink` (Task 1) does not assert `source` because the component doesn't yet know it (deriving the current iframe's slug from `window.frameElement` is jsdom-hostile). For Task 2, we test the parent's *handling* of a `source` field that the caller chose to include — the integration contract is: if `source` is present and `target` is missing, flash the source red. Task 1's `FrameLink` ships without `source`; Task 5 adds it (see below).

### Step 2: Run the test to see it fail

Run: `pnpm run studio:test __tests__/components/viewport-frame-link-nav.test.tsx`
Expected: FAIL — `data-frame-slug` attribute does not exist yet.

### Step 3: Add `data-frame-slug` + `highlighted` to `FrameCard`

Edit `studio/src/components/viewport/FrameCard.tsx`. Find the outer `<div style={{ flex: "none" }}>` at the component return (around line 158) and wire two new pieces:

First, update the props signature (around line 32-46):

```tsx
export function FrameCard({
  projectSlug,
  frame,
  frameWidth,
  onFrameWidthChange,
  projectMode,
  zoom,
  highlighted,
}: {
  projectSlug: string;
  frame: Frame;
  frameWidth: number;
  onFrameWidthChange: (next: number) => void;
  projectMode: "light" | "dark";
  zoom: number;
  /** When set, paints a temporary outline: "target" = blue (nav success),
   *  "missing" = red (nav target not found). `null` when no highlight. */
  highlighted?: "target" | "missing" | null;
}) {
```

Second, attach `data-frame-slug` and `data-nav-highlight` to the outer wrapper. Change:

```tsx
  return (
    <div style={{ flex: "none" }}>
```

to:

```tsx
  return (
    <div
      style={{ flex: "none" }}
      data-frame-slug={frame.slug}
      data-nav-highlight={highlighted ?? undefined}
    >
```

Third, find the frame body container (the `<div>` at around line 238–260 that carries `var(--surface-overlay)` + the `border: "1px solid var(--stroke-neutral-subtle)"`). Add a conditional outline driven by `highlighted`. Replace its `boxShadow` expression with one that layers the existing picking shadow against the new nav outline. The existing block reads:

```tsx
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--surface-overlay)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: picking
              ? "inset 0 0 0 2px var(--component-button-primary-bg-idle)"
              : undefined,
            transition: "box-shadow 0.15s ease",
          }}
        >
```

Change to:

```tsx
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--surface-overlay)",
            border: "1px solid var(--stroke-neutral-subtle)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: picking
              ? "inset 0 0 0 2px var(--component-button-primary-bg-idle)"
              : highlighted === "target"
              ? "inset 0 0 0 2px var(--component-button-primary-bg-idle)"
              : highlighted === "missing"
              ? "inset 0 0 0 2px var(--fg-alert-prominent)"
              : undefined,
            transition: "box-shadow 0.4s ease",
          }}
        >
```

The `0.4s ease` transition (up from `0.15s`) gives the fade-out its intended gentleness when `highlighted` flips back to `null`.

### Step 4: Add the message listener + state to `Viewport`

Edit `studio/src/components/viewport/Viewport.tsx`. The file already has a `message` listener at the top-level effect for `arcade-studio:frame-error` (around lines 23–49). Add a second piece of state for navigation highlight, and handle the new message type in a new listener.

Add near the existing state declarations (top of the component body):

```tsx
const [highlight, setHighlight] = useState<{
  slug: string;
  kind: "target" | "missing";
} | null>(null);
```

Add a new `useEffect` alongside the existing `frame-error` effect:

```tsx
useEffect(() => {
  function onMessage(e: MessageEvent) {
    const data = e.data;
    if (
      !data ||
      typeof data !== "object" ||
      (data as { type?: unknown }).type !== "arcade-studio:navigate"
    ) {
      return;
    }
    const payload = data as { target?: unknown; source?: unknown };
    const target = typeof payload.target === "string" ? payload.target : null;
    const source = typeof payload.source === "string" ? payload.source : null;
    if (!target) return;

    const targetEl = document.querySelector<HTMLElement>(
      `[data-frame-slug="${CSS.escape(target)}"]`,
    );
    if (!targetEl) {
      console.warn(`[Viewport] FrameLink target "${target}" not found`);
      if (source) {
        setHighlight({ slug: source, kind: "missing" });
        window.setTimeout(() => setHighlight(null), 600);
      }
      return;
    }

    targetEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setHighlight({ slug: target, kind: "target" });
    window.setTimeout(() => setHighlight(null), 1100);
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}, []);
```

Then thread the `highlighted` prop through each rendered `FrameCard`. The existing map (around line 65–76) becomes:

```tsx
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
  />
))}
```

Add `useState` to the `react` import at the top of the file if it isn't already imported (it is — `NewFrameCard` task added it during Task 6 of the prior plan).

### Step 5: Run the new test

Run: `pnpm run studio:test __tests__/components/viewport-frame-link-nav.test.tsx`
Expected: 4 or 5 tests PASS (the "missing target" test may still fail if `source` isn't part of the message — that's Task 5; all other tests pass here).

If the "missing target" test fails, confirm the failure message is about the source highlight not appearing (`data-nav-highlight` is `null` rather than `"missing"`). Leave that one failing until Task 5 completes; we'll move on.

### Step 6: Run the full suite

Run: `pnpm run studio:test`
Expected: one known-failing test (the "missing target" case). All others pass.

### Step 7: Commit

```bash
git add studio/src/components/viewport/Viewport.tsx studio/src/components/viewport/FrameCard.tsx studio/__tests__/components/viewport-frame-link-nav.test.tsx
git commit -m "feat(studio/viewport): route navigate messages to scroll + highlight target frame"
```

---

## Task 3: Teach the agent

Pure prompt edit. Adds the "Wiring the flow" subsection inside the existing "When the prompt describes a flow" section. Adds one anti-pattern row to the existing anti-pattern table.

**Files:**
- Modify: `studio/templates/CLAUDE.md.tpl`

### Step 1: Add the "Wiring the flow" subsection

Open `studio/templates/CLAUDE.md.tpl`. Find the section `## When the prompt describes a flow` (added in 0.13.0). Scroll to its last subsection (`### Frame-targeted prompts`) and **insert a new subsection directly before it**:

```markdown
### Wiring the flow

A multi-frame prototype without navigation is just three disconnected screens. If the user's prompt names a specific element that should cause a transition between frames, wire it using `<FrameLink>`. Otherwise don't.

**Signal patterns to watch for in the prompt:**
- "click X and Y happens" — wrap X, target Y's frame.
- "clicking the card opens the modal" — wrap each card in the list.
- "pressing Save goes to the confirmation" — wrap the Save button.
- "the user clicks Edit and sees the settings" — wrap the Edit button.

**Primitive:** `<FrameLink target="NN-slug">…</FrameLink>` from `arcade-prototypes`. Wraps any element and makes clicking it navigate to the target frame. Invisible — no visual styling beyond a pointer cursor.

```tsx
// Prompt: "Click any skill card → opens the skill modal. Click Edit → settings."
// Frame 01-skills-gallery writes:
<FrameLink target="02-skill-modal">
  <SkillCard name="Research" />
</FrameLink>

// Frame 02-skill-modal writes:
<FrameLink target="03-skill-settings">
  <Button>Edit</Button>
</FrameLink>
```

**Slug source:** use the slug you assigned at split time (e.g. `01-skills-gallery`). The target frame's file doesn't need to exist yet — the slug is decided when you split.

**Import:** `import { FrameLink } from "arcade-prototypes";`

**When the prompt is silent about triggers**, do NOT invent them. List "no navigation wired — prompt didn't specify triggers" as a bullet in your `### Deviations` section. Matches the existing "don't invent content" rule.

```

### Step 2: Add the anti-pattern row

In the same file, find the section `### Concrete anti-patterns` and its Markdown table. Append a new row at the end of the table (immediately before the paragraph that follows it):

```markdown
| Wrapping every button in `<FrameLink>` because "this is a multi-frame flow" | Navigation is specific to the prompt's instructions, not a general property of flows. | Only wrap elements the prompt names as triggers. If the prompt doesn't name the trigger, don't wrap. |
```

### Step 3: Verify the boot-time template refresh propagates the change

Start the dev server:

```bash
pnpm run studio
```

On boot, the log should include a line like `[studio] refreshed CLAUDE.md for N project(s)`. Open one project's rendered CLAUDE.md at `~/Library/Application Support/arcade-studio/projects/<slug>/CLAUDE.md` and confirm the new "Wiring the flow" subsection is present. Quit the dev server.

### Step 4: Commit

```bash
git add studio/templates/CLAUDE.md.tpl
git commit -m "feat(studio/agent): teach the agent to wire FrameLink for user-specified transitions"
```

---

## Task 4: Update `KIT-MANIFEST.md`

The agent treats `KIT-MANIFEST.md` as authoritative for prototype-kit composites. Add a `FrameLink` entry so the agent doesn't fall back to reading the source.

**Files:**
- Modify: `studio/prototype-kit/KIT-MANIFEST.md`

### Step 1: Append the FrameLink entry

Open `studio/prototype-kit/KIT-MANIFEST.md`. Scroll to the very end of the file (after the last composite entry). Append:

```markdown

## FrameLink (composite)
_source: `composites/FrameLink.tsx`_

FrameLink — wraps an element and makes clicking (or keyboard-activating) it navigate to another frame in the same multi-frame prototype.

The wrapper renders `display: contents`, so the wrapped element's own layout is preserved. The wrapper adds `role="button"` + `tabIndex={0}` so keyboard users can Tab to it and press Enter/Space to navigate. Styled only with `cursor: pointer` — no visible "this is a link" affordance. The "click → navigate" relationship is invisible by design.

When clicked, the wrapper posts `{ type: "arcade-studio:navigate", target: "<frame-slug>" }` to the parent window. The studio viewport handles the scroll and highlight.

Usage:

```tsx
import { FrameLink } from "arcade-prototypes";

<FrameLink target="02-skill-modal">
  <SkillCard name="Research" />
</FrameLink>

<FrameLink target="03-skill-settings">
  <Button>Edit</Button>
</FrameLink>
```

```ts
type FrameLinkProps = {
  /** Target frame slug (e.g. "02-skill-modal"). */
  target: string;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT wrap an element unless the prompt explicitly names it as a transition trigger. Navigation is a specific choice the designer made, not a general property of multi-frame prototypes.
- Do NOT wrap entire regions (`<FrameLink target="02"><div className="container">…</div></FrameLink>`) — wrap the clickable element only (the card, button, or specific control named in the prompt).
- Do NOT use `<FrameLink>` instead of a regular `<Button>` for in-frame interactions (opening a dropdown, toggling a switch) — those are intra-frame and don't need navigation.
```

### Step 2: Commit

```bash
git add studio/prototype-kit/KIT-MANIFEST.md
git commit -m "docs(studio/prototype-kit): document FrameLink in KIT-MANIFEST"
```

---

## Task 5: Source slug in navigate messages

`FrameLink` currently posts `{ type, target }`. The parent-side handler flashes the source frame red if the target is missing — but that needs `source` in the message. Add it by reading the source frame's slug from the iframe URL (same pattern as `gestureForwarder.ts`). This closes the "missing target" test from Task 2.

**Files:**
- Modify: `studio/prototype-kit/composites/FrameLink.tsx`
- Modify: `studio/__tests__/prototype-kit/frame-link.test.tsx`

### Step 1: Add a test for the source slug

Edit `studio/__tests__/prototype-kit/frame-link.test.tsx`. Add at the end of the `describe` block:

```tsx
  it("includes the current frame slug as 'source' derived from the iframe URL", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    // Mimic the studio frame URL pattern: /api/frames/<projectSlug>/<frameSlug>
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("http://localhost:5556/api/frames/demo/01-gallery"),
    });
    try {
      render(
        <FrameLink target="02-modal">
          <span>Open</span>
        </FrameLink>,
      );
      fireEvent.click(screen.getByRole("button"));
      const [msg] = postMessage.mock.calls[0];
      expect(msg.source).toBe("01-gallery");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("omits 'source' when the URL does not match the frame path pattern", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", { postMessage });
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: new URL("http://localhost:5556/other/path"),
    });
    try {
      render(
        <FrameLink target="02-modal">
          <span>Open</span>
        </FrameLink>,
      );
      fireEvent.click(screen.getByRole("button"));
      const [msg] = postMessage.mock.calls[0];
      expect(msg.source).toBeUndefined();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
```

### Step 2: Run to see the new tests fail

Run: `pnpm run studio:test __tests__/prototype-kit/frame-link.test.tsx`
Expected: 6 passing, 2 new tests failing on `source` undefined / mismatched.

### Step 3: Extract source from URL in `FrameLink`

Edit `studio/prototype-kit/composites/FrameLink.tsx`. Replace the file contents with:

```tsx
import type { ReactNode, KeyboardEvent } from "react";

export interface FrameLinkProps {
  /** Target frame slug (e.g. "02-skill-modal"). Must exist in the project. */
  target: string;
  children: ReactNode;
}

/**
 * Wraps an element and makes clicking (or pressing Enter/Space on) the wrapped
 * content navigate to another frame in the same prototype. Uses postMessage to
 * signal the parent viewport; the parent handles scrolling and highlighting.
 *
 * Invisible by design — adds only a pointer cursor. The wrapped element keeps
 * its own appearance.
 */
export function FrameLink({ target, children }: FrameLinkProps) {
  function navigate() {
    try {
      const source = currentFrameSlug();
      window.parent?.postMessage(
        { type: "arcade-studio:navigate", target, ...(source ? { source } : {}) },
        "*",
      );
    } catch {
      // Cross-origin guard. Studio's iframes are always same-origin, so in
      // practice this never throws; swallow defensively for safety.
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={onKeyDown}
      style={{ cursor: "pointer", display: "contents" }}
    >
      {children}
    </div>
  );
}

/**
 * Derive the current frame's slug from the iframe URL. Studio mounts each
 * frame at `/api/frames/<projectSlug>/<frameSlug>`, so the last non-empty
 * path segment is the frame slug. Returns undefined if the path doesn't
 * match (e.g. the component runs outside a mounted frame — during tests,
 * inside Storybook, etc.).
 */
function currentFrameSlug(): string | undefined {
  const match = window.location.pathname.match(
    /^\/api\/frames\/[^/]+\/([^/?#]+)\/?$/,
  );
  return match?.[1];
}
```

### Step 4: Run the tests

Run: `pnpm run studio:test __tests__/prototype-kit/frame-link.test.tsx`
Expected: all 8 tests PASS.

### Step 5: Run the viewport test and confirm the previously-failing case now passes

Run: `pnpm run studio:test __tests__/components/viewport-frame-link-nav.test.tsx`
Expected: all 5 tests PASS (the "missing target" test that was failing in Task 2 now passes because `source` arrives in the message).

### Step 6: Run the full suite

Run: `pnpm run studio:test`
Expected: all tests pass.

### Step 7: Commit

```bash
git add studio/prototype-kit/composites/FrameLink.tsx studio/__tests__/prototype-kit/frame-link.test.tsx
git commit -m "feat(studio/prototype-kit): include source slug in FrameLink navigate messages"
```

---

## Task 6: Version bump + changelog

**Files:**
- Modify: `studio/packaging/VERSION`
- Modify: `studio/CHANGELOG.md`

### Step 1: Bump version

Read the current version: `cat studio/packaging/VERSION`. Should be `0.13.1`. Overwrite with `0.14.0` (single line, no trailing content other than a newline).

### Step 2: Add changelog entry

Edit `studio/CHANGELOG.md`. Add a new entry just below `Format loosely follows ...` and above the existing `## [0.13.1]` entry:

```markdown
## [0.14.0] — 2026-05-08

### Added
- Inter-frame navigation via `<FrameLink target="NN-slug">`: when the user's prompt names an element that should transition between frames (e.g. "clicking the skill card opens the modal"), the agent wraps that element. Clicking it scrolls the viewport to the target frame and highlights it for about a second. Keyboard-navigable (Tab + Enter/Space).
- Added `FrameLink` composite to the prototype kit and an agent-template rule that wires it only when prompts explicitly name the trigger.

```

### Step 3: Commit

```bash
git add studio/packaging/VERSION studio/CHANGELOG.md
git commit -m "chore(studio): bump to 0.14.0 — inter-frame navigation"
```

---

## Done — manual verification

Before declaring the feature shipped, run through the spec's success criteria on a dev build.

- [ ] **Start a clean dev build**

```bash
pnpm run studio
```

Open the app. Create a new project (theme arcade, mode light). Confirm the boot log mentions `[studio] refreshed CLAUDE.md for N project(s)`.

- [ ] **Prompt the agent with a 3-step flow that explicitly names transition triggers**

In the chat, type:

> "Build a 3-step flow:
> 1. A skills gallery settings page with skill cards.
> 2. Clicking any skill card opens a modal with skill details and an Edit button.
> 3. Clicking Edit goes to the skill settings page."

Expected: the agent asks whether to split. Reply "yes".

- [ ] **Agent produces three frames with FrameLink wrappers**

Watch the viewport. Within ~5 min, three frames appear: `01-*`, `02-*`, `03-*`. Click the project's "Open in editor" affordance if present; otherwise open the first frame's `index.tsx` on disk (`~/Library/Application Support/arcade-studio/projects/<slug>/frames/01-*/index.tsx`). Confirm:

- A `<FrameLink target="02-*">` wraps each skill card in frame 01.
- A `<FrameLink target="03-*">` wraps the Edit button in frame 02.

The agent's `### Deviations` section should not flag "no navigation wired" — the prompt named the triggers.

- [ ] **Verify click navigation works in the viewport**

Back in the Studio viewport:
1. Click a skill card in frame 01. Viewport scrolls horizontally to frame 02, which briefly flashes a blue outline.
2. Click the Edit button in frame 02. Viewport scrolls to frame 03 with the same flash.

- [ ] **Verify keyboard navigation works**

In frame 01, press Tab until a skill card's outline indicates keyboard focus. Press Enter. Expected: same scroll + flash as the mouse click path. (Tab focus should be visible — browser default focus ring on the wrapper div.)

- [ ] **Verify "target not found" behavior**

Manually edit the first frame on disk: change `target="02-*"` to `target="99-nonexistent"`. Save. Back in the viewport, wait for Vite HMR to reload the frame. Click the skill card. Expected:
- The source frame (frame 01) briefly flashes a red outline.
- The dev console logs `[Viewport] FrameLink target "99-nonexistent" not found`.

Restore the original target before moving on.

- [ ] **Verify the agent does NOT wrap buttons when the prompt is silent about triggers**

Create a new project. Prompt:

> "Build a 2-step flow: a login screen, then a welcome dashboard."

Agent splits → confirms → produces 2 frames. Open both frames on disk. Confirm:
- Neither frame contains a `<FrameLink>` wrapper.
- The agent's `### Deviations` section includes a bullet like "no navigation wired — prompt didn't specify triggers".

- [ ] **Run the full test suite**

```bash
pnpm run studio:test
```

Expected: all tests pass (425 after this plan's additions).

- [ ] **Ship**

If all checks pass, follow the release steps in `studio/CLAUDE.md` ("Releasing a new version"):

```bash
pnpm run studio:pack
gh release create v0.14.0 "studio/packaging/dist/Arcade Studio 0.14.0.dmg" \
  --repo asundiev-devrev/arcade-studio-releases \
  --title "Arcade Studio 0.14.0" \
  --notes-file <(awk '/^## \[0\.14\.0\]/{f=1;next} /^## \[/{f=0} f' studio/CHANGELOG.md) \
  --latest
```

---

## Self-review

**Spec coverage:**
- Spec Section A (`<FrameLink>` primitive) → Task 1 (ships component) + Task 5 (adds source).
- Spec Section B (parent-side navigation) → Task 2.
- Spec Section C (agent prompt rule) → Task 3.
- Spec "Files touched": all covered. `KIT-MANIFEST.md` → Task 4. VERSION + CHANGELOG → Task 6.
- Spec "Success criteria": all covered in "Done — manual verification".

**Naming consistency:**
- `target` (string, frame slug) used identically across Task 1, 2, 3, 4, 5.
- `source` field in messages introduced in Task 5, consumed in Task 2.
- `data-frame-slug` attribute (Task 2) and `data-nav-highlight` attribute (Task 2) used consistently in tests and viewport code.
- Message type string `"arcade-studio:navigate"` used identically across `FrameLink` (Task 1), viewport (Task 2), and the manifest entry (Task 4).

**No placeholders:** none found.

**Task 2's known-failing test** is handled deliberately — noted in Step 5 that one test fails until Task 5 lands. This is the cleanest TDD split given the two-task dependency on `source`.
