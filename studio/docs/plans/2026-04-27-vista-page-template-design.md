# Vista Page Template — Design Spec

**Date:** 2026-04-27
**Reference:** `https://app.devrev.ai/devrev/vistas/vista-13460` (ADS Components work)
**Playwright captures:** `.playwright-mcp/vista-13460.png`, `.playwright-mcp/vista-13460-full.png`

## Goal

Add a `VistaPage` composite template to `studio/prototype-kit/` so the studio
generator can scaffold DevRev vista list views (chrome + toolbar + body) from
a minimal set of slot props. Matches the pattern set by `SettingsPage`.

Pixel accuracy is the acceptance criterion — a generated frame compared
against the real running DevRev vista should match on chrome geometry, token
use, and body band structure.

## Live structure (from Playwright DOM analysis at 1728×945)

Outer shell:

```
body > div.flex.flex-grow.bg-surface-shallow
├── [sidebar]   group/nav     w=256  h=945  (leftmost column)
└── [main col]  flex-col      x=256  w=1472 h=945
                border-l 1px #EEEFF1, bg white
```

Inside the main column, three bands stack vertically:

1. **Page header** — `y=0, h=72`
   - Outer: `flex items-center justify-between px-page-gutter py-5`
     → padding `20px 36px`, no bottom border
   - Left cluster (`flex items-baseline space-x-1.5`, height 32px):
     - Inline-edit title button `rounded-lg px-2 min-h-8 text-body-small-medium`,
       `fg-neutral-subtle` (`rgb(83,86,101)`)
     - Count div `fg-neutral-subtle`, reads "46"
   - Middle spacer `flex flex-grow`
   - Right cluster `flex items-center space-x-2` — icon buttons
     (search / sort / filter / settings / kebab) + primary **+ Issue** button

