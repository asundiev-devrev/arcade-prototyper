# Vista Page Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `VistaPage` composite template to `studio/prototype-kit/` (plus three supporting composites — `VistaHeader`, `VistaToolbar`, `VistaGroupRail`) so the studio generator can scaffold DevRev vista list views from slot props, grounded in a Playwright DOM scan of `app.devrev.ai/devrev/vistas/vista-13460`.

**Architecture:** Slot-based composites compose production `arcade` primitives. One template (`VistaPage`) stitches the chrome together; body (group rail + table) is passed through `children`. `AppShell` gets two additive prop changes so it can render without a title bar and with a 256px sidebar.

**Tech Stack:** React, TypeScript, Tailwind v4, Vite, Vitest. Tokens come from `arcade-tokens.css` / `devrev-app-tokens.css` — never hex/rgb literals.

**Reference:** `studio/docs/plans/2026-04-27-vista-page-template-design.md` is the design spec this plan implements. Read it once before starting Task 1.

---

## File map

Create:
- `studio/prototype-kit/composites/VistaHeader.tsx`
- `studio/prototype-kit/composites/VistaToolbar.tsx`
- `studio/prototype-kit/composites/VistaGroupRail.tsx`
- `studio/prototype-kit/templates/VistaPage.tsx`

Modify:
- `studio/prototype-kit/composites/AppShell.tsx` — relax `titleBar` to optional, add `sidebarWidth?: "240" | "256"` (default `"240"`)
- `studio/prototype-kit/index.ts` — export four new symbols
- `studio/prototype-kit/README.md` — mention the new trio + template

No new tests. Studio composites have no unit tests by convention (see `studio/__tests__/` — only `prototype-kit-boundary.test.ts`, which is directory-scan-based and needs no extension). Verification is the existing `pnpm studio:test` passing + a manual render pass at the end.

---

## Task 1: Relax AppShell (titleBar optional, sidebarWidth prop)

**Files:**
- Modify: `studio/prototype-kit/composites/AppShell.tsx`

- [ ] **Step 1: Read the current AppShell**

Read the whole file so you understand the current render shape. Do not change anything yet.

- [ ] **Step 2: Update the JSDoc comment block**

Replace the JSDoc block at the top (the whole `/** … */` before `import`) with the updated version below. The shape diagram now notes that the title bar is optional and the sidebar can be 240 or 256.

```tsx
/**
 * AppShell — DevRev desktop window composite.
 *
 * Matches the Figma "Desktop App" frame and DevRev SoR vista pages:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Title Bar (optional — full-width, 52px)                     │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │               │                                              │
 *   │   Sidebar     │   Breadcrumb Bar (optional)                  │
 *   │   (240 or     ├──────────────────────────────────────────────┤
 *   │    256px)     │                                              │
 *   │               │   children (page body)                       │
 *   │               │                                              │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * Intentional opinions:
 * - Title bar spans the full width at the top WHEN PRESENT. Vista pages
 *   omit it — the sidebar starts at y=0.
 * - Sidebar width is 240px by default (matches the Figma Desktop App
 *   frame). Vista pages use 256px to match the real DevRev SoR app.
 * - No border-r on the sidebar — it uses --surface-shallow against the
 *   body's --surface-overlay so the color change is the separator.
 * - The divider above the page body (between breadcrumb bar and body)
 *   is rendered here via border-t on the body scroll container, and
 *   only when a breadcrumbBar is present.
 *
 * Slots:
 * - `titleBar` (optional) — a <TitleBar/>. Omit for chromeless/vista pages.
 * - `sidebar` — a <NavSidebar/>. Required.
 * - `breadcrumbBar` (optional) — a <BreadcrumbBar/> rendered above the body.
 * - `sidebarWidth` (optional, default "240") — "240" for Figma Desktop App
 *   frames, "256" for DevRev vista/production parity.
 * - `children` — page body content (typically a <PageBody/> or a vista body).
 */
```

- [ ] **Step 3: Update the type and defaulted props**

Replace the `type AppShellProps` block and the function signature line. Keep the rest of the function body exactly as-is for now.

```tsx
type AppShellProps = {
  titleBar?: ReactNode;
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  sidebarWidth?: "240" | "256";
  children: ReactNode;
};

export function AppShell({
  titleBar,
  sidebar,
  breadcrumbBar,
  sidebarWidth = "240",
  children,
}: AppShellProps) {
```

- [ ] **Step 4: Make the `<aside>` width reactive**

Inside the function body, find this exact line:

```tsx
        <aside className="w-60 shrink-0 h-full flex flex-col">{sidebar}</aside>
```

