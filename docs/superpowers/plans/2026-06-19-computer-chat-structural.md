# Computer Chat Structural Behaviors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring three structural behaviors from the `DeReGilz/responsive` prototype into our Computer chat composite stack: a container-query responsive shell, a collapsible icon-rail sidenav, and a tabbed canvas panel.

**Architecture:** `ComputerPage` becomes a `container-type: inline-size` CSS grid whose three columns reflow via Tailwind v4 `@container` breakpoints on the container's own width — no JS resize listener. `ComputerSidebar` gains a `collapsed` rail state (CSS width/opacity transition). A new `CanvasTabs` composite wraps the canvas with connected-tab styling + `useState` selection. `ComputerScene` orchestrates three booleans (`sidebarCollapsed`, `sidebarDrawerOpen`, `canvasDrawerOpen`); width-forced collapse + canvas→drawer conversion are CSS-only.

**Tech Stack:** TypeScript, React 18, Tailwind CSS v4.3 (`@container` built in), `@xorkavi/arcade-gen`, the prototype-kit build (`tsc → dist`), esbuild frame bundler, Playwright (visual verify).

## Global Constraints

- Package manager is **pnpm**; run from repo root. Tests: `pnpm run studio:test <path>` / full `pnpm run studio:test`.
- **The kit is consumed from `dist`, not source.** Frames import `arcade-prototypes` → kit `package.json` `exports` → `dist/index.js`. After editing ANY composite/template, run `pnpm run kit:build` before the thumbnail/screenshot verify reflects it. Also clear Vite cache + hard-restart if the dev server is running (stale-dist trap, auto-memory `prototype-kit-dist-vite-cache`).
- **Container queries, not viewport media queries.** All responsive logic keys off the `ComputerPage` container width via Tailwind `@container` utilities (Tailwind v4.3 — built in, no plugin). No `window.innerWidth`, no resize listener.
- **Backward compatible.** Every new prop on `ComputerPage` / `ComputerSidebar` is optional with a default that preserves today's behavior (expanded sidebar, no drawer); existing generated frames must keep rendering.
- Conventional Commits, scope `studio/prototype-kit` or `studio/templates`. Never `git add -A`/`git add .` — stage explicit paths.
- The kit is render-verified, not unit-tested. There are no vitest tests for these composites; the compile gate is `pnpm run kit:build` (tsc) + `pnpm run studio:templates` (esbuild bundle), and behavior is verified via live screenshots. The existing suite (`pnpm run studio:test`) must stay green.
- NOT ported: the prototype's JS FLIP/WAAPI morph animation (use a plain CSS transition), the dev bar, the Agent Studio pane, viewport media queries, persistence.

## Constants (shared module table — borrowed from the prototype)

| Name | Value | Meaning |
|---|---|---|
| `RAIL_WIDTH` | `64` | icon-rail sidebar width (px) |
| `SIDENAV_EXPANDED` | `256` | expanded sidebar width (px) — matches current `w-64` |
| `SIDENAV_OVERLAY` | `360` | floating overlay-drawer width (px) |
| `CANVAS_WIDTH` | `320` | docked canvas width (px) |
| `THRESHOLD_NO_CANVAS` | `600` | container px below which sidebar forced to rail (no canvas) |
| `THRESHOLD_WITH_CANVAS` | `900` | container px below which sidebar forced to rail (canvas docked) |
| `CANVAS_DRAWER_BELOW` | `600` | container px below which canvas → fixed drawer |
| `MAIN_MIN` | `260` | chat column min width (px) |

These appear as a `const` block in `ComputerPage.tsx` and are referenced in comments; the actual breakpoint numbers are written into Tailwind arbitrary container-query variants (e.g. `@max-[600px]:`).

## Tailwind v4 container-query reference (for implementers)