2. **Toolbar** — wrapper `y=72, h≈46` (30px content + `mb-4`)
   - Outer: `flex items-start mb-4 px-page-gutter justify-between`
     → padding `0 36px`, `margin-bottom 16px`
   - Inner row: `flex gap-2 items-center flex-wrap`, content height 30px
   - Order inside inner row:
     1. Icon cluster `flex` — 3× 38×30 icon wells
     2. Vertical separator `self-stretch my-2` — 1×14px, 8px vertical inset
     3. Filter pills — each `relative group removable box` containing
        `flex border border-1 border-input rounded-lg fg-neutral-subtle`,
        30px outer, split into 28px label/value buttons (e.g. "Work type |
        issue", "Subtype | Any of | Design system Work", …)
     4. Add-filter `+` button (28×28)
     5. "Clear" text button

3. **Body** — `y=118` to viewport bottom
   - Outer: `flex flex-grow min-h-0 isolate border-t border-default`
     → 1px top border `rgb(227,227,232)`
   - Column A: group rail
     - Width 256px (matches outer sidebar)
     - `flex flex-col`; "Sort by …" button at top (same `rounded-lg px-2
       min-h-8` treatment as title button), then `role="region"` + `role="group"`
       listing of `role="listitem"` rows, 32px tall, 6px radius
     - Selected item: `bg rgba(75,83,236,0.2)` with
       `outline 1px rgba(75,83,236,0.1)`
   - Column B: table area
     - Starts at `x=513` (`257 main + 256 rail`), fills the rest
     - ag-grid-style `[role="treegrid"]`; group rows have sticky headers
       `sticky top-0 pt-4 px-page-gutter mb-2`
     - Sample column widths: Items 496, Priority 116, DLS22 Migration Status
       166, Defragmentation Status 167, Design Readiness 156, Figma Audit
       137, Stage 160

## Scope

Shipping **four files + one knock-on change**:

New files:
- `studio/prototype-kit/composites/VistaHeader.tsx`
- `studio/prototype-kit/composites/VistaToolbar.tsx`
- `studio/prototype-kit/composites/VistaGroupRail.tsx`
- `studio/prototype-kit/templates/VistaPage.tsx`

Modified:
- `studio/prototype-kit/composites/AppShell.tsx` — `titleBar?` optional,
  new `sidebarWidth?: "240" | "256"` prop (default `"240"`)
- `studio/prototype-kit/index.ts` — export the four new symbols
- `studio/prototype-kit/README.md` — add the trio + template to the list

Out of scope (deferred):
- `VistaTable` / `VistaGroupedTable` composite (table body stays hand-rolled
  by the generator per vista — wait for a second vista example before
  abstracting)
- A `VistaTitleButton` composite for the inline-edit title (caller composes
  with the existing arcade `Button` until the pattern recurs)
- Kanban / timeline / detail-split vista variants
- Template rule additions in `studio/templates/CLAUDE.md.tpl` (done as a
  one-line addition in the implementation plan, but not design-owned)

## Architecture

Slot-based, matches `SettingsPage`. Composites fill roles, template wires
them together. No variants; if a shape diverges, it becomes a new
composite/template.

```
VistaPage (template)
└── AppShell (modified: titleBar?, sidebarWidth="256")
    ├── sidebar prop                    — caller passes <NavSidebar/>
    └── children
        ├── <VistaHeader/>              — band 1
        ├── <VistaToolbar/>             — band 2
        └── <div className="flex flex-grow min-h-0 border-t …">
            {children}                  — band 3 body (group rail + table)
```

### VistaHeader

```tsx
type VistaHeaderProps = {
  title: ReactNode;          // title button or plain text
  count?: ReactNode;         // "46" — rendered with fg-neutral-subtle
  actions?: ReactNode;       // IconButton cluster (right of spacer)
  primaryAction?: ReactNode; // + Issue primary Button
};
```

Fixed DOM:
```
<header className="flex items-center justify-between px-9 py-5 h-[72px]">
  <div className="flex items-baseline gap-1.5 h-8">
    {title}
    {count}
  </div>
  <div className="flex-1" />
  <div className="flex items-center gap-2">
    {actions}
    {primaryAction}
  </div>
</header>
```

Opinions:
- `px-9` (36px gutter), `py-5` (20px), height 72px
- `items-baseline` for title+count (live uses `items-baseline`, not centered)
- No bottom border — the toolbar's `mb-4` handles vertical separation

### VistaToolbar

```tsx
type VistaToolbarProps = {
  toolbarIcons?: ReactNode;  // icon cluster; renders separator when present
  filters?: ReactNode;       // filter pills + add + clear
};
```

Fixed DOM:
```
<div className="flex items-start justify-between px-9 mb-4">
  <div className="flex gap-2 items-center flex-wrap">
    {toolbarIcons && (
      <div className="flex items-center">
        {toolbarIcons}
        <div className="self-stretch my-2 w-px bg-(--stroke-neutral-subtle)" />
      </div>
    )}
    {filters}
  </div>
</div>
```

Opinions:
- `px-9 mb-4` (36px gutter, 16px bottom margin)
- `gap-2` between pills (8px, matches live)
- Separator owned by the composite; renders when `toolbarIcons` provided
- `+ add` and `Clear` live inside the caller's `filters` slot — not
  broken out because they're part of the same authored cluster

### VistaGroupRail

```tsx
type VistaGroupRailProps = {
  sortControl?: ReactNode;   // "Sort by Default ↑" control
  children: ReactNode;       // <VistaGroupRail.Item/> list
};

VistaGroupRail.Item: (props: {
  selected?: boolean;
  label: ReactNode;
  count?: ReactNode;
  onClick?: () => void;
}) => JSX.Element;
```

Fixed DOM:
```
<aside className="w-64 shrink-0 flex flex-col">
  {sortControl && <div className="px-2 pt-4 pb-2">{sortControl}</div>}
  <nav role="group" className="flex flex-col px-2 gap-px">
    {children}
  </nav>
</aside>
```

`Item` DOM (per row):
```
<a role="listitem" className={[
  "h-8 rounded-md px-2 flex items-center gap-2 cursor-pointer",
  "text-body-small",
  selected
    ? "bg-(--bg-interactive-primary-subtle) outline outline-1 outline-(--bg-interactive-primary-alpha-10)"
    : "hover:bg-(--surface-overlay-hovered)",
].join(" ")}>
  <span className="flex-1 truncate">{label}</span>
  {count && <span className="fg-neutral-subtle">{count}</span>}
</a>
```

Opinions:
- Rail width `w-64` (256px)
- Item 32px tall, `rounded-md` (6px)
- Selected token choice resolves to the closest existing arcade token for
  the DevRev indigo-at-20%-alpha background. Implementation plan resolves
  the exact token names via `grep` — if no match exists, falls back to the
  base `--bg-interactive-primary` token with `/20` and `/10` alpha modifiers
  (`bg-(--bg-interactive-primary)/20`). Never a hardcoded hex.

### VistaPage template

```tsx
type VistaPageProps = {
  sidebar: ReactNode;

  // Header slots (forwarded to VistaHeader)
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;

  // Toolbar slots (forwarded to VistaToolbar)
  toolbarIcons?: ReactNode;
  filters?: ReactNode;

  // Body slot — group rail + table live here
  children: ReactNode;
};
```

Body:
```
<AppShell sidebar={sidebar} sidebarWidth="256">
  <VistaHeader title={title} count={count} actions={actions} primaryAction={primaryAction} />
  <VistaToolbar toolbarIcons={toolbarIcons} filters={filters} />
  <div className="flex flex-grow min-h-0 border-t border-(--stroke-neutral-subtle)">
    {children}
  </div>
</AppShell>
```

Caller shape (typical):
```tsx
<VistaPage
  sidebar={<NavSidebar>…</NavSidebar>}
  title={<Button variant="ghost" size="sm">ADS Components work</Button>}
  count={<span>46</span>}
  actions={<>
    <IconButton icon={Search} />
    <IconButton icon={Sort} />
    <IconButton icon={Filter} />
    <IconButton icon={Settings} />
    <IconButton icon={Kebab} />
  </>}
  primaryAction={<Button variant="primary">+ Issue</Button>}
  toolbarIcons={<>
    <IconButton icon={AtSign} />
    <IconButton icon={Chart} />
    <IconButton icon={Clock} />
  </>}
  filters={<>
    <FilterPill label="Work type" value="issue" disabled />
    <FilterPill label="Subtype" op="Any of" value="Design system Work" />
    <FilterPill label="Tags" op="Any of" value="ADS26" tone="tag" />
    <FilterPill label="Part" op="Any of" value="ADS Components" tone="part" />
    <IconButton icon={Plus} size="sm" variant="dashed" />
    <Button variant="ghost" size="sm">Clear</Button>
  </>}
>
  <VistaGroupRail sortControl={<Button variant="ghost" size="sm">Sort by Default ↑</Button>}>
    <VistaGroupRail.Item selected label="P0" count="1" />
    <VistaGroupRail.Item label="P1" count="15" />
    <VistaGroupRail.Item label="P2" count="13" />
    <VistaGroupRail.Item label="P3" count="17" />
  </VistaGroupRail>
  <div className="flex-1 min-w-0 overflow-auto">
    {/* ag-grid-style grouped table — hand-rolled by the generator */}
  </div>
</VistaPage>
```

## AppShell modification

Current:
```tsx
type AppShellProps = {
  titleBar: ReactNode;
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  children: ReactNode;
};
```

After:
```tsx
type AppShellProps = {
  titleBar?: ReactNode;                      // was required
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  sidebarWidth?: "240" | "256";              // NEW — defaults to "240"
  children: ReactNode;
};
```

Render changes:
- `{titleBar}` → `{titleBar ?? null}` (trivial — React handles null already,
  just relax the type)
- `<aside className="w-60 …">` → `<aside className={`${sidebarWidth === "256" ? "w-64" : "w-60"} …`}>`

Contract preserved: existing `SettingsPage` passes `titleBar={<TitleBar/>}`
and no `sidebarWidth`, so it renders identically.

Update the JSDoc:
- Title bar row described as "optional; omitted for vistas and chromeless
  pages"
- Note the sidebarWidth prop and its default

## Testing

No new unit tests. The existing composites have none; the kit is
visual-first and tested via rendered output. Verification is manual:

1. Build a sample studio project that renders a vista frame via `VistaPage`
   with the ADS Components work data (title, count=46, 4 filter pills,
   4 priority groups).
2. Headless Chrome screenshot at 1728×945 and diff against
   `.playwright-mcp/vista-13460.png`.
3. Visual checks:
   - [ ] Sidebar 256px, border-l on main column
   - [ ] Header band height 72px, `20px 36px` padding
   - [ ] Title and count baseline-aligned, count uses `fg-neutral-subtle`
   - [ ] Right cluster spacing 8px; + Issue uses primary token
   - [ ] Toolbar band: 36px gutter, 16px bottom margin
   - [ ] Vertical separator 1×14px after icon cluster, with tokens
   - [ ] Filter pills 30px outer / 28px inner split buttons, rounded-lg
   - [ ] Body band starts with 1px `--stroke-neutral-subtle` top border
   - [ ] Group rail 256px, items 32px/6px-radius; selected state alpha-20
         background + alpha-10 outline
   - [ ] Nothing else uses raw hex or rgb values

## Risks

- **Token resolution for selected state** — the arcade token catalog may not
  have a direct equivalent for `rgba(75,83,236,0.2)`. Implementation plan
  begins with `grep`; if no match, fall back to modifier syntax on the base
  token. Either way, zero hex values land in the composite.
- **AppShell break** — the `w-60`→conditional change is the one line that
  could regress `SettingsPage`. Default stays `"240"`, so unchanged. The
  knock-on is a typecheck only.
- **Column-header data drift** — this spec defers the table body to the
  generator. The risk is that two vista prototypes diverge on column
  rendering in ways a future `VistaTable` would catch. Acceptable — table
  logic is where most drift happens; forcing a composite too early would
  ossify the wrong shape.

## Not doing

- Prop-based variants on any composite.
- Ownership of sort / group-by / filter state inside composites. Callers
  own state; composites are purely presentational.
- Any change to production `arcade` components (`src/`).
- Any change to `SettingsPage` / `TitleBar` / `NavSidebar` /
  `BreadcrumbBar` / `PageBody`.
- Template-generator rule additions in `CLAUDE.md.tpl`. Deferred to the
  implementation plan.