Replace with:

```tsx
        <aside
          className={[
            sidebarWidth === "256" ? "w-64" : "w-60",
            "shrink-0 h-full flex flex-col",
          ].join(" ")}
        >
          {sidebar}
        </aside>
```

(`w-60` = 240px, `w-64` = 256px in Tailwind.)

- [ ] **Step 5: `{titleBar}` already handles null**

The current render is `{titleBar}` directly. React renders `undefined` / `null` as nothing, so no code change needed — the type relax is enough. Confirm by reading the line; don't edit it.

- [ ] **Step 6: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes. Only the existing `prototype-kit-boundary.test.ts` should run; it's unrelated to this change but confirms `AppShell.tsx` still typechecks through TS / Vite.

If the test runner fails on AppShell's types, re-read steps 2–4.

- [ ] **Step 7: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/composites/AppShell.tsx
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Make AppShell titleBar optional and add sidebarWidth prop

Vista pages render no top title bar and use a 256px sidebar to match the
real DevRev SoR app. These two props are additive — SettingsPage passes
neither and renders identically.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create VistaHeader composite

**Files:**
- Create: `studio/prototype-kit/composites/VistaHeader.tsx`

- [ ] **Step 1: Write the file**

Create `studio/prototype-kit/composites/VistaHeader.tsx` with:

```tsx
/**
 * VistaHeader — DevRev vista page header band.
 *
 * Matches the header row on app.devrev.ai/devrev/vistas/* list views:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [title]  [count]                   [actions]  [primaryAction]│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   flex items-center justify-between px-page-gutter py-5
 *   → padding 20px 36px, height 72px, no bottom border
 *
 * The title and count sit on a shared baseline (matches the live
 * `flex items-baseline space-x-1.5`), NOT centered.
 *
 * Slots:
 * - `title` — the vista title. Typically an inline-edit button; a plain
 *   span also works.
 * - `count` (optional) — item count, rendered with fg-neutral-subtle.
 * - `actions` (optional) — IconButton cluster (search/sort/filter/…).
 * - `primaryAction` (optional) — primary call-to-action button (e.g. + Issue).
 */
import type { ReactNode } from "react";

type VistaHeaderProps = {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
};

export function VistaHeader({
  title,
  count,
  actions,
  primaryAction,
}: VistaHeaderProps) {
  return (
    <header className="flex items-center justify-between px-9 py-5 h-[72px] shrink-0">
      <div className="flex items-baseline gap-1.5 h-8">
        {title}
        {count != null ? (
          <span className="text-(--fg-neutral-subtle)">{count}</span>
        ) : null}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {actions}
        {primaryAction}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/composites/VistaHeader.tsx
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Add VistaHeader composite for DevRev vista page header band

Matches the live 72px header row at px-9 py-5 with baseline-aligned
title/count on the left and an actions+primaryAction cluster on the right.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create VistaToolbar composite

**Files:**
- Create: `studio/prototype-kit/composites/VistaToolbar.tsx`

- [ ] **Step 1: Write the file**

Create `studio/prototype-kit/composites/VistaToolbar.tsx` with:

```tsx
/**
 * VistaToolbar — DevRev vista toolbar band.
 *
 * Matches the filter/toolbar row on vista list views:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  [icons] │ [filter pills…] [+] [Clear]                       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   Outer: flex items-start mb-4 px-page-gutter justify-between
 *     → padding 0 36px, margin-bottom 16px
 *   Inner: flex gap-2 items-center flex-wrap (content 30px tall)
 *
 * The vertical separator after the icon cluster is owned by this
 * composite. When `toolbarIcons` is provided, the separator renders.
 * When absent, the row starts with `filters` directly.
 *
 * Slots:
 * - `toolbarIcons` (optional) — icon cluster (@ / chart / clock / …).
 * - `filters` (optional) — filter pill group + add-filter + clear.
 */
import type { ReactNode } from "react";

type VistaToolbarProps = {
  toolbarIcons?: ReactNode;
  filters?: ReactNode;
};