- Mark the container: `className="@container"` (sets `container-type: inline-size`).
- Query a descendant against the nearest `@container` ancestor: `@max-[600px]:hidden`, `@min-[900px]:grid`, `@[700px]:flex`, etc. (arbitrary px values in brackets).
- `@max-[Npx]:` = applies when container ≤ N; `@min-[Npx]:` / `@[Npx]:` = applies when container ≥ N.
- These are real Tailwind v4.3 utilities — no plugin, no config. Verify a class compiles by running `pnpm run kit:build` (the kit's Tailwind scan picks up the composite sources).

---

### Task 1: ComputerPage → container-query grid + constants

Convert the template's static flex row into a container grid with the constants block. No collapse/drawer behavior yet — just the grid foundation + the props surface later tasks consume. Existing slot API unchanged.

**Files:**
- Modify: `studio/prototype-kit/templates/ComputerPage.tsx`

**Interfaces:**
- Consumes: nothing (foundation).
- Produces:
  - `ComputerPage` — same slot API (`sidebar`, `header`, `chatInput`, `children`, `panel`), now a `@container` root. The canvas (`panel`) reflows from docked → fixed overlay drawer purely via container queries below `CANVAS_DRAWER_BELOW` (600px) — NO new props, NO boolean, NO resize listener (per spec: canvas→drawer is CSS-only).
  - exported `const COMPUTER_LAYOUT` constants object (the table above) so `ComputerScene` / `ComputerSidebar` can reference the numbers in comments.

- [ ] **Step 1: Rewrite ComputerPage with the container root + width-driven canvas drawer**

Replace the `ComputerPageProps` type + `ComputerPage` function (keep the whole doc comment above untouched; append a one-line note that the root is now a container and the canvas auto-converts to a drawer below 600px). New body:

```tsx
import type { ReactNode } from "react";

export const COMPUTER_LAYOUT = {
  RAIL_WIDTH: 64,
  SIDENAV_EXPANDED: 256,
  SIDENAV_OVERLAY: 360,
  CANVAS_WIDTH: 320,
  THRESHOLD_NO_CANVAS: 600,
  THRESHOLD_WITH_CANVAS: 900,
  CANVAS_DRAWER_BELOW: 600,
  MAIN_MIN: 260,
} as const;

type ComputerPageProps = {
  sidebar: ReactNode;
  header: ReactNode;
  chatInput: ReactNode;
  children: ReactNode;
  panel?: ReactNode;
};

export function ComputerPage({
  sidebar,
  header,
  chatInput,
  children,
  panel,
}: ComputerPageProps) {
  const hasPanel = panel != null;
  return (
    <div className="@container relative flex h-screen w-full bg-(--surface-backdrop) overflow-hidden">
      {sidebar}
      <div className="flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">
        {header}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {chatInput}
      </div>
      {hasPanel ? (
        <>
          {/* Docked canvas at wide container widths; hidden below 600px. */}
          <div className="shrink-0 @max-[600px]:hidden">{panel}</div>
          {/* Below 600px the same panel becomes a fixed overlay drawer
              (backdrop + right-pinned panel) escaping the overflow-hidden clip. */}
          <div className="hidden @max-[600px]:block">
            <div className="absolute inset-0 z-[110] bg-black/20" aria-hidden="true" />
            <div className="absolute right-0 top-0 z-[120] h-full shadow-lg">{panel}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}
```

(Note: the chat column is `flex-1` between two `shrink-0` siblings — sidebar and canvas — rather than a literal `grid-template-columns` with animated width variables. This achieves the 3-column reflow with less fragility; the sidebar sets its own width via Task 2's container queries, and the canvas docks/drawers via the `@max-[600px]` queries here. `@container` on the root is what every descendant query resolves against. The canvas→drawer conversion is entirely CSS — no `canvasDrawer` prop, no state, no resize listener.)

- [ ] **Step 2: Build the kit + confirm it compiles**

Run: `pnpm run kit:build`
Expected: completes without TS errors; `studio/prototype-kit/dist/templates/ComputerPage.js` regenerated.

- [ ] **Step 3: Confirm the thumbnail still renders (no regression)**

Run: `pnpm run studio:templates`
Expected: `✓ computer` (the Computer: Chat template seed renders `<ComputerScene />` which uses `ComputerPage`). Open `studio/prototype-kit/template-thumbs/computer.png` — confirm the chat screen still renders normally (docked layout, no visual change yet).

- [ ] **Step 4: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS (no test references ComputerPage internals; this guards the kit build + shell mocks).

- [ ] **Step 5: Commit**

```bash
git add studio/prototype-kit/templates/ComputerPage.tsx studio/prototype-kit/dist
git commit -m "feat(studio/prototype-kit): ComputerPage container grid + layout constants + canvas drawer slot"
```

(Note: `dist/` is committed — it's the consumed artifact. Stage the whole `studio/prototype-kit/dist` each task after `kit:build`.)

---

### Task 2: Collapsible icon-rail sidenav

Add the rail state to `ComputerSidebar`: a `collapsed` prop drives React-pinned rail styling, AND a container query forces the rail below the width threshold regardless of the prop. Labels/sections hide; the New Chat pill becomes a circle; a CSS transition animates it.

**Files:**
- Modify: `studio/prototype-kit/composites/ComputerSidebar.tsx`

**Interfaces:**
- Consumes: `COMPUTER_LAYOUT` from `../templates/ComputerPage` (for width values, referenced in comments; the literal px go into Tailwind classes).
- Produces: `ComputerSidebar` with a new optional prop:
  - `collapsed?: boolean` (default `false`) — React-pinned rail state. Applies `data-collapsed="true"` + rail width.
  - The root also carries `@container` width-forced rail classes (`@max-[600px]:w-16` style), so the rail appears below the threshold even when `collapsed` is false.

- [ ] **Step 1: Add the `collapsed` prop + rail width/transition to Root**

In `RootProps` (around line 61), add:

```tsx
  /** When true, the sidebar renders as a 64px icon-rail (labels hidden, New
   *  Chat → circle). A container query ALSO forces the rail below ~600px
   *  regardless of this prop, so a width-forced collapse auto-restores. */
  collapsed?: boolean;
```

In the `Root` function signature, add `collapsed = false,` to the destructure.

Replace the root `<div>` className (line 101) so width is driven by state + container query, with a transition:

```tsx
    <div
      data-collapsed={collapsed ? "true" : undefined}
      className={[
        "group/sidebar flex flex-col h-full shrink-0 bg-(--surface-overlay) border-r border-(--stroke-neutral-subtle)",
        "transition-[width] duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] overflow-hidden",
        collapsed ? "w-16" : "w-64",
        // Width-forced rail: when the container is narrow, force 64px even if
        // not React-collapsed. THRESHOLD_NO_CANVAS = 600.
        "@max-[600px]:w-16",
      ].join(" ")}
    >
```

- [ ] **Step 2: Hide labels / sections / chrome arrows in the rail**

The rail state is signalled two ways: the `data-collapsed` attr (React-pinned) and the `@max-[600px]` container query (width-forced). To handle BOTH with one CSS rule, add a helper class on every collapsible element that hides under either condition. Use Tailwind's `group-data` + container variants.

On the root, the `group/sidebar` class (added in Step 1) lets children react to `data-collapsed` via `group-data-[collapsed=true]/sidebar:`. For the width-forced case use `@max-[600px]:`.

Apply to the elements that must hide in the rail. In `WindowChrome` (line 132), hide the nav arrows cluster:

```tsx
      <div className="flex items-center gap-0.5 text-(--fg-neutral-prominent) group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden">
        <IconButton aria-label="Back" variant="tertiary" size="sm">
          <ChevronLeftSmall size={16} />
        </IconButton>
        <IconButton aria-label="Forward" variant="tertiary" size="sm">
          <ChevronRightSmall size={16} />
        </IconButton>
      </div>
```

In `Group` (line 247), hide the group title row when collapsed (keep the items):

```tsx
      {title || trailing ? (
        <div className="flex items-center justify-between px-3 py-2 mx-1 rounded-square hover:bg-(--bg-neutral-soft) transition-colors group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden">
```

In `Item` (line 294), hide the label text + trailing in the rail, keeping the leading icon/avatar centered. Wrap the children + trailing in a span that hides; center the row. Add to the Item root div className: `group-data-[collapsed=true]/sidebar:justify-center @max-[600px]:justify-center`, and wrap the label children in:

```tsx
      <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden">{children}</span>
```

(Read the current Item body first; apply the hide class to the text/trailing spans, NOT to `leading`.)

In the user footer block (line 120), hide the name/subtitle text + footerAction in the rail (keep the avatar):

```tsx
      {user ? (
        <div className="flex items-center gap-2 px-2 py-2 shrink-0 group-data-[collapsed=true]/sidebar:justify-center">
          <div className="flex-1 min-w-0 px-1 group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden">{user}</div>
          {footerAction ? <div className="shrink-0 group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden">{footerAction}</div> : null}
        </div>
      ) : null}
```

- [ ] **Step 3: New Chat pill → circle in the rail**

Find `DefaultPrimaryAction` (the New Chat button) below line 204. In the rail, it should become a 40px circle showing only the `+` icon. Add the collapse-reactive classes to the button so the label hides and it squares to a circle. Read the current `DefaultPrimaryAction` implementation, then make its label span `group-data-[collapsed=true]/sidebar:hidden @max-[600px]:hidden` and the button get `group-data-[collapsed=true]/sidebar:w-10 group-data-[collapsed=true]/sidebar:px-0 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:rounded-full @max-[600px]:w-10 @max-[600px]:px-0 @max-[600px]:justify-center @max-[600px]:rounded-full`. Keep the `<PlusInChatBubble>` (or whatever icon it uses) always visible.

- [ ] **Step 4: Build + render to confirm the rail compiles**

Run: `pnpm run kit:build && pnpm run studio:templates`
Expected: `✓ computer`. (Default render is expanded — `collapsed` defaults false and the thumbnail's container is wide — so the thumbnail looks unchanged. The rail is verified live in Task 6.)

- [ ] **Step 5: Run the full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/composites/ComputerSidebar.tsx studio/prototype-kit/dist
git commit -m "feat(studio/prototype-kit): collapsible icon-rail state for ComputerSidebar"
```

---

### Task 3: ComputerScene orchestration — functional collapse toggle

Wire the user-pinned collapse into `ComputerScene`: a working toggle on the sidebar's window-chrome button. The width-forced rail is already CSS (Task 2) and the canvas drawer is already CSS (Task 1) — this task only adds the one piece of React state the spec keeps in JS: the user-pinned collapse.

**Files:**
- Modify: `studio/prototype-kit/composites/ComputerScene.tsx`
- Modify: `studio/prototype-kit/composites/ComputerSidebar.tsx`

**Interfaces:**
- Consumes: `ComputerSidebar` `collapsed` prop (Task 2).
- Produces: `ComputerSidebar.Root` gains `onToggleCollapse?: () => void` wired to the window-chrome toggle button; `ComputerScene` holds `sidebarCollapsed` state and passes both props.

- [ ] **Step 1: Add collapse state to ComputerScene**

In the `ComputerScene` function (after line 198's `useState` block), add:

```tsx
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
```

- [ ] **Step 2: Make the WindowChrome collapse button functional**

The sidebar's collapse button currently lives inside `ComputerSidebar`'s internal `WindowChrome` (no handler). Add an optional `onToggleCollapse` prop to `ComputerSidebar.Root` and wire the `WindowChrome` `DotInLeftWindow` IconButton's `onClick` to it.

In `ComputerSidebar.tsx`: add `onToggleCollapse?: () => void;` to `RootProps`, destructure it in `Root`, thread it into `WindowChrome` (`<WindowChrome onToggle={onToggleCollapse} />`), give `WindowChrome` an `{ onToggle }: { onToggle?: () => void }` param, and set the existing `DotInLeftWindow` IconButton's `onClick={onToggle}`.

Then in `ComputerScene.tsx`, pass `collapsed={sidebarCollapsed}` and `onToggleCollapse={() => setSidebarCollapsed((v) => !v)}` to `<ComputerSidebar>` (around line 232).

- [ ] **Step 3: (no canvas-drawer wiring needed)**

The canvas drawer is fully CSS/container-driven in `ComputerPage` (Task 1) — there is no drawer state to wire here. Leave the `panel={panelOpen ? <DefaultCanvasPanel /> : undefined}` invocation as-is (Task 5 wraps it in `CanvasTabs`). This step is a no-op placeholder to make the absence explicit.

- [ ] **Step 4: Build + render**

Run: `pnpm run kit:build && pnpm run studio:templates`
Expected: `✓ computer`. Thumbnail unchanged at wide width.

- [ ] **Step 5: Full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/prototype-kit/composites/ComputerScene.tsx studio/prototype-kit/composites/ComputerSidebar.tsx studio/prototype-kit/dist
git commit -m "feat(studio/prototype-kit): wire sidebar collapse toggle in ComputerScene"
```

---

### Task 4: CanvasTabs composite

New composite: a tab strip with connected-tab styling + `useState` selection + graceful truncation, designed to wrap canvas content.

**Files:**
- Create: `studio/prototype-kit/composites/CanvasTabs.tsx`
- Modify: `studio/prototype-kit/index.ts` (export it)

**Interfaces:**
- Produces:
  - `CanvasTabs` — root, renders the tab strip + the active tab's body. Props: `{ tabs: Array<{ id: string; label: string; icon?: ReactNode }>; defaultTabId?: string; children: (activeId: string) => ReactNode }` OR a simpler controlled shape. Use the render-prop body so the caller decides what each tab shows.
  - Exported from `arcade-prototypes`.

- [ ] **Step 1: Write CanvasTabs.tsx**

```tsx
/**
 * CanvasTabs — tab strip for the Computer canvas pane. Connected-tab styling
 * (active tab merges into the body via white fill + no bottom rule; inactive
 * tabs + a trailing filler carry an inset bottom rule). Tabs shrink + ellipsis
 * + horizontally scroll as the canvas narrows — no JS for that.
 *
 * Usage:
 *   <CanvasTabs tabs={[{id:"canvas",label:"Canvas"},{id:"docs",label:"Docs"}]}>
 *     {(active) => active === "docs" ? <DocsBody/> : <CanvasPanel .../>}
 *   </CanvasTabs>
 */
import * as React from "react";
import { PlusSmall } from "@xorkavi/arcade-gen";

export type CanvasTab = { id: string; label: string; icon?: React.ReactNode };

type CanvasTabsProps = {
  tabs: CanvasTab[];
  defaultTabId?: string;
  /** Render-prop: receives the active tab id, returns that tab's body. */
  children: (activeId: string) => React.ReactNode;
};

export function CanvasTabs({ tabs, defaultTabId, children }: CanvasTabsProps) {
  const [active, setActive] = React.useState(defaultTabId ?? tabs[0]?.id ?? "");
  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-(--stroke-neutral-subtle) bg-(--surface-overlay)">
      {/* Tab strip */}
      <div className="flex shrink-0 items-stretch overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className="flex min-w-0 shrink items-center gap-1.5 px-3 py-2 text-body-small"
              style={{
                background: on ? "var(--surface-overlay)" : "transparent",
                color: on ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-subtle)",
                boxShadow: on ? "none" : "inset 0 -1px 0 var(--stroke-neutral-subtle)",
              }}
            >
              {t.icon ? <span className="shrink-0" style={{ color: on ? "var(--fg-info-prominent)" : "inherit" }}>{t.icon}</span> : null}
              <span className="min-w-0 truncate">{t.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Add tab"
          className="flex shrink-0 items-center px-2 text-(--fg-neutral-subtle)"
          style={{ boxShadow: "inset 0 -1px 0 var(--stroke-neutral-subtle)" }}
        >
          <PlusSmall size={16} />
        </button>
        {/* Trailing filler carries the bottom rule across leftover width */}
        <span className="flex-1" style={{ boxShadow: "inset 0 -1px 0 var(--stroke-neutral-subtle)" }} />
      </div>
      {/* Active tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children(active)}</div>
    </div>
  );
}
```

- [ ] **Step 2: Export from index.ts**

Add after the `CanvasPanel` export (line 14 region):

```tsx
export { CanvasTabs } from "./composites/CanvasTabs.js";
export type { CanvasTab } from "./composites/CanvasTabs.js";
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `pnpm run kit:build`
Expected: no TS errors; `dist/composites/CanvasTabs.js` emitted.

- [ ] **Step 4: Commit**

```bash
git add studio/prototype-kit/composites/CanvasTabs.tsx studio/prototype-kit/index.ts studio/prototype-kit/dist
git commit -m "feat(studio/prototype-kit): CanvasTabs composite (connected-tab strip)"
```

---

### Task 5: Wrap the canvas in CanvasTabs inside ComputerScene

Make the Computer scene's canvas use the tab strip. Default two tabs ("Canvas" / "Docs"), the existing `DefaultCanvasPanel` as the Canvas tab body.

**Files:**
- Modify: `studio/prototype-kit/composites/ComputerScene.tsx`

**Interfaces:**
- Consumes: `CanvasTabs` (Task 4); existing `DefaultCanvasPanel` (already in ComputerScene).

- [ ] **Step 1: Import CanvasTabs**

In ComputerScene's arcade-prototypes-internal imports (the file imports composites by relative path or from the barrel — match the existing style; CanvasPanel is referenced via a local `DefaultCanvasPanel`). Add at the top:

```tsx
import { CanvasTabs } from "./CanvasTabs";
```

- [ ] **Step 2: Wrap the panel**

Replace the `panel={panelOpen ? <DefaultCanvasPanel /> : undefined}` line with:

```tsx
      panel={
        panelOpen ? (
          <CanvasTabs
            tabs={[
              { id: "canvas", label: "Canvas" },
              { id: "docs", label: "Q3 launch brief.doc" },
            ]}
          >
            {(active) =>
              active === "canvas" ? (
                <DefaultCanvasPanel />
              ) : (
                <div className="p-6 text-body-medium text-(--fg-neutral-subtle)">
                  Document preview
                </div>
              )
            }
          </CanvasTabs>
        ) : undefined
      }
```

(NOTE: `DefaultCanvasPanel` currently renders its own fixed-width container with `border-l`. Since `CanvasTabs` now owns the `w-80 border-l` shell, check `DefaultCanvasPanel`/`CanvasPanel` — if it sets its own width + border, strip those so it renders as plain content inside the tab body. Read it first; remove only the outer width/border wrapper, keep the inner groups.)

- [ ] **Step 3: Build + render**

Run: `pnpm run kit:build && pnpm run studio:templates`
Expected: `✓ computer`. The default Computer thumbnail renders with the canvas open? No — `withCanvasPanel` defaults off, so the thumbnail won't show the canvas. That's fine; canvas + tabs are verified live in Task 6.

- [ ] **Step 4: Full suite**

Run: `pnpm run studio:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/prototype-kit/composites/ComputerScene.tsx studio/prototype-kit/composites/CanvasPanel.tsx studio/prototype-kit/dist
git commit -m "feat(studio/prototype-kit): canvas uses CanvasTabs in ComputerScene"
```

---

### Task 6: Live verification at three container widths

Verify the full structural behavior in a running app at wide / mid / narrow widths. No code unless verification surfaces a bug.

**Files:** none (verification). Fixes go to the relevant composite + a `kit:build`.

- [ ] **Step 1: Build everything fresh + full suite**

Run: `pnpm run kit:build && pnpm run studio:test`
Expected: kit builds clean; suite green.

- [ ] **Step 2: Seed a Computer frame with the canvas open**

The default "Computer: Chat" template seeds `<ComputerScene />` with the canvas closed. To verify canvas tabs + drawer, temporarily seed a project whose frame is `<ComputerScene withCanvasPanel />`. Steps:

```bash
# start the server if not running
lsof -iTCP:5556 -sTCP:LISTEN -n >/dev/null 2>&1 || (ARCADE_STUDIO_OPEN_BROWSER=0 pnpm run studio > /tmp/cc-server.log 2>&1 &)
sleep 7
# create + seed the computer template
curl -s -X POST http://localhost:5556/api/projects -H "Content-Type: application/json" -d '{"name":"CC Verify","theme":"arcade","mode":"light"}' -o /tmp/p.json
SLUG=$(python3 -c "import json;print(json.load(open('/tmp/p.json'))['slug'])")
curl -s -X POST "http://localhost:5556/api/projects/$SLUG/seed-template" -H "Content-Type: application/json" -d '{"templateId":"computer"}' >/dev/null
# overwrite the seeded frame to open the canvas
echo 'import * as React from "react";
import { ComputerScene } from "arcade-prototypes";
export default function Frame() { return <ComputerScene withCanvasPanel />; }' > "$HOME/Library/Application Support/arcade-studio/projects/$SLUG/frames/01-computer/index.tsx"
echo "seeded $SLUG"
```

- [ ] **Step 3: Screenshot at three widths**

Open the standalone frame URL and screenshot via Playwright at three viewport widths (the frame fills the viewport; the `@container` root width tracks it):
- **Wide (~1440):** `browser_resize` 1440×900 → navigate `http://localhost:5556/api/frames/<SLUG>/01-computer?mode=light` → screenshot. Expect: expanded sidebar + chat + docked canvas with tabs.
- **Mid (~820):** resize 820×900 → screenshot. Expect: sidebar forced to icon-rail (64px), canvas still docked.
- **Narrow (~520):** resize 520×900 → screenshot. Expect: icon-rail + canvas as an overlay drawer (backdrop dim, panel pinned right), chat full-width behind.

Confirm in each: labels hide in the rail, New Chat is a circle, canvas tabs render the connected-tab style. Then click the sidebar collapse toggle at wide width → confirms expanded↔rail toggle. Click a canvas tab → body swaps.

- [ ] **Step 4: Clean up the test project**

```bash
rm -rf "$HOME/Library/Application Support/arcade-studio/projects/cc-verify"*
```

- [ ] **Step 5: Commit any verification fixes**

If fixes were needed:

```bash
git add studio/prototype-kit/<fixed files> studio/prototype-kit/dist
git commit -m "fix(studio/prototype-kit): <what verification caught>"
```

---

## Notes for the implementer

- **Always `pnpm run kit:build` after editing a composite/template** before the thumbnail or live frame reflects it — frames consume `dist`, not source. Stage `studio/prototype-kit/dist` in each commit.
- Tailwind `@container` variants only compile if the kit's Tailwind scan sees the class in a composite source — `kit:build` handles that; if a container class silently no-ops, confirm it's spelled as a real v4 utility (`@max-[600px]:hidden`, not `max-container-...`).
- The width-forced rail (Task 2) and the canvas drawer (Task 3) are BOTH pure container-query CSS — no `window`/resize anywhere. Only the user-pinned collapse toggle is React state.
- This is a **fixes/local-test** workflow (auto-memory `feedback-fixes-local-test`): no version bump / CHANGELOG / pack unless asked.
- If `DefaultCanvasPanel`/`CanvasPanel` owns its own width + `border-l`, move that shell ownership to `CanvasTabs` (Task 5 Step 2 note) so the panel doesn't double-border inside the tab body.