export function VistaToolbar({
  toolbarIcons,
  filters,
}: VistaToolbarProps) {
  return (
    <div className="flex items-start justify-between px-9 mb-4 shrink-0">
      <div className="flex gap-2 items-center flex-wrap">
        {toolbarIcons != null ? (
          <div className="flex items-center">
            {toolbarIcons}
            <div className="self-stretch my-2 w-px bg-(--stroke-neutral-subtle)" />
          </div>
        ) : null}
        {filters}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/composites/VistaToolbar.tsx
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Add VistaToolbar composite for DevRev vista filter/toolbar band

Owns the 36px gutter and 16px bottom margin. Renders a 1px token
separator between the icon cluster and the filter slot when both present.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create VistaGroupRail composite with compound Item

**Files:**
- Create: `studio/prototype-kit/composites/VistaGroupRail.tsx`

- [ ] **Step 1: Write the file**

Create `studio/prototype-kit/composites/VistaGroupRail.tsx` with:

```tsx
/**
 * VistaGroupRail — DevRev vista group/sort rail.
 *
 * Matches the 256px-wide left column in vista list-view body:
 *
 *   ┌────────────────────────┐
 *   │  Sort by Default ↑     │  ← sortControl slot
 *   ├────────────────────────┤
 *   │  P0                  1 │
 *   │  P1                 15 │  ← VistaGroupRail.Item list
 *   │  P2                 13 │
 *   │  P3                 17 │
 *   └────────────────────────┘
 *
 * Live DOM reference (1728×945):
 *   Outer: w=256, flex flex-col
 *   Sort control area: px-2 pt-4 pb-2
 *   Item list: role="group", flex-col, px-2
 *   Item: role="listitem", h=32, rounded-md (6px), px-2 gap-2, text-body-small
 *   Selected item: rgba(75,83,236,0.2) bg with rgba(75,83,236,0.1) outline
 *     → token-mapped to --bg-interactive-primary with /20 and /10 alpha
 *   Non-selected hover: --surface-overlay-hovered
 *
 * The `Item` subcomponent encodes the selected-state token mapping so
 * callers can't drift on the alpha values.
 *
 * Slots:
 * - `sortControl` (optional) — sort button shown above the item list.
 * - `children` — a list of <VistaGroupRail.Item/>.
 *
 * VistaGroupRail.Item props:
 * - `selected` — highlights the row with the interactive-primary tokens.
 * - `label` — left-aligned main text.
 * - `count` (optional) — right-aligned count; uses --fg-neutral-subtle.
 * - `onClick` (optional) — click handler.
 */
import type { MouseEventHandler, ReactNode } from "react";

type VistaGroupRailProps = {
  sortControl?: ReactNode;
  children: ReactNode;
};

function Root({ sortControl, children }: VistaGroupRailProps) {
  return (
    <aside className="w-64 shrink-0 flex flex-col">
      {sortControl != null ? (
        <div className="px-2 pt-4 pb-2">{sortControl}</div>
      ) : null}
      <nav role="group" className="flex flex-col px-2 gap-px">
        {children}
      </nav>
    </aside>
  );
}

type ItemProps = {
  selected?: boolean;
  label: ReactNode;
  count?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

function Item({ selected, label, count, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role="listitem"
      onClick={onClick}
      className={[
        "h-8 rounded-md px-2 flex items-center gap-2 w-full text-left",
        "text-body-small cursor-pointer",
        selected
          ? "bg-(--bg-interactive-primary-resting)/20 outline outline-1 outline-(--bg-interactive-primary-resting)/10"
          : "hover:bg-(--surface-overlay-hovered)",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="text-(--fg-neutral-subtle)">{count}</span>
      ) : null}
    </button>
  );
}

export const VistaGroupRail = Object.assign(Root, { Item });
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/composites/VistaGroupRail.tsx
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Add VistaGroupRail composite with compound Item

256px rail with a sortControl slot and a list of Items. Selected state
maps to --bg-interactive-primary-resting at 20% alpha with a 10% alpha
outline — the tokens that exist in both arcade and devrev-app themes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create VistaPage template

**Files:**
- Create: `studio/prototype-kit/templates/VistaPage.tsx`

- [ ] **Step 1: Write the file**

Create `studio/prototype-kit/templates/VistaPage.tsx` with:

```tsx
/**
 * VistaPage — DevRev vista list-view page template.
 *
 * Composes AppShell + VistaHeader + VistaToolbar in the canonical DevRev
 * vista layout, with a single body slot for the group rail + table:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  NavSidebar │  VistaHeader (title / count / actions)          │
 *   │  (256px)    ├──────────────────────────────────────────────┤
 *   │             │  VistaToolbar (icons | filters)                 │
 *   │             ├──────────────────────────────────────────────┤
 *   │             │  children (group rail + table, split by caller) │
 *   └─────────────┴──────────────────────────────────────────────┘
 *
 * Why a template, not a composite: like SettingsPage, this layer encodes
 * the relationship between composites. A generated frame drops from
 * ~200 hand-rolled lines to ~40 declarative slots.
 *
 * Intentional opinions:
 * - AppShell receives sidebarWidth="256" and no titleBar — vista pages are
 *   chromeless above the sidebar.
 * - The body band's 1px top border is owned by this template (no
 *   composite, because it's a sibling flex row with no state).
 * - `sidebar` expects a fully-composed NavSidebar; the template does not
 *   render one implicitly.
 *
 * Slots:
 * - `sidebar` — typically <NavSidebar workspace="DevRev">…</NavSidebar>.
 * - `title` — VistaHeader title slot.
 * - `count` (optional) — VistaHeader count slot.
 * - `actions` (optional) — VistaHeader right-cluster icon buttons.
 * - `primaryAction` (optional) — VistaHeader primary button (e.g. + Issue).
 * - `toolbarIcons` (optional) — VistaToolbar icon cluster.
 * - `filters` (optional) — VistaToolbar filter pills + add + clear.
 * - `children` — body content; typically a <VistaGroupRail/> followed by
 *   a flex-1 table container.
 */
import type { ReactNode } from "react";
import { AppShell } from "../composites/AppShell.js";
import { VistaHeader } from "../composites/VistaHeader.js";
import { VistaToolbar } from "../composites/VistaToolbar.js";

type VistaPageProps = {
  sidebar: ReactNode;

  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;

  toolbarIcons?: ReactNode;
  filters?: ReactNode;

  children: ReactNode;
};

export function VistaPage({
  sidebar,
  title,
  count,
  actions,
  primaryAction,
  toolbarIcons,
  filters,
  children,
}: VistaPageProps) {
  return (
    <AppShell sidebar={sidebar} sidebarWidth="256">
      <VistaHeader
        title={title}
        count={count}
        actions={actions}
        primaryAction={primaryAction}
      />
      <VistaToolbar toolbarIcons={toolbarIcons} filters={filters} />
      <div className="flex flex-grow min-h-0 border-t border-(--stroke-neutral-subtle)">
        {children}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/templates/VistaPage.tsx
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Add VistaPage template composing AppShell + VistaHeader + VistaToolbar

Passes sidebarWidth="256" and no titleBar to AppShell, stacks header +
toolbar, and wraps children in a border-t body band. Matches the live
DevRev vista list-view layout.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Export new symbols from the prototype-kit barrel

**Files:**
- Modify: `studio/prototype-kit/index.ts`

- [ ] **Step 1: Read the current barrel**

Look at the current file — it has a `// Composites` block with 14 exports and a `// Templates` block with `SettingsPage`.

- [ ] **Step 2: Add three composite exports**

Find the line:
```ts
export { SettingsRow } from "./composites/SettingsRow.js";
```

Immediately after that line (still inside the `// Composites` block), insert:
```ts
export { VistaHeader } from "./composites/VistaHeader.js";
export { VistaToolbar } from "./composites/VistaToolbar.js";
export { VistaGroupRail } from "./composites/VistaGroupRail.js";
```

- [ ] **Step 3: Add the template export**

Find the line:
```ts
export { SettingsPage } from "./templates/SettingsPage.js";
```

Immediately after that line (still inside the `// Templates` block), insert:
```ts
export { VistaPage } from "./templates/VistaPage.js";
```

- [ ] **Step 4: Typecheck**

Run:
```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio:test
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/index.ts
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Export Vista composites and template from arcade-prototypes barrel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Mention the Vista surface in the prototype-kit README

**Files:**
- Modify: `studio/prototype-kit/README.md`

- [ ] **Step 1: Update the `composites/` bullet**

Find:
```
- `composites/` — opinionated multi-part building blocks (AppShell, TitleBar,
  NavSidebar, BreadcrumbBar, PageBody, SettingsCard, SettingsRow, …). Each
  wraps one named compound frame in the DevRev Figma library.
```

Replace the composite list so it mentions the Vista trio. New version:
```
- `composites/` — opinionated multi-part building blocks (AppShell, TitleBar,
  NavSidebar, BreadcrumbBar, PageBody, SettingsCard, SettingsRow, VistaHeader,
  VistaToolbar, VistaGroupRail, …). Each wraps one named compound frame in
  the DevRev Figma library.
```

- [ ] **Step 2: Update the `templates/` bullet**

Find:
```
- `templates/` — full-page slot-based templates (SettingsPage, ChatPage,
  VistaPage, …). Each maps to one page type that appears repeatedly in DevRev
  Figma frames.
```

This bullet already lists `VistaPage` aspirationally — no change needed. Confirm by reading the file and skip to the next step if the line is present verbatim.

If the bullet says something different (e.g. `(SettingsPage, …)`), replace with the version above.

- [ ] **Step 3: Commit**

```bash
git -C /Users/andrey.sundiev/arcade-prototyper add studio/prototype-kit/README.md
git -C /Users/andrey.sundiev/arcade-prototyper commit -m "$(cat <<'EOF'
Mention Vista composites in prototype-kit README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual visual verification against the live vista

**Files:** none (verification step)

This task produces no commits. It validates that the chrome geometry matches the live DevRev vista and the specs in `studio/docs/plans/2026-04-27-vista-page-template-design.md`.

- [ ] **Step 1: Start the studio dev server (background)**

```bash
cd /Users/andrey.sundiev/arcade-prototyper && pnpm studio
```
Run in background; wait until stdout says `Local: http://localhost:5556/`.

- [ ] **Step 2: Build a throwaway vista frame**

In a new studio project (delete any existing `vista-smoke` project first), trigger generation with the prompt:

> Create a vista frame using `VistaPage` from `arcade-prototypes`. Title "ADS Components work", count 46, groups P0 (1), P1 (15), P2 (13), P3 (17) with P0 selected. Include placeholder icon buttons in `actions` and a primary `+ Issue` button. Keep the body table minimal — one row of placeholder cells inside a flex-1 container next to `<VistaGroupRail/>`.

Via the studio chat API:
```bash
rtk proxy curl -s -X DELETE http://localhost:5556/api/projects/vista-smoke 2>/dev/null
rtk proxy curl -s -X POST http://localhost:5556/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"vista-smoke","theme":"devrev-app","mode":"light"}'
rtk proxy curl -sN -X POST http://localhost:5556/api/chat \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"slug":"vista-smoke","prompt":"Create a vista frame using VistaPage from arcade-prototypes. Title ADS Components work, count 46, groups P0 (1 selected), P1 (15), P2 (13), P3 (17). Placeholder IconButtons in actions. Primary + Issue button. VistaGroupRail on the left of body and a flex-1 div on the right with a 1-row placeholder table."}
EOF
```

- [ ] **Step 3: Screenshot the generated frame**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --disable-gpu --hide-scrollbars --window-size=1728,945 \
  --screenshot=/tmp/vista-smoke.png \
  "http://localhost:5556/api/frames/vista-smoke/01-vista"
```
(The frame slug depends on what the agent generated — check `http://localhost:5556/projects/vista-smoke` in the browser if needed.)

- [ ] **Step 4: Compare against the live reference**

Open both images side by side:
```bash
open /tmp/vista-smoke.png /Users/andrey.sundiev/arcade-prototyper/.playwright-mcp/vista-13460.png
```

Run this visual checklist. Every item must pass:

- [ ] Sidebar is 256px wide (`w-64`)
- [ ] Main column starts with a 1px `--outline-01` left border
- [ ] Header band height 72px, padding `20px 36px`
- [ ] Title and count share a baseline (not vertically centered)
- [ ] Count color reads `--fg-neutral-subtle` (not near-black)
- [ ] Right cluster has 8px gap; + Issue uses primary-token background
- [ ] Toolbar band has `36px` horizontal gutter and `16px` bottom margin
- [ ] When `toolbarIcons` is passed, a 1px × 14px separator appears after them
- [ ] Filter pills are 30px outer / 28px inner split buttons, rounded-lg
- [ ] Body band starts with a 1px `--stroke-neutral-subtle` top border
- [ ] Group rail is 256px wide
- [ ] Selected rail item has alpha-20 background and alpha-10 outline, both
      derived from `--bg-interactive-primary-resting` — no hardcoded rgba
- [ ] Grepping the new composite files returns zero hex color literals:
      ```
      grep -rE '#[0-9a-fA-F]{3,8}\b|rgba?\(' \
        studio/prototype-kit/composites/VistaHeader.tsx \
        studio/prototype-kit/composites/VistaToolbar.tsx \
        studio/prototype-kit/composites/VistaGroupRail.tsx \
        studio/prototype-kit/templates/VistaPage.tsx
      ```
      Expected: no output.

- [ ] **Step 5: If anything fails**

Do NOT commit patches here — failures indicate a design or token-resolution gap. Report the specific mismatch and return to the spec; patching the composite to pass the checklist without understanding the root cause re-introduces the same hallucination class the prototype-kit was built to prevent.

- [ ] **Step 6: Stop the background studio server**

Stop the `pnpm studio` process.

---

## Done criteria

- [ ] All 7 code tasks commit cleanly; `pnpm studio:test` passes after each.
- [ ] Task 8 visual checklist passes every item.
- [ ] `git log --oneline -8` shows the 7 feature commits followed by the spec commit, in order.
- [ ] No new files outside the paths in the File Map above.
