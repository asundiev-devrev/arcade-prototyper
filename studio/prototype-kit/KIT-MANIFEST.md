# Prototype kit manifest

> Auto-generated from `studio/prototype-kit/{composites,templates}/*.tsx`.
> DO NOT edit by hand — run the studio dev server (or `writeManifest()`)
> to refresh. Read this file BEFORE reading any individual composite or
> template source; if a prop signature here is enough, skip the extra
> `Read`. Open the `.tsx` only when you need the full rendered markup.

_34 entries — 30 composites, 4 templates._

## Templates


## BuilderPage (template)
_source: `templates/BuilderPage.tsx`_

BuilderPage — agent / entity builder page template.

Matches the Figma Agent creation page (AS-Deploy, node 7546:37777): a desktop
window with a left nav, a tab bar (Build / Test / Deploy / Observe), and a
centered editor column containing the entity title + description, a
"Capabilities" group of CapabilitySections, and an Instructions block.

  ┌──────────────────────────────────────────────────────────┐
  │  TitleBar                                                  │
  ├───────────┬──────────────────────────────────────────────┤
  │           │  Build  Test  Deploy  Observe        (tabs)   │
  │  sidebar  ├──────────────────────────────────────────────┤
  │           │        CX Agent                               │
  │           │        You are a customer experience agent…   │
  │           │        Capabilities                            │
  │           │        ◇ Knowledge              + Add          │
  │           │        ◇ Skills, Tools & …      + Add          │
  │           │        ◇ Guardrails             + Add          │
  │           │        Instructions                            │
  └───────────┴──────────────────────────────────────────────┘

Why a template: encodes the relationship between AppShell + the centered
720px editor column + capability sections, so a generated agent-builder frame
is declarative slots, not hand-rolled chrome.

Intentional opinions:
- Composes `AppShell` (title bar + sidebar) and renders a single centered
  max-w-[720px] editor column — the Figma agent editor content width.
- `tabs` is an optional row above the editor (Build/Test/Deploy/Observe).
  Pass a composed `Tabs` or leave undefined.
- `title` + `subtitle` are the agent heading; `children` is the editor body
  (typically a "Capabilities" heading + `CapabilitySection` stack + an
  Instructions block).

Slots:
- `sidebar` — a composed NavSidebar (required).
- `actions` — TitleBar trailing cluster.
- `tabs` — optional tab row above the editor column.
- `title` / `subtitle` — agent name + role description.
- `children` — editor body (CapabilitySection stack, Instructions, etc.).


```ts
type BuilderPageProps = {
  sidebar: ReactNode;
  actions?: ReactNode;
  /** Breadcrumb row above the tab bar (leading). Pass a composed Breadcrumb. */
  breadcrumb?: ReactNode;
  /** Trailing cluster on the breadcrumb row (e.g. an agent-status chip + icon). */
  headerActions?: ReactNode;
  tabs?: ReactNode;
  /** Trailing toolbar inline with the tab bar (e.g. a "Publish" pill button). */
  toolbar?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT widen the editor column past 720px — the builder is a
  centered reading-width column, not a full-bleed page.
- Do NOT use this for a settings/list page. Use `SettingsPage`
  or `VistaPage`. This template is for the capability-editor layout.

## ComputerPage (template)
_source: `templates/ComputerPage.tsx`_

ComputerPage — Computer / Agent Studio chat-screen page template.

Composes ComputerSidebar (with its own window chrome) + ComputerHeader +
a scrolling body slot + ChatInput, with an optional right-hand panel
(typically a CanvasPanel) as a sibling of the chat column:

  ┌──────────────────────────────────────────────────────────────────────┐
  │ ComputerSidebar │  ComputerHeader (title pill | actions)             │
  │  (own chrome,   ├─────────────────────────────────────────┬──────────┤
  │   New Chat,     │  body (ChatMessages / ChatEmptyState)   │  panel   │
  │   sessions,     │  …                                      │ (Canvas  │
  │   chats, user)  ├─────────────────────────────────────────┤   Panel) │
  │                 │  ChatInput (full-width, bottom-flush)   │          │
  └─────────────────┴─────────────────────────────────────────┴──────────┘

Why a template, not a composite: like SettingsPage / VistaPage, this
encodes the *relationship* between the Computer composites. A generated
Computer frame collapses from ~250 hand-rolled lines (including window
chrome, sidebar, message area, composer, optional details rail) to ~40
declarative slots.

Intentional opinions:
- The template does NOT use AppShell. ComputerSidebar already owns the
  window chrome (traffic lights, collapse, nav arrows) — wrapping it in
  AppShell would stack two title bars. The outer flex row + window
  surface is owned here.
- The body is ALWAYS scrollable, ALWAYS bordered above the ChatInput
  (top border on ChatInput) and below the ComputerHeader (no border —
  header sits flush against the body surface). Don't add your own.
- `chatInput` is a separate slot from `children` because it never lives
  inside the scrolling body — it sits below it as a sibling of the
  scroll container, full-width.
- `panel` is the right-hand side panel (CanvasPanel by convention). When
  omitted, the chat column fills the full width to the right of the
  sidebar. The panel supplies its own border-l / surface tokens.

Slots:
- `sidebar` (required) — typically <ComputerSidebar>…</ComputerSidebar>.
- `header` (required) — typically <ComputerHeader title="…" actions={…} />.
- `chatInput` (required) — typically <ChatInput trailing={…} />.
- `children` — body content. Typically <ChatMessages>…</ChatMessages> for
  an active conversation, or <ChatEmptyState /> for a fresh chat.
- `panel` (optional) — right-hand artefacts panel (CanvasPanel by
  convention). When omitted, no right rail is rendered.


```ts
type ComputerPageProps = {
  sidebar: ReactNode;
  header: ReactNode;
  chatInput: ReactNode;
  children: ReactNode;
  panel?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT also pass a TitleBar (via AppShell or directly). ComputerSidebar OWNS the window chrome; doubling up stacks two title bars. The chat column is deliberately chromeless above the ComputerHeader.
- Do NOT wrap the ChatInput in extra padding or a max-width column. It is designed to be full-width and bottom-flush; padding lives inside the composite.
- Do NOT render the chat body inside a max-width="640" wrapper at the template level — `ChatMessages` and its message bubbles already cap their own widths. The scroll container should fill the chat column so the empty-state wordmark centers correctly.
- Do NOT re-implement `ComputerPage` locally in the frame (`function ComputerPage(…) { return <div className="flex">…</div> }`). Import it from `arcade-prototypes`. Same for `ComputerSidebar`, `ComputerHeader`, `ChatInput`, `ChatMessages`, `ChatEmptyState`, `CanvasPanel`.
- Do NOT use `SettingsPage` or `VistaPage` for a Computer chat screen — those wire DevRev SoR chrome (TitleBar + NavSidebar + breadcrumb / VistaHeader + VistaToolbar). Computer screens have a fundamentally different shape: chat-style sidebar, conversation header, scrolling transcript, command bar.

**Tokens commonly needed inside this composite's user slot:**

Canvas tokens most likely to be referenced inside the body slot:

| Intent                      | Token                           |
|---|---|
| Body surface                | `--surface-overlay` (already applied by template) |
| Sidebar surface             | `--surface-shallow` (already applied via ComputerSidebar) |
| Window backdrop             | `--surface-backdrop`            |
| Divider / border            | `--stroke-neutral-subtle`       |

## SettingsPage (template)
_source: `templates/SettingsPage.tsx`_

SettingsPage — DevRev settings-style page template.

Composes AppShell + TitleBar + NavSidebar + BreadcrumbBar + PageBody in
the canonical DevRev desktop settings layout:

  ┌──────────────────────────────────────────────────────────┐
  │  TitleBar (traffic lights + collapse | nav + actions)    │
  ├──────────────────────────────────────────────────────────┤
  │  NavSidebar  │  BreadcrumbBar                            │
  │              ├───────────────────────────────────────────┤
  │              │  PageBody (title + subtitle + sections)   │
  └──────────────┴───────────────────────────────────────────┘

Why a template, not a composite: this layer encodes the *relationship*
between composites. A generated frame shrinks from ~250 hand-rolled lines
to ~40 declarative slots, and there is no room to hallucinate the wrong
page chrome.

Intentional opinions:
- The template controls the outer chrome (title bar, sidebar split, body
  divider). Callers fill slots but do not choose the assembly.
- `sidebar` expects a fully-composed NavSidebar; the template does not
  render one implicitly, because the sidebar contents vary per prototype.
- `actions` populates the TitleBar's trailing cluster (top-right of the
  window) — search, bell, avatar, etc.
- `breadcrumb` is passed straight through to BreadcrumbBar.
- `title`, `subtitle`, and `children` are passed straight through to
  PageBody.

Slots:
- `sidebar` — typically <NavSidebar workspace="DevRev">…</NavSidebar>.
- `breadcrumb` — typically <Breadcrumb.Root>…</Breadcrumb.Root>.
- `actions` (optional) — top-right cluster (IconButtons + Avatar).
- `pageActions` (optional) — cluster on the BreadcrumbBar (e.g. a "More"
  IconButton or a "Save" primary Button).
- `title` (optional) — hero page title.
- `subtitle` (optional) — page description.
- `children` — SettingsCard stack (or any centered body content).


```ts
type SettingsPageProps = {
  sidebar: ReactNode;
  breadcrumb: ReactNode;
  actions?: ReactNode;
  pageActions?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Primary CTA aligned inline with the page title (e.g. "Add custom
   *  connector"). Prefer this over `pageActions` for the page's main action —
   *  Figma places it next to the heading, not in the breadcrumb bar. */
  titleAction?: ReactNode;
  children: ReactNode;
}
```

## VistaPage (template)
_source: `templates/VistaPage.tsx`_

VistaPage — DevRev vista list-view page template.

Composes AppShell + VistaHeader + VistaToolbar in the canonical DevRev
vista layout, with a single body slot for the group rail + table:

  ┌──────────────────────────────────────────────────────────────┐
  │  NavSidebar │  VistaHeader (title / count / actions)          │
  │  (256px)    ├──────────────────────────────────────────────┤
  │             │  VistaToolbar (icons | filters)                 │
  │             ├──────────────────────────────────────────────┤
  │             │  children (group rail + table, split by caller) │
  └─────────────┴──────────────────────────────────────────────┘

Why a template, not a composite: like SettingsPage, this layer encodes
the relationship between composites. A generated frame drops from
~200 hand-rolled lines to ~40 declarative slots.

Intentional opinions:
- AppShell receives sidebarWidth="256" and no titleBar — vista pages are
  chromeless above the sidebar.
- The body band's 1px top border is owned by this template (no
  composite, because it's a sibling flex row with no state).
- `sidebar` expects a fully-composed NavSidebar; the template does not
  render one implicitly.

Slots:
- `sidebar` — typically <NavSidebar workspace="DevRev">…</NavSidebar>.
- `title` — VistaHeader title slot.
- `count` (optional) — VistaHeader count slot.
- `actions` (optional) — VistaHeader right-cluster icon buttons.
- `primaryAction` (optional) — VistaHeader primary button (e.g. + Issue).
- `toolbarIcons` (optional) — VistaToolbar icon cluster.
- `filters` (optional) — VistaToolbar filter pills + add + clear.
- `children` — body content; typically a <VistaGroupRail/> followed by
  a flex-1 table container.

**Compound:** `VistaPage.Tabs`, `VistaPage.Tab`

```ts
type VistaPageProps = {
  sidebar: ReactNode;

  title: ReactNode;
  count?: ReactNode;
  editable?: boolean;

  /** Tab strip (left of the tab row), e.g. <VistaPage.Tabs>. Sits on the SAME
   *  row as the toolbar — production puts tabs left, toolbar right. */
  tabs?: ReactNode;
  /** Toolbar icon-button cluster (search / sort / filter / more). Renders on
   *  the RIGHT of the tab row. Pass <VistaHeader.Action … /> children. */
  actions?: ReactNode;
  /** Primary CTA (e.g. + Issue), right-most on the tab row. */
  primaryAction?: ReactNode;

  filters?: ReactNode;

  children: ReactNode;
}
```

**When NOT to use this:**
- Never re-implement `VistaPage` locally in the frame (`function VistaPage(…) { return <AppShell …/> }`). Import it from `arcade-prototypes`. Same for `VistaGroupRail` and `VistaRow`.
- Do NOT also pass a `TitleBar` via `AppShell` — vista pages are deliberately chromeless above the sidebar; the sidebar starts at y=0.
- Do NOT pre-wrap `title` or `count` in your own `<span className="text-…">`. `VistaHeader` applies `text-title-3` to the title and `text-body` + `--fg-neutral-subtle` to the count; any wrapper classes you add will just fight it.
- For the table body inside `children`, use `<VistaRow>` + the column vocabulary. Do NOT hand-roll `<div className="flex items-center h-11 …">` rows — they drift on tokens and hover states.
- Pass the `count` verbatim as it appears in the reference (Figma frame, screenshot, or description) — `"165.1K"`, `"1.2M"`, `"16,538"`. Do NOT reformat, expand (`"165100"`), strip separators (`"16538"`), or localize. `count` is a display string, not a number.
- Render exactly the controls the reference shows in `actions` — count them before writing JSX. If the reference shows 3 icon buttons, render 3. Do not add a gear, a more-menu, a view-toggle, or any "list views usually have X" control. Same for `toolbarIcons` and `filters`.
- When the reference shows a tab strip (e.g. `Issues +`) or segmented toggle between the toolbar and the table body, render it as the FIRST element inside `children`, ABOVE the group rail + table row. It is not optional chrome; dropping it changes the meaning of the page. If the template's slots don't cleanly accommodate a tab strip, put it inline inside `children` — just don't skip it.


## Composites


## AppShell (composite)
_source: `composites/AppShell.tsx`_

AppShell — DevRev desktop window composite.

Matches the Figma "Desktop App" frame and DevRev SoR vista pages:
  ┌─────────────────────────────────────────────────────────────┐
  │  Title Bar (optional — full-width, 52px)                     │
  ├─────────────────────────────────────────────────────────────┤
  │               │                                              │
  │   Sidebar     │   Breadcrumb Bar (optional)                  │
  │   (240 or     ├──────────────────────────────────────────────┤
  │    256px)     │                                              │
  │               │   children (page body)                       │
  │               │                                              │
  └───────────────┴──────────────────────────────────────────────┘

Intentional opinions:
- Title bar spans the full width at the top WHEN PRESENT. Vista pages
  omit it — the sidebar starts at y=0.
- Sidebar width is 240px by default (matches the Figma Desktop App
  frame). Vista pages use 256px to match the real DevRev SoR app.
- No border-r on the sidebar — it uses --surface-shallow against the
  body's --surface-overlay so the color change is the separator.
- The divider above the page body (between breadcrumb bar and body)
  is rendered here via border-t on the body scroll container, and
  only when a breadcrumbBar is present.

Slots:
- `titleBar` (optional) — a <TitleBar/>. Omit for chromeless/vista pages.
- `sidebar` — a <NavSidebar/>. Required.
- `breadcrumbBar` (optional) — a <BreadcrumbBar/> rendered above the body.
- `sidebarWidth` (optional, default "240") — "240" for Figma Desktop App
  frames, "256" for DevRev vista/production parity.
- `children` — page body content (typically a <PageBody/> or a vista body).


```ts
type AppShellProps = {
  titleBar?: ReactNode;
  sidebar: ReactNode;
  breadcrumbBar?: ReactNode;
  sidebarWidth?: "240" | "256";
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT add your own `border-r` between sidebar and body. The color change (`--surface-shallow` vs `--surface-overlay`) is the separator.
- Do NOT add a divider between `titleBar` and `breadcrumbBar`. There isn't one in the spec; the breadcrumb bar sits flush under the title bar.
- For a vista list-view frame, don't compose `AppShell` directly — use the `VistaPage` template. It wires sidebar width, chromelessness, and the toolbar band for you.

**Tokens commonly needed inside this composite's user slot:**

Canvas tokens most likely to be referenced inside `children`:

| Intent                      | Token                           |
|---|---|
| Body surface                | `--surface-overlay` (already applied by AppShell) |
| Sidebar surface             | `--surface-shallow` (already applied via NavSidebar) |
| Window backdrop             | `--surface-backdrop`            |
| Divider / border            | `--stroke-neutral-subtle`       |

## BreadcrumbBar (composite)
_source: `composites/BreadcrumbBar.tsx`_

BreadcrumbBar — DevRev breadcrumb row composite.

Matches Figma "Page Header / Breadcrumb Bar" (the 44px row directly below
the title bar that contains the current-location breadcrumb and any page-
level action cluster).

Figma layout:
  [ Breadcrumb (left, truncates) ][ flex ][ actions cluster (right) ]

Intentional opinions:
- No back/forward arrows here. Those live in the TitleBar's trailing
  cluster in the Figma design.
- No border. The divider BETWEEN this row and the page body is rendered
  by `AppShell` (via its body border-top). There is also NO divider
  between the TitleBar and this row — TitleBar owns the divider above
  this row (its `border-b`).

Slots:
- `breadcrumb` — a <Breadcrumb.Root> from arcade.
- `actions` (optional) — page-level actions (e.g. a "More" IconButton,
  or a primary "Save" Button).


```ts
type BreadcrumbBarProps = {
  breadcrumb: ReactNode;
  actions?: ReactNode;
}
```

## CanvasPanel (composite)
_source: `composites/CanvasPanel.tsx`_

CanvasPanel — right-hand side panel for Computer / Agent Studio that
surfaces artefacts of the current conversation: files created by the
agent, local sources on the user's machine, connected external sources.

Matches Figma node 152:5752 in the "Untitled" prototype file. Shape:

  ┌────────────────────────────────┐
  │ (◐) 2 of 4 steps               │  ← step header (progress + title)
  │ Gather recents projects and    │
  │ forming an agenda              │
  │                                │
  │ Created in this topic          │  ← group
  │ 📄 New file.ext              ● │
  │ 📄 Project plan.docx         ● │
  │ 📄 Budget overview.xlsx        │
  │                                │
  │ On John's Macbook          +   │  ← group with trailing action
  │ 📁 Folder 1                    │
  │ 📁 Folder 2                    │
  │                                │
  │ Sources (3)                    │
  │ N  Notion                 [12] │  ← count badge
  │ G  Gmail                  [20] │
  │ +  Connect                     │
  └────────────────────────────────┘

Intentional opinions:
- Fixed width (wider than a nav sidebar — ~272px). Scrolls vertically
  when the content overflows the viewport.
- Lives as a sibling of the main chat column; does NOT own window chrome
  (the ComputerSidebar on the left handles that).
- Groups are simple title + items. Titles are uppercase-less, muted
  ("Created in this topic", "Sources (3)"). Optional trailing `+` per
  group title for add-affordance.
- Items render leading icon (16×16) + label + optional trailing slot
  (status dot, count badge, action icon).

Slots:
- `step` (optional) — the top step block. Pass <CanvasPanel.Step /> with
  `current`, `total`, and `title`. When omitted, no step header renders.
- `children` — <CanvasPanel.Group /> tree. Each group has a `title`,
  optional `trailing`, and <CanvasPanel.Item /> children.

Compound:
- `CanvasPanel.Step` — the progress + title block at the top.
- `CanvasPanel.Group` — group title + optional trailing + children.
- `CanvasPanel.Item` — a single row (leading + label + trailing).
- `CanvasPanel.FileIcon` / `CanvasPanel.FolderIcon` / `CanvasPanel.StatusDot`
  / `CanvasPanel.CountBadge` — leaf helpers for common item pieces so
  callers don't need to inline their own SVGs or pill shapes.

**Compound:** `CanvasPanel.Step`, `CanvasPanel.Group`, `CanvasPanel.GroupAddButton`, `CanvasPanel.Item`, `CanvasPanel.FileIcon`, `CanvasPanel.FolderIcon`, `CanvasPanel.StatusDot`, `CanvasPanel.CountBadge`

## CapabilitySection (composite)
_source: `composites/CapabilitySection.tsx`_

CapabilitySection — a titled capability group on the agent builder page.

Matches the Figma "Capabilities" sections on the Agent creation page
(AS-Deploy, node 7546:37777): each capability (Knowledge, Skills/Tools/
Workflows, Guardrails) is a group with a leading icon, a title, a one-line
description, a trailing "+ Add" action, and a stack of added-item rows below.

  ◇  Knowledge                                        + Add
     Add sources your agent can reference.
  ┌──────────────────────────────────────────────┐
  │  Knowledge Base                                 │  ← rows (children)
  │  Knowledge Base                                 │
  └──────────────────────────────────────────────┘

Intentional opinions:
- The header row is `icon + (title over description)` on the left and the
  `action` slot (typically a tertiary "+ Add" Button) on the right.
- `children` are the added rows, stacked at 8px. When empty, nothing renders
  below the header (the empty state is just the header + Add).
- This is a section *within* an agent builder body — it does not own page
  chrome. Stack several inside a centered column (see BuilderPage usage).

Slots:
- `icon` — leading capability icon (arcade icon element).
- `title` — capability name.
- `description` — one-line explanation.
- `action` — trailing action (e.g. `<Button variant="tertiary">+ Add</Button>`).
- `children` — added-item rows (optional).


```ts
type CapabilitySectionProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT hardcode a "+ Add" button with your own styling. Pass
  the arcade `<Button variant="tertiary">` as `action`.
- Do NOT wrap the whole section in a card border — sections are
  separated by spacing in the builder column, not boxed (the rows may be
  boxed by the caller, the section is not).

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Title text | `--fg-neutral-prominent` |
| Description text | `--fg-neutral-subtle` |
| Icon | `--fg-neutral-medium` |

## CardGrid (composite)
_source: `composites/CardGrid.tsx`_

CardGrid — responsive multi-column grid of EntityCards.

Matches the Figma "Connectors" / Skills card grid: a 2-column grid of
EntityCards with an 8px gutter (Figma GRID container, ~662px content width =
two 327px cards + gap).

  ┌─────────────┐  ┌─────────────┐
  │  Gmail      │  │  Outlook     │
  └─────────────┘  └─────────────┘
  ┌─────────────┐  ┌─────────────┐
  │  Salesforce │  │  HubSpot     │
  └─────────────┘  └─────────────┘

Intentional opinions:
- Default 2 columns (the DevRev settings/connectors default). `columns={1}`
  for a single-column list; `columns={3}` for a dense gallery (Skills "From
  your org" uses 3). No other values — a different shape is a different grid.
- 8px gutter, matching the Figma grid gap. Cards stretch to fill their cell.

Slots:
- `children` — EntityCard instances (or any cards).
- `columns` — 1 | 2 | 3 (default 2).


```ts
type CardGridProps = {
  columns?: 1 | 2 | 3;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT set your own `grid-cols-*` or `gap-*` on a wrapper —
  pass `columns` instead. The gutter is fixed to the Figma value.
- Do NOT put section titles inside the grid. Render the title
  above the grid (the grid is cards only).

## ChatEmptyState (composite)
_source: `composites/ChatEmptyState.tsx`_

ChatEmptyState — centered "computer" wordmark for an empty conversation.

Matches Figma "Empty state" (node 161:9293 in the "Untitled" prototype
file). When the main chat body has no messages yet, this composite
renders the faded Computer wordmark centered in the available space.

Render as the only child of the flex-1 chat body:

  <div className="flex-1 min-h-0 overflow-y-auto">
    <ChatEmptyState />
  </div>

No slots — it is purely visual. If callers want a different watermark
or message, they should write their own block.


## ChatInput (composite)
_source: `composites/ChatInput.tsx`_

ChatInput — Computer / Agent Studio chat input composite.

Matches Figma "Computer Input Field" (component set 153:8373 in the
"Untitled" prototype file). A full-width command bar flush with the
bottom of the chat body: no shadow, no rounded corners, just a top
border separating it from the conversation above.

  ┌──────────────────────────────────────────────────────────────┐
  │ [Context chip] [File ✓] [File 40%] ...         ← attachments │
  │ [Logo] Ask me anything             [+]   [↑/■] ← input row   │
  └──────────────────────────────────────────────────────────────┘

Intentional opinions:
- The bar spans the full chat-column width and hugs the bottom (no
  fixed width pill, no drop shadow, no rounded corners). The caller
  should NOT wrap it in extra padding — render it as a direct child
  of the chat column, below the scrolling body.
- Attachments sit above the input row when present and horizontally
  scroll if they overflow.
- Leading defaults to the arcade `Computer` logomark (the product mark
  shown on the left of the input pill in Figma). Pass `leading` to
  override with a different product logo or custom mark.
- Trailing is a slot — the caller decides which buttons to render
  (add + send, or add + stop when streaming, or just +, etc.).
  Three helpers are provided: ChatInput.AddAttachmentButton,
  ChatInput.SendButton, ChatInput.StopButton.

Slots:
- `attachments` (optional) — a row of <ChatInput.ContextAttachment /> or
  <ChatInput.FileAttachment />. Hidden when not provided.
- `leading` (optional) — icon/mark on the far left. Defaults to the
  arcade `<Computer />` logomark.
- `trailing` (optional) — action buttons on the far right. Typically one
  or two of the helpers below. When not provided, no trailing buttons
  are rendered.
- `placeholder` (optional) — input placeholder, default "Ask me anything".
- `value`, `onChange` (optional) — controlled input. Uncontrolled if omitted.
- `inputRef` (optional) — forward to the underlying <input>.

Compound:
- `ChatInput.ContextAttachment` — dashed-border chip for external-service
  contexts (Notion tab, URL, etc.). Props: icon, title, subtitle.
- `ChatInput.FileAttachment` — solid-border card for a file. Props: kind
  (e.g. "PDF"), name, progress (number 0-100 → renders Uploading overlay;
  omit → Indexed state).
- `ChatInput.AddAttachmentButton` — the "+" icon button.
- `ChatInput.SendButton` — filled accent circle with an up-arrow.
- `ChatInput.StopButton` — secondary circle with a stop square.

**Compound:** `ChatInput.ContextAttachment`, `ChatInput.FileAttachment`, `ChatInput.AddAttachmentButton`, `ChatInput.SendButton`, `ChatInput.StopButton`, `ChatInput.ComputerLogo`

## ChatMessages (composite)
_source: `composites/ChatMessages.tsx`_

ChatMessages — conversation transcript composite for Computer / Agent Studio.

Matches Figma "chat" (node 161:9716 in the "Untitled" prototype file).
The transcript contains two kinds of blocks:

  - Sender / receiver bubbles — use the arcade `<ChatBubble variant="sender" />`
    / `<ChatBubble variant="receiver" />` component directly.
  - `ChatMessages.Agent` — agent's turn: a pause/running icon, an optional
    expandable "Thoughts" block, and body text below.

Real message bodies (DevRev timeline entries, API responses) are markdown.
Wrap them in `<Markdown>` so `**bold**` / `` `code` `` / `> quotes` render
as rich text instead of literal characters:
  <ChatBubble variant="receiver"><Markdown>{msg.body}</Markdown></ChatBubble>
Hand-written copy can stay plain text.

The thoughts block (collapsed + expanded) follows Figma `_Thoughts`
component set 6064:65430 — a rounded pill + small detached circle
drawn as a thought-cloud. Geometry taken verbatim from the Figma SVG
export.

Usage:

  <ChatMessages>
    <ChatBubble variant="sender">Help me create a presentation…</ChatBubble>
    <ChatBubble variant="receiver">Sure — what's the topic?</ChatBubble>
    <ChatMessages.Agent
      thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}
    >
      I've drafted a slide outline based on our conversation…
    </ChatMessages.Agent>
    <ChatMessages.Agent
      thoughts={
        <ChatMessages.Thoughts label="Working" expanded>
          <ChatMessages.ThoughtItem subtitle="design.md">
            Searching for files
          </ChatMessages.ThoughtItem>
        </ChatMessages.Thoughts>
      }
    >
      Working on it now…
    </ChatMessages.Agent>
  </ChatMessages>

**Compound:** `ChatMessages.Agent`, `ChatMessages.Thoughts`, `ChatMessages.ThoughtItem`, `ChatMessages.Actions`, `ChatMessages.Sender`

## ComputerHeader (composite)
_source: `composites/ComputerHeader.tsx`_

ComputerHeader — top bar for a Computer / Agent Studio chat screen.

Matches Figma node 152:5697 in the "Untitled" prototype file. Thin 48px
bar that sits directly above the chat body (no border — just the blank
surface behind it). Shape:

  ┌─────────────────────────────────────────────────────────────┐
  │ [💬] Prepare marketting presentations  ⌄     [👤+]  [📑]   │
  └─────────────────────────────────────────────────────────────┘

Intentional opinions:
- Left: a ChatBubbles icon + conversation title + chevron, rendered as a
  single borderless pill that looks like a dropdown affordance for
  switching/renaming the conversation.
- Right: a trailing action cluster (add collaborator, open canvas, etc.).
  Slot — caller decides what goes there.
- There is NO border below the header. The ChatInput / chat body sits
  directly beneath it against the same surface.

Slots:
- `title` — the conversation title text (required).
- `icon` (optional) — leading icon next to the title. Defaults to the
  arcade `<ChatBubbles />` mark.
- `onTitleClick` (optional) — called when the title pill is clicked.
  Typically opens a rename/switch menu.
- `actions` (optional) — the trailing action cluster. Typically one or
  two `<IconButton />` components. When omitted, no trailing cluster
  renders.


```ts
type ComputerHeaderProps = {
  title: ReactNode;
  /** Leading icon for the title pill. Pass to add one — by default the title
   *  renders without any icon, matching the colleague Computer prototype. */
  icon?: ReactNode;
  onTitleClick?: () => void;
  actions?: ReactNode;
  /**
   * Right-most action: the canvas / artefacts panel toggle. **Defaults to a
   *  built-in `DotInRightWindow` IconButton** so every Computer screen carries
   *  the canvas opener without the caller having to remember it. Pass `null`
   *  to suppress; pass your own IconButton to override (e.g. to wire it to
   *  your own panel state). Rendered AFTER the `actions` slot.
   */
  panelToggle?: ReactNode;
  /**
   * Conversation menu rendered when the chevron is clicked. **Defaults to a
   * Rename / Inspect Session / Delete menu** — pass `null` to suppress, pass a
   * custom `<Menu.Content />` body (or `<>` of `<Menu.Item>`s) to override.
   */
  conversationMenu?: ReactNode;
  /** Handlers for the default conversation menu items. */
  onRename?: () => void;
  onInspect?: () => void;
  onDelete?: () => void;
  /**
   * Optional secondary row rendered below the title pill — typically a row of
   * meta chips ("# Q3 Strategy", "Today", "1 related"). Caller renders the
   * chips; the header just provides the row.
   */
  meta?: ReactNode;
}
```

## ComputerScene (composite)
_source: `composites/ComputerScene.tsx`_

ComputerScene — populated, interactive Computer / Agent Studio chat screen.

The "batteries-included" sibling of `ComputerPage`. While `ComputerPage`
is a slot graph (caller fills sidebar + header + chatInput + body),
`ComputerScene` is a *complete*, working scene: a sessions list (clickable,
swaps the active session and the header title), a chats list, a transcript
the user can extend by typing into the command bar, an optional artefacts
panel, and a user footer.

  <ComputerScene />                 // full populated, interactive scene
  <ComputerScene state="empty" />   // wordmark empty state
  <ComputerScene withCanvasPanel /> // mounts the right-hand artefacts panel

Why this exists:
- Designers prompting "make a Computer chat screen" want the WHOLE
  prototype on the first turn — sessions populated, chats populated,
  header populated, transcript populated, AND clickable / typeable. Not
  an empty `<ComputerPage />` skeleton.
- The agent reaches for `<ComputerScene />` and cannot under-populate the
  kit by accident. Overrides are limited to values designers most often
  tweak (state, header title, canvas panel, user identity, sessions).

Interactivity (built-in, no caller wiring required):
- Clicking a session in the sidebar swaps the active session and the
  header title to that session's `topic`.
- Typing into the bottom command bar and pressing Enter appends a user
  bubble; an agent reply follows ~700ms later (deterministic placeholder
  text). Shift+Enter inserts a newline.
- Toggling the right-hand artefacts panel via header — when
  `withCanvasPanel` is left at default, the header carries a toggle button.


```ts
type ComputerSceneProps = {
  /**
   * Body content state. Default `"transcript"` (a settled multi-turn
   * conversation the user can extend by typing). `"empty"` shows the
   * centered Computer wordmark; `"streaming"` ends the seed with a
   * working-thoughts agent turn.
   */
  state?: "empty" | "streaming" | "transcript";
  /**
   * Mount the right-hand artefacts panel. When `undefined` (default), the
   * header carries a toggle and the panel can be opened/closed at runtime.
   * Pass `true`/`false` to fix it open or closed.
   */
  withCanvasPanel?: boolean;
  /**
   * Conversation title in the ComputerHeader. When omitted, derived from
   * the active session.
   */
  headerTitle?: React.ReactNode;
  /** Sidebar user-footer overrides. */
  userName?: React.ReactNode;
  userSubtitle?: React.ReactNode;
  userAvatarSrc?: string;
  /** Active session id. Default `"strategic"`. */
  activeSessionId?: string;
  /** Override the default sessions roster. */
  sessions?: Session[];
  /** Placeholder for the bottom command bar. */
  chatInputPlaceholder?: string;
}
```

**When NOT to use this:**
- Do NOT wrap `<ComputerScene />` in a `<ComputerPage>`. ComputerScene already IS a full Computer page (it composes ComputerPage internally). Wrapping it doubles the chrome.
- Do NOT use ComputerScene when the designer asks for a *custom* sidebar / header / transcript shape. Use `ComputerPage` (the slot graph) for that. Reach for ComputerScene only when the prompt is generic ("a Computer chat screen", "Agent Studio screen") and the designer wants the canonical kit layout.
- Do NOT pass children to `<ComputerScene>{...}</ComputerScene>` — it accepts none. The body is selected by the `state` prop.

**Tokens commonly needed inside this composite's user slot:**

| Intent                        | Token                              |
 |---|---|
 | Window backdrop               | `--surface-backdrop` (applied by ComputerPage) |
 | Sidebar surface               | `--surface-shallow` (applied by ComputerSidebar) |
 | Body surface                  | `--surface-overlay` (applied by ComputerPage) |
 | Active sidebar item           | `--control-bg-neutral-subtle-active` |
 | Sidebar item hover            | `--control-bg-neutral-subtle-hover` |
 | Section label / muted text    | `--fg-neutral-subtle`              |
 | Primary text                  | `--fg-neutral-prominent`           |
 | Divider above ChatInput       | `--stroke-neutral-subtle`          |

## ComputerSidebar (composite)
_source: `composites/ComputerSidebar.tsx`_

ComputerSidebar — chat-app sidebar composite for "Computer" / Agent Studio.

Matches Figma "_Sidebar" in the "C - May Release" file
(node 7253:101676). This is DIFFERENT from `NavSidebar`:

- `NavSidebar` is for the DevRev SoR desktop app (lives below a shared
  TitleBar; workspace dropdown header; Computer footer).
- `ComputerSidebar` is for the Computer chat interface. It owns its own
  window chrome (traffic lights + collapse + nav arrows), then a primary
  action row ("New Chat" + history), then chat groups with items, then a
  user footer (avatar + name + subtitle + bell).

Because it owns window chrome, pages using `ComputerSidebar` typically do
NOT use `TitleBar` on top — the sidebar IS the title bar on the left, and
the main canvas has no top chrome.

Slots:
- `workspace` (optional) — when provided, renders a brand pill (mark +
  label + chevron) below the chrome. Computer sidebars typically omit
  this (chrome goes straight into the action row). NavSidebar uses a
  separate BrandHeader for the DevRev SoR app — don't confuse the two.
- `primaryAction` (optional) — primary CTA pill on the left of the actions
  row. **Defaults to a "New Chat" button** when the prop is omitted.
  Pass `null` to suppress; pass your own button to override.
- `historyAction` (optional) — icon button to the right of the primary
  action. **Defaults to a history clock IconButton** when omitted.
  Pass `null` to suppress; pass your own IconButton to override.
- `showWindowChrome` (optional, default true) — set to false if your page
  renders its own TitleBar above the sidebar.
- `agentStudioLink` (optional) — renders an "Agent Studio" link row directly
  above the user footer. **Defaults to a built-in link** when omitted.
  Pass `null` to suppress; pass a custom node to override.
- `user` (optional) — the user footer block. Pass a <ComputerSidebar.User />.
  When omitted, the footer is not rendered.
- `footerAction` (optional) — icon button on the right of the user footer
  (typically a <Bell /> notifications icon).
- `children` — ComputerSidebar.Group / ComputerSidebar.Item tree.

Usage tips:
- Chat items should use the arcade `<Avatar name="..." src="..." size="sm" />`
  component for leading content — never a raw string letter placeholder.

**Compound:** `ComputerSidebar.Group`, `ComputerSidebar.Item`, `ComputerSidebar.User`, `ComputerSidebar.Banner`

## DetailModal (composite)
_source: `composites/DetailModal.tsx`_

DetailModal — entity detail dialog with a hero banner and a primary action.

Matches the Figma Skill detail modal (C-Skills, node 6685:88323): a 720px
dialog whose top is a full-bleed hero banner (image/illustration) with the
close button overlaid, followed by a body of title + byline, a primary
action button, a divider, and a details section.

  ┌──────────────────────────────────────────────┐
  │                                            ✕   │
  │            ░░ hero banner ░░                    │  ← hero (full-bleed)
  ├──────────────────────────────────────────────┤
  │  List outstanding items                        │  ← title
  │  Extracts all open action items…               │  ← byline
  │  [ + Add to Computer ]                          │  ← primary action
  │  ──────────────────────────────────────────    │  ← divider
  │  Instructions                                   │  ← details section
  │  You are a professional copywriter…            │
  └──────────────────────────────────────────────┘

Intentional opinions:
- Wraps the production `Modal` at `size="md"` (720px). The hero is rendered
  ABOVE `Modal.Header`'s usual title slot — title lives in the body so it can
  sit under the hero, matching Figma.
- The hero is full-bleed (no body padding) and clips to the modal's top
  corners. Pass an `<img>`, gradient div, or illustration as `hero`.
- `action` is a single primary button slot (e.g. "+ Add to Computer"). Pass
  the arcade `<Button>` directly so the caller controls label/icon/onClick.
- The body sections are separated by a `Separator`; `children` is the detail
  content (e.g. an "Instructions" block).

Slots:
- `hero` — full-bleed banner node (image/gradient/illustration).
- `title` / `byline` — entity name + supporting line.
- `action` — primary button node.
- `children` — details section below the divider.


```ts
type DetailModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hero?: ReactNode;
  title: ReactNode;
  byline?: ReactNode;
  /** Author/source row under the byline — typically a small logo + name
   *  (e.g. the DevRev mark + "DevRev"). Matches the Figma author line. */
  author?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT pad or border the `hero` — it is full-bleed and
  corner-clipped by the composite.
- Do NOT pass `title` to `Modal.Header`. This composite renders
  the title in the body, under the hero (Figma layout).
- Do NOT add your own close button over the hero — the modal's
  `Modal.Close` is rendered for you, overlaid top-right.

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Title text | `--fg-neutral-prominent` |
| Byline text | `--fg-neutral-subtle` |
| Hero fallback bg | `--surface-shallow` |

## EntityCard (composite)
_source: `composites/EntityCard.tsx`_

EntityCard — a single selectable/listed entity row-card.

Matches the Figma "Cards" instance used across Connectors, Skills, and
Agent capability grids: a 72px-tall bordered card with a leading brand/icon
slot, a title (+ optional description), and an optional trailing status Tag
or action.

  ┌──────────────────────────────────────────────┐
  │  [icon]  Gmail                    Connected    │   ← single-line (Connectors)
  └──────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────┐
  │  [icon]  Prospect Research                     │   ← two-line (Skills)
  │          Pulls a company brief before any…     │
  └──────────────────────────────────────────────┘

Intentional opinions:
- Bordered, radius `rounded-square` (Figma card radius ≈ 8.5px), 16px padding,
  12px gap between the icon slot and the text — the Figma "Cards" geometry.
- The leading `icon` renders in a fixed 40px slot. Pass a brand favicon
  (`<img>`) or an arcade icon element.
- `status` renders a trailing arcade `Tag` — pass the node directly
  (e.g. `<Tag intent="success">Connected</Tag>`). For a clickable card use
  `trailing` for a button/chevron instead.
- `description` is optional; when present the card grows to fit two lines and
  the text column stacks title over description.

Slots:
- `icon` — leading brand/icon element (40px slot).
- `title` — entity name.
- `description` — optional supporting line (truncated to 2 lines).
- `status` / `trailing` — optional trailing node (Tag, button, chevron).


```ts
type EntityCardProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  trailing?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT add your own `border`/`rounded`/`p-4` — the card is a
  bordered, padded, rounded container already.
- Do NOT hardcode a green pill for "Connected". Use the arcade
  `<Tag intent="success">` as the `status` node.
- Do NOT wrap many EntityCards in your own flex/grid — use the
  `CardGrid` composite, which owns the 2-column layout and gutters.

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Card surface | `--surface-overlay` |
| Card border | `--stroke-neutral-subtle` |
| Title text | `--fg-neutral-prominent` |
| Description text | `--fg-neutral-subtle` |

## FormField (composite)
_source: `composites/FormField.tsx`_

FormField — labelled form control wrapper with required marker.

Matches the Figma "Text Field" label row, which renders the field label
followed by a red required asterisk (e.g. "Server name*"). The production
arcade `Input`/`TextArea` render their own label but do NOT render the
required `*`, so this wrapper owns the label row and the control is passed
label-less as `children`.

  Server name *           ← label + red asterisk (this composite)
  [ My great MCP        ] ← children (arcade Input/TextArea/Select, no label prop)

Intentional opinions:
- Label uses the exact arcade input label style
  (`text-system-small-medium`, `--component-input-fg-label`) so a FormField
  label is indistinguishable from a native arcade `Input label=…`.
- The required `*` uses `--fg-alert-prominent` and a leading space, matching
  Figma's "Placeholder*" label glyph.
- 6px gap between label and control (Figma label→content spacing).

Slots:
- `label` — field label text.
- `required` — when true, appends a red `*`.
- `children` — the control. Pass arcade controls WITHOUT their own `label`
  prop (this wrapper renders the label).


```ts
type FormFieldProps = {
  label: string;
  required?: boolean;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT also set `label=` on the arcade `Input` inside — you'll
  get two labels. The control passed as `children` must be label-less.
- Do NOT hardcode a red hex for the asterisk. Use this wrapper;
  it applies `--fg-alert-prominent`.

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Label text | `--component-input-fg-label` |
| Required asterisk | `--fg-alert-prominent` |

## FormModal (composite)
_source: `composites/FormModal.tsx`_

FormModal — DevRev "create / configure" dialog composite.

Matches the Figma "Modal Content" used across Connectors (Create custom MCP),
Settings, and Agent Studio: a centered 720px dialog with an icon-chip header,
a title + supporting subtitle, a vertical stack of form fields, and a
right-aligned footer with a Cancel + a primary submit button.

  ┌─────────────────────────────────────────────────────────┐
  │  ◇  Create custom MCP                                 ✕   │  ← header
  │     Point Computer to your own MCP server to make…       │     (icon chip + title + subtitle)
  ├─────────────────────────────────────────────────────────┤
  │   [ Server name*            ]                            │  ← body
  │   [ Server URL*             ]                            │     (field children, 24px gap)
  │   [ Server description      ]                            │
  ├─────────────────────────────────────────────────────────┤
  │                                    Cancel    [ Next ]    │  ← footer (right-aligned)
  └─────────────────────────────────────────────────────────┘

Intentional opinions:
- Wraps the production `Modal` compound (Root/Content/Header/Body/Footer) —
  never re-implements the overlay, shadow, blur, or animation. `size="md"`
  is the DevRev default (720px) and matches Figma exactly.
- The optional `icon` renders in a rounded chip to the left of the title,
  matching the "Icon" 45px chip in Figma. Pass an arcade icon element.
- Footer buttons are right-aligned. `submitLabel` is a primary button;
  Cancel is tertiary. Submit fires `onSubmit`; Cancel/✕/overlay fire
  `onOpenChange(false)`.
- Body children are the caller's form fields (arcade `<Input>`, `<TextArea>`,
  `<Select>` — each already renders its own label/required/helper). They are
  stacked vertically at 24px gap, the Figma "Content" gap.

Slots:
- `title` — dialog heading (string or node).
- `subtitle` — supporting line under the title (optional).
- `icon` — leading icon element for the header chip (optional).
- `children` — form fields, stacked at 24px gap.
- `submitLabel` / `cancelLabel` — footer button text.


```ts
type FormModalProps = {
  /** Controlled open state. */
  open?: boolean;
  /** Fired when the dialog requests to close (✕, Cancel, overlay, Esc). */
  onOpenChange?: (open: boolean) => void;
  /** Dialog heading. */
  title: ReactNode;
  /** Supporting line under the title. */
  subtitle?: ReactNode;
  /** Leading icon element rendered in the header chip. */
  icon?: ReactNode;
  /** Form fields — stacked vertically at 24px gap. */
  children: ReactNode;
  /** Primary footer button label. */
  submitLabel?: string;
  /** Secondary footer button label. */
  cancelLabel?: string;
  /** Fired when the primary button is clicked. */
  onSubmit?: () => void;
}
```

**When NOT to use this:**
- Do NOT wrap children in your own `<form>` with custom gap or
  padding — the composite owns the 24px field stack and the body padding.
- Do NOT re-create a Cancel/submit row inside `children`. Use
  the `onSubmit` + `submitLabel` props; the footer is built for you.
- Do NOT pass `text-title-*` classes to `title`/`subtitle`.
  The composite renders the title at the modal's body-large-bold and the
  subtitle at the modal description token.
- Do NOT hardcode the 720px width or the shadow — that lives in
  `Modal.Content size="md"`. Changing size is a different composite.

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Header icon chip bg | `--surface-shallow` |
| Subtitle text | `--component-modal-desc-fg` (via Modal.Description) |
| Body field gap | 24px (Figma "Content" itemSpacing) |

## FrameLink (composite)
_source: `composites/FrameLink.tsx`_

FrameLink — wraps an element and makes clicking (or keyboard-activating)
it navigate to another frame in the same multi-frame prototype.

The wrapper renders `display: contents`, so the wrapped element's own
layout is preserved. `role="button"` + `tabIndex={0}` give keyboard users
the same affordance as mouse users; Enter and Space trigger navigation.
Styled only with `cursor: pointer` — no visible "this is a link"
affordance. The "click → navigate" relationship is invisible by design.

When clicked, the wrapper posts
`{ type: "arcade-studio:navigate", target: "<frame-slug>", source: "<current-frame-slug>" }`
to the parent window. The studio viewport handles the scroll + highlight.

Why this composite exists: multi-frame prototypes (0.13+) render frames
side-by-side but with no inter-frame interactivity. `FrameLink` lets the
agent wire a prompt's explicit transitions ("click X, see Y") without
reinventing navigation in every frame.


```ts
interface FrameLinkProps {
  /** Target frame slug (e.g. "02-skill-modal"). Must exist in the project. */
  target: string;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT wrap an element unless the prompt explicitly names
  it as a transition trigger. Navigation is a specific choice the designer
  made, not a general property of multi-frame prototypes. If the prompt is
  silent about what triggers transitions, list "no navigation wired — prompt
  didn't specify triggers" in your Deviations section and ship without.
- Do NOT wrap entire regions
  (`<FrameLink target="02"><div className="container">…</div></FrameLink>`).
  Wrap the clickable element only — the specific card, button, or control
  the prompt names. Wrapping containers makes every pixel inside them
  trigger navigation.
- Do NOT use `<FrameLink>` instead of a regular `<Button>`
  for in-frame interactions (opening a dropdown, toggling a switch, showing
  a tooltip). Those are intra-frame; they don't need navigation.

## Markdown (composite)
_source: `composites/Markdown.tsx`_

Markdown — renders a markdown string as formatted rich text, for chat
message bodies and any other place a prototype shows real (markdown)
content rather than hand-written copy.

Why this exists:
- Computer / Agent Studio chat bodies (and most real DevRev timeline
  text) are markdown: `**bold**`, `` `code` ``, `> quotes`, numbered
  lists. Dropping that string straight into a `<ChatBubble>` renders the
  literal asterisks and backticks — it does not look like real Computer.
  Wrap the body in `<Markdown>` so it renders the way Computer does.

Color-inheriting by design: every element uses `color: inherit` (no
hard-coded foreground token), so the same `<Markdown>` looks right inside
a dark sender bubble (light text) AND a light receiver / agent bubble
(dark text). Inline code and blockquotes use `currentColor` at low
opacity for the same reason — they adapt to whichever bubble holds them.

Raw HTML in the source is NOT rendered (no `rehype-raw`) — markdown text
from a live API is treated as untrusted, so only markdown syntax is
interpreted.

Usage:

  <ChatBubble variant="sender">
    <Markdown>{message.body}</Markdown>
  </ChatBubble>

  <ChatMessages.Agent thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}>
    <Markdown>{message.body}</Markdown>
  </ChatMessages.Agent>


```ts
type MarkdownProps = {
  /** The markdown source string to render. */
  children?: string | null;
}
```

## NavSidebar (composite)
_source: `composites/NavSidebar.tsx`_

NavSidebar — DevRev navigation sidebar composite.

Matches Figma "Option_2_Interim_reduced(June)" (node 10:3508) — the current
DevRev SoR left nav. Replaces the bare `arcade.Sidebar` for prototype use.
Lives BELOW the window chrome in AppShell, so it owns its own top toolbar
(collapse / ⌘K search / add) but NOT the mac traffic lights.

Default chrome (rendered top→bottom):
- Toolbar (top): collapse IconButton + ⌘K search field + "add" IconButton.
- Computer pill: a full-width muted rounded button with the "computer"
  wordmark — the product switcher.
- Nav body (scrollable): NavSidebar.Section + NavSidebar.Item children.
- User footer (bottom): avatar + status dot + a chat FAB.

Intentional opinions:
- Surface is --surface-shallow so the sidebar reads as a muted panel.
- Group labels (Work / Teams / Views) render as small, 60%-opacity chips
  (text-system-small), matching the Figma "_Group Label".
- Items are 28px rows, padded px-4, label in --text-interactive-navigation-
  resting; the active/hover state is a subtle neutral wash (NOT a blue pill).
- Items support a leading icon, a trailing slot (count Tag, or a chevron for
  expandable groups), and `indent` for nested rows.

Slots (all optional — sensible defaults render the full Figma design):
- `workspace` — accepted for back-compat but IGNORED. The pill is the
  "computer" product switcher and always shows the computer wordmark; it is
  not a workspace-name label. (Pass a custom `pill` to change the switcher.)
- `toolbar` — replace the default top toolbar. Pass `false` to hide it.
- `pill` — replace the default computer pill. Pass `false` to hide it.
- `header` — legacy: a custom node ABOVE the toolbar (e.g.
  `<NavSidebar.BackHeader>` for the Settings "← Title" chrome). When set,
  the default toolbar + pill are suppressed (the Settings chrome owns the top).
- `footer` — replace the default user footer. Pass `false` to hide it.
  `<NavSidebar.AppFooter>` is still available for the "Agent Studio" chrome.
- `children` — NavSidebar.Section / NavSidebar.Item tree.

**Compound:** `NavSidebar.Section`, `NavSidebar.Item`, `NavSidebar.Toolbar`, `NavSidebar.ComputerPill`, `NavSidebar.UserFooter`, `NavSidebar.ExpandChevron`, `NavSidebar.BackHeader`, `NavSidebar.AppFooter`

**When NOT to use this:**
- When Figma shows a chat-style sidebar (with "New Chat" and chat history), use `ComputerSidebar` instead. That composite owns its own window chrome; do NOT also render a `TitleBar` alongside it.
- Never use `arcade.Sidebar` directly for the main app sidebar — it's the bare primitive. `NavSidebar` adds the toolbar, computer pill, user footer, and correct tokens.
- To hide a default slot, pass `false` (e.g. `toolbar={false}`), NOT an empty string. Composites check for `false` explicitly; other falsy values still render the default.

## PageBody (composite)
_source: `composites/PageBody.tsx`_

PageBody — DevRev centered page body composite.

Matches Figma "Page Body": a vertically scrolling column, centered in the
main content area, with a fixed max-width, and containing (optionally) a
hero title + subtitle followed by the body content.

Intentional opinions:
- Max-width 832px centered (DevRev settings / detail page convention).
  This is deliberately narrower than the viewport — a "floating" column on
  a large canvas, not a full-bleed layout.
- Hero title uses text-title-large (34px, Chip Display). Do not substitute
  text-title-1/2/3 — those are section-level, not page-level.
- Subtitle uses text-body with fg-neutral-subtle.
- Top and bottom padding is baked in; callers only provide content.

Slots:
- `title` (optional) — hero page title (string, or any node).
- `subtitle` (optional) — description under the title.
- `titleAction` (optional) — a CTA aligned to the right of the title row
  (e.g. "Add custom connector"). Matches the Figma page-header layout where
  the primary action sits inline with the heading, NOT in the breadcrumb bar.
- `children` — the page body sections (typically a stack of SettingsCards).


```ts
type PageBodyProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  titleAction?: ReactNode;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT invent `title` / `subtitle` when Figma doesn't show them. Omit the props — the hero block is suppressed automatically.
- If Figma shows a freeform center canvas (e.g. a chat empty state, a dashboard grid), do not wrap in `PageBody`. Use a plain `<div className="mx-auto max-w-…">` so you control the width and padding.
- Do NOT substitute `text-title-1/2/3` for the hero title. Those are section-level, not page-level. PageBody applies `text-title-large` intentionally.

**Tokens commonly needed inside this composite's user slot:**

When you author content inside the `children` slot, prefer these tokens:

| Intent                  | Token                              |
|---|---|
| Body text               | `--fg-neutral-prominent`           |
| Muted / secondary text  | `--fg-neutral-subtle`              |
| Subtle borders          | `--stroke-neutral-subtle`          |
| Card surface (rare — usually a SettingsCard) | `--surface-overlay`   |
| Inline code background  | `--bg-neutral-subtle`              |

## PickerModal (composite)
_source: `composites/PickerModal.tsx`_

PickerModal — tabbed picker dialog with a search field and a card grid body.

Matches the Figma "Agent Capabilities" modal (AS-MCP, node 9793:16889): a
large dialog whose header row carries a tab bar on the left and a search
field on the right, and whose body is a grid of selectable EntityCards that
swaps per active tab.

  ┌──────────────────────────────────────────────────────────┐
  │  Agent Capabilities                                    ✕   │
  │  Skills  Workflows  Tools  Connectors      [ 🔍 Search ]   │  ← tab bar + search
  ├──────────────────────────────────────────────────────────┤
  │  ┌────────┐ ┌────────┐ ┌────────┐                         │
  │  │ card   │ │ card   │ │ card   │   ← CardGrid per tab     │
  │  └────────┘ └────────┘ └────────┘                         │
  └──────────────────────────────────────────────────────────┘

Intentional opinions:
- Wraps the production `Modal` at `size="lg"` (the wide picker; Figma content
  ≈ 881px). Header holds the title; the tab+search row sits in the body top.
- Uses the production `Tabs` compound for the tab bar and a search `Input`
  with a leading magnifier — never a hand-rolled tab strip.
- `tabs` is an array of `{ value, label, content }`. The body renders the
  active tab's `content` (typically a `CardGrid` of `EntityCard`s).
- Search is presentational by default (the prototype rarely needs live
  filtering); pass `onSearch` to wire it.

Slots:
- `title` / `subtitle` — header text.
- `tabs` — `{ value, label, content }[]`. First tab is active by default.
- `searchPlaceholder` — search field placeholder.


```ts
type PickerModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  tabs: PickerTab[];
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  /** Optional filter control rendered between the tabs and the search field
   *  (e.g. an "All categories" Select). Matches the Figma header row. */
  filter?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT hand-roll the tab strip with styled divs. Pass `tabs`;
  the composite renders the production `Tabs`.
- Do NOT put a footer with Cancel/Save here unless the design
  has one — the capability picker commits on card click. Use `FormModal` for
  form dialogs with a footer.
- Do NOT set `size` — the picker is always the wide `lg` modal.

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Search field | arcade `Input` defaults |
| Tab bar | arcade `Tabs` defaults |

## SettingsCard (composite)
_source: `composites/SettingsCard.tsx`_

SettingsCard — DevRev settings group composite.

Matches Figma "Form / Section" (a bordered group of SettingsRows with an
optional section title ABOVE the border).

Intentional opinions:
- Section title is rendered OUTSIDE and ABOVE the bordered container,
  using text-title-3 (section-level heading). The border wraps only the
  row stack.
- Corner radius is rounded-square-x2 (12px, arcade "normal density" card).
- Stroke uses --stroke-neutral-subtle (never hardcoded).
- **Separators between rows are rendered automatically.** Callers just
  pass a flat list of <SettingsRow /> children — the composite interleaves
  <Separator /> between them. Explicit <Separator /> children are still
  respected (useful for section breaks), but you no longer need to add
  them between every row. This closes the most common generation bug
  where the agent forgot dividers between rows.

Slots:
- `title` — the section heading (string or node).
- `children` — SettingsRow instances (or any nodes). Separators are
  inserted automatically between each pair.


```ts
type SettingsCardProps = {
  title?: ReactNode;
  children: ReactNode;
}
```

**When NOT to use this:**
- Do NOT manually add `<Separator />` between rows. The composite interleaves them for you. Manual separators will cause doubled dividers.
- Do NOT wrap `title` in your own `<h2>` or apply `text-title-*` classes to it. Pass the string as-is; the composite renders it at `text-title-3`.
- Do NOT add your own `border` or `rounded-*` classes around the card — it's a bordered, rounded container already.

## SettingsRow (composite)
_source: `composites/SettingsRow.tsx`_

SettingsRow — DevRev settings row composite.

Matches Figma "Contained Row / 2 line desc + Button + Toggle".

Layout: label + description on the left, an optional right-slot action
cluster (typically a Link/Button and a Switch) on the right. All aligned
on the row's center axis.

Intentional opinions:
- Vertical padding is baked in (14px) — matches the Figma density exactly.
  Do not override via className; if a new density is needed, make a new
  composite.
- Label uses text-system-medium (14px weight 540), description uses
  text-system with --fg-neutral-subtle (secondary text).
- Action slot is right-aligned with gap-3.

Slots:
- `label` — primary row label.
- `description` — supporting copy under the label.
- `action` (optional) — button/link rendered before the toggle.
- `control` (optional) — typically a <Switch>.


```ts
type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  control?: ReactNode;
}
```

## SkillCard (composite)
_source: `composites/SkillCard.tsx`_

SkillCard — vertical capability/skill card for picker grids.

Matches the Figma "Cards" / "Skill Card" used inside the Agent Capabilities
picker (AS-MCP, node 9793:16889): a 271×172 vertical card with an icon chip
and a trailing action/status in the top row, a title + 2-line description in
the middle, and a status footer (dot + label) at the bottom.

  ┌───────────────────────────────┐
  │  ◇                        +    │  ← top row: icon chip + trailing action
  │                               │
  │  Notion                        │  ← title
  │  Your docs and wikis, finally  │  ← description (2 lines)
  │  findable.                     │
  │                               │
  │  ● Connected                   │  ← status footer (optional)
  └───────────────────────────────┘

Intentional opinions:
- Vertical layout, radius `rounded-square-x2` (8px), 15px padding, 16px gap —
  the Figma card geometry. Distinct from `EntityCard` (the horizontal row
  card used on settings/connectors list pages).
- The `icon` sits in a 40px rounded chip. `action` is a trailing top-right
  slot (e.g. a tertiary "+" IconButton, or a selection checkbox).
- `status` renders the bottom dot + label row (e.g. ● Connected). Omit when
  the card isn't a connection.
- Description clamps to 2 lines so cards stay equal height in the grid.

Slots:
- `icon` — leading icon element (40px chip).
- `action` — top-right trailing node (IconButton / checkbox).
- `title` / `description` — name + 2-line supporting text.
- `status` — bottom status node (e.g. `<CardStatus>Connected</CardStatus>`),
  or pass your own dot+label.


```ts
type SkillCardProps = {
  icon?: ReactNode;
  action?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT use this for a settings list row — that's `EntityCard`
  (horizontal). This is the vertical picker/gallery card.
- Do NOT put the title in the top row with the icon. Title sits
  in the middle block, below the icon row (Figma layout).

**Tokens commonly needed inside this composite's user slot:**

| Element | Token |
| Card surface | `--surface-overlay` |
| Card border | `--stroke-neutral-subtle` |
| Icon chip bg | `--surface-shallow` |
| Title | `--fg-neutral-prominent` |
| Description / status | `--fg-neutral-subtle` |

## TitleBar (composite)
_source: `composites/TitleBar.tsx`_

TitleBar — DevRev desktop window title bar composite.

Matches Figma "Desktop/TitleBar With Tabs" (full-width 52px row).

Figma layout:
  [ Window/Leading (240w, matches sidebar width) ][ Window/Trailing (remainder) ]

Leading cluster: traffic-light dots + collapse icon.
Trailing cluster: back/forward arrows + (optional tab strip) + trailing
actions (icons + avatar) on the far right.

A divider runs at the BOTTOM of this row (border-b). There is NO divider
between the title bar and the breadcrumb bar directly — the breadcrumb
bar is below this divider in the page area.

Intentional opinions:
- Height is fixed at 52px to match Figma.
- Traffic-light SVGs + collapse icon are inline because they are pure
  chrome and never vary.
- The divider position matches Figma exactly (below title bar, above body).

Slots:
- `leadingActions` (optional) — additional icons in the leading cluster
  (rare; Figma usually has just traffic lights + collapse).
- `nav` (optional) — back/forward arrows and any related nav controls.
  Defaults to a back+forward pair rendered inline. Pass `null` to hide
  the nav cluster entirely when Figma does not show back/forward arrows.
- `trailingActions` (optional) — icons + avatar cluster on the far right
  (search, bell, more, avatar). Pass <IconButton/>s + <Avatar/>.
- `showTrafficLights` (optional, default true) — suppress the macOS
  traffic-light dots when Figma does not show them.
- `showCollapseButton` (optional, default true) — suppress the sidebar
  collapse icon when Figma does not show it.


```ts
type TitleBarProps = {
  leadingActions?: ReactNode;
  nav?: ReactNode;
  trailingActions?: ReactNode;
  showTrafficLights?: boolean;
  showCollapseButton?: boolean;
}
```

**When NOT to use this:**
- Do NOT render `TitleBar` when you're using `VistaPage` or `ComputerSidebar` — both compose their own window chrome. Doubling up stacks two title bars.
- Do NOT pass `nav={<></>}` to hide the back/forward arrows. Pass `nav={null}` — React treats empty fragments as present, `null` as absent.
- Do NOT inline your own `<svg>` traffic lights or collapse icon. They're baked in and will be duplicated.

## VistaFilterPill (composite)
_source: `composites/VistaFilterPill.tsx`_

VistaFilterPill — segmented filter chip for the VistaToolbar filters slot.

DevRev vista toolbars show filters as compound pills:

  ┌──────────────────────────────────────────┐
  │ [icon] Label │ is │ Value │ × │
  └──────────────────────────────────────────┘

Each segment is separated by a 1px --stroke-neutral-subtle divider. The
label is muted (--fg-neutral-subtle), the value is prominent. The trailing
× is an affordance to remove the filter.

Pill height is `h-control-md` (28px) to align with the vista header/toolbar
icon-button cluster next to it. The composite forces the leading icon to
14px so callers don't need to pass `size={…}` on every icon.

Why this composite exists: generators were hand-rolling a single-cell
div, losing the divider-segmented look. Encoding it here keeps every
frame's filter row visually identical to production.

Slots:
- `icon` (optional) — leading icon (arcade icon or custom SVG). Size is
  coerced to 14px automatically.
- `label` — the filter category, e.g. "Created date", "Stage", "Part".
- `operator` (optional, default "is") — the comparison word between label
  and value. Set to `null` to suppress (single-segment pill).
- `value` — the selected value(s), e.g. "last 30 days", "None of +1".
- `onRemove` (optional) — when provided, renders the trailing × button.

**Compound:** `VistaFilterPill.Add` for the dashed "+ add filter" affordance
at the end of the filter row. `VistaFilterPill.Clear` for the trailing text
"Clear" button. Both are sized to match the pill height (28px) so the whole
row aligns.

**Compound:** `VistaFilterPill.Add`, `VistaFilterPill.Clear`

```ts
type VistaFilterPillProps = {
  icon?: ReactNode;
  label: ReactNode;
  operator?: ReactNode | null;
  value: ReactNode;
  onRemove?: () => void;
}
```

**When NOT to use this:**
- Do NOT hand-roll the filter pill as a single div with
  inline content. The segmented dividers are what make it read as a
  DevRev filter pill instead of a generic chip.
- Do NOT use `<Tag>` for filter pills. Tag is a label
  component and renders as a solid-tinted chip without segment dividers.
- Do NOT hand-roll `<button className="h-7 w-7 border-dashed">` for the add-filter affordance. Use `<VistaFilterPill.Add />` — it bakes the 28px height, dashed border, and 16px plus icon so the add button aligns with the pills beside it.
- Do NOT hand-roll `<button className="text-body-small">Clear</button>` for the trailing clear-filters affordance. Use `<VistaFilterPill.Clear />` — it bakes the 28px height, muted foreground, and hover-prominent color so Clear aligns with the pills beside it.

## VistaGroupRail (composite)
_source: `composites/VistaGroupRail.tsx`_

VistaGroupRail — DevRev vista group/sort rail.

Matches the 256px-wide left column in vista list-view body:

  ┌────────────────────────┐
  │  Sort by Default ↑     │  ← sortControl slot
  ├────────────────────────┤
  │  P0                  1 │
  │  P1                 15 │  ← VistaGroupRail.Item list
  │  P2                 13 │
  │  P3                 17 │
  └────────────────────────┘

Live DOM reference (1728×945):
  Outer: w=256, flex flex-col
  Sort control area: px-2 pt-4 pb-2
  Item list: role="list", flex-col, px-2
  Item: role="listitem", h=32, rounded-md (6px), px-2 gap-2, text-body-small
  Selected item: solid --bg-info-prominent (blue) with --fg-info-on-prominent
  Non-selected hover: --control-bg-neutral-subtle-hover

Why solid blue for selected: arcade-gen's token vocabulary does not
include `--bg-interactive-primary-resting` or `--surface-overlay-hovered`
— those are invented names from an earlier draft of this file. The real
active-nav color in DevRev is `--bg-info-prominent` (solid) with
`--fg-info-on-prominent` on top, which is what production uses for the
selected priority group.

The `Item` subcomponent encodes the selected-state token mapping so
callers can't drift on alpha values.

Slots:
- `sortControl` (optional) — sort button shown above the item list.
- `children` — a list of <VistaGroupRail.Item/>.

VistaGroupRail.Item props:
- `selected` — highlights the row with the solid info-prominent background.
- `label` — left-aligned main text.
- `count` (optional) — right-aligned count.
- `onClick` (optional) — click handler.

**Compound:** `VistaGroupRail.Item`

```ts
type VistaGroupRailProps = {
  sortControl?: ReactNode;
  children: ReactNode;
}
```

**When NOT to use this:**
- Only render the rail when the reference (Figma frame, screenshot, or description) shows a visible left column with a sort control + grouped counts (P0 / P1 / P2 / P3, Triage / Prioritized / …, owner avatars, etc.). If the reference shows the table starting flush against the sidebar — no "Sort by Default" header, no grouped rows — OMIT the rail. Pass the table alone to VistaPage's `children`. Rendering a rail the reference doesn't show adds an empty column and pushes the table right.
- Do not render a single-item rail (`<VistaGroupRail.Item label="All" count={N} selected />`) as a fallback when the grouping isn't obvious in the reference. A one-item rail is visually indistinguishable from noise. If there is no grouping shown, there is no rail.

## VistaHeader (composite)
_source: `composites/VistaHeader.tsx`_

VistaHeader — DevRev vista page header band.

Matches the header row on app.devrev.ai/devrev/vistas/* list views:

  ┌──────────────────────────────────────────────────────────────┐
  │  [title]  [count]                   [actions]  [primaryAction]│
  └──────────────────────────────────────────────────────────────┘

Live DOM reference (1728×945):
  flex items-center justify-between px-page-gutter py-5
  → padding 20px 36px, height 72px, no bottom border

The title and count sit on a shared baseline (matches the live
`flex items-baseline space-x-1.5`), NOT centered.

Typography is owned by this composite so callers can't drift:
  - Title renders at `text-title-3` with `--fg-neutral-prominent`.
  - Count renders at `text-body-small` with `--fg-neutral-medium`.
Pass plain text / numbers as children — do NOT wrap in your own
`<span className="text-…">`, it will be overridden.

Slots:
- `title` — the vista title. A string or inline node; wrapped in the
  composite's title-3 h1 automatically.
- `count` (optional) — item count; rendered with text-body-small + fg-neutral-medium.
  **Pass the string the reference shows, verbatim** — `"165.1K"`, `"1.2M"`,
  `"16,538"`. Do NOT strip separators (`"16538"`), expand abbreviations
  (`"165100"`), or reformat. The count slot is display-only.
- `actions` (optional) — icon-button cluster (search/sort/filter/…).
  Pass a list of `<VistaHeader.Action icon={…} label="…" />` children.
  The composite owns spacing (`gap-0.5`) and each Action bakes in the
  correct IconButton variant+size — callers don't need to remember the
  right props. Render exactly the icons the reference shows, in order.
- `primaryAction` (optional) — primary call-to-action button (e.g. + Issue).
  Use `<VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>`.
  The subcomponent bakes in `variant="primary"` + `size="md"` (28px, the
  Figma-spec'd height for vista chrome) and forces the icon to 16px so the
  CTA visually matches the header's icon-button cluster beside it.
  Note: arcade `Button variant="primary"` renders a dark/inverted button.
  DevRev vistas may show the CTA in DevRev-blue instead — if the reference
  shows a blue CTA, leave a TODO gap (`{/* TODO: blue vista CTA *\/}`)
  rather than substituting a dark button.

**Compound:** `VistaHeader.Action`, `VistaHeader.PrimaryAction`

```ts
type VistaHeaderProps = {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;
  /** Inline edit (pencil) affordance after the title — the real vista shows
   *  it for an editable view name. Default true; pass false to hide. */
  editable?: boolean;
  onEdit?: () => void;
}
```

**When NOT to use this:**
- Do NOT inline `<IconButton variant="secondary" size="sm">…</IconButton>` into the `actions` slot. Use `<VistaHeader.Action icon={<MagnifyingGlass />} label="Search" />` — the subcomponent bakes variant/size/hit-target so icon buttons match DevRev vista chrome exactly.
- Do NOT inline `<Button variant="primary" size="sm" iconLeft={<PlusSmall />}>Issue</Button>` into the `primaryAction` slot. `size="sm"` is 20px tall — half the height of the vista icon cluster next to it, so the CTA renders squished. Use `<VistaHeader.PrimaryAction icon={<PlusSmall />}>Issue</VistaHeader.PrimaryAction>` so the CTA height + icon size stay aligned with the rest of the header.
- Do NOT wrap `actions` children in your own `<div className="flex gap-*">`. The composite applies the correct inter-icon spacing; your wrapper will either collapse it or double it.

## VistaPagination (composite)
_source: `composites/VistaPagination.tsx`_

VistaPagination — footer band for vista list views.

Matches the footer across DevRev vista pages:

  ┌───────────────────────────────────────────────────────────┐
  │ Rows per page [50 v]            1–50 of 16538  ‹  ›        │
  └───────────────────────────────────────────────────────────┘

Sits below the scrolling table container, owns its own top border, and
is always visible (not part of the scroll region).

Slots:
- `pageSize` — current rows-per-page value as a plain number/string.
- `onPageSizeClick` (optional) — handler for the size selector (toggles
  a dropdown the caller owns — this composite just renders the trigger).
- `rangeLabel` — the "1–50 of 16538" summary text (caller formats it).
- `onPrev` / `onNext` (optional) — paging handlers; omit to disable.
- `canPrev` / `canNext` (optional, default true) — disables the
  respective button without hiding it.


```ts
type VistaPaginationProps = {
  pageSize: ReactNode;
  onPageSizeClick?: () => void;
  rangeLabel: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}
```

**When NOT to use this:**
- Do NOT hand-roll the pagination row as inline JSX
  inside VistaPage children. It's a sibling of the scrolling area with
  its own border; rolling it inline causes the border to scroll away.

## VistaRow (composite)
_source: `composites/VistaRow.tsx`_

VistaRow — DevRev vista table row + canonical column vocabulary.

Why this composite exists: generators kept inventing their own column
widths, paddings, and cell styles per frame. Without a canonical row,
every vista looked slightly different — Priority was a dot in one frame
and a Tag in another; ID cells drifted between `text-system-small`,
`text-caption`, and `font-mono`; Stage appeared as an icon strip, a
tinted Tag, and a soft Tag across frames generated against the same
Figma source. This composite encodes the production row once.

Live DOM reference (app.devrev.ai/devrev/views/… , verified 2026-06-03):
  Row: h-12 (48px), border-b --stroke-neutral-subtle, hover
    --control-bg-neutral-subtle-hover, items-center. Cells own px-2 with a
    12px row inset (pl-3 pr-3). Cell text is 12px (text-body-small).
  Header: h-8 (32px), text-system-small + --fg-neutral-subtle, NOT
    uppercase. (The real app de-uppercased headers; the old caption/upper
    treatment was kit drift.)

Layout:

  ┌─ pl-3 ─┬────────┬─── flex-1 ───┬──────────┬──────────┬──────────┐
  │ select │  id    │  title       │  owner   │  stage   │  date    │
  └────────┴────────┴──────────────┴──────────┴──────────┴──────────┘

Column components encode token choices so callers can't drift. The real
vista is PLAINER than this composite used to be — the only colour is the
ObjectId badge and a tiny stage icon; everything else is neutral text.
  - <VistaRow.Priority value="P0" /> — Tag, intent mapped from P0..P3.
    (Priority is per-view; many vistas don't show it.)
  - <VistaRow.Id>ENH-7267</VistaRow.Id> — ObjectId badge: soft type-tinted
    pill (default success/green; pass `intent` for issues=info, etc.).
    ChipText, NOT mono, NOT a blue Tag.
  - <VistaRow.Title>…</VistaRow.Title> — truncating body-small-prominent.
  - <VistaRow.Stage>Ideation</VistaRow.Stage> — small status icon + PLAIN
    neutral text. NOT a colored tag. Pass `icon` to override the glyph.
  - <VistaRow.Part>Identity / SSO</VistaRow.Part> — text-body-small medium fg.
  - <VistaRow.Owner name="Priya Shah" /> — Avatar + name.
  - <VistaRow.Tags tags={["regression", "enterprise"]} /> — neutral tinted Tags.
  - <VistaRow.Updated>May 27, 2026</VistaRow.Updated> — text-caption subtle.

Intentional opinions:
- The row is `items-center`, not `items-baseline`.
- The row does NOT own its columns' widths. Callers decide: most vista
  tables use `w-24` for ID, `flex-1 min-w-0` for Title, `w-40` for
  Stage/Part/Owner, `w-28` for Updated. Header cells use the same widths.
- The HeaderCell subcomponent shares the row cell's width+padding
  invariants so header and body columns stay aligned.

**Compound:** `VistaRow.Header`, `VistaRow.HeaderCell`, `VistaRow.GroupHeader`, `VistaRow.Select`, `VistaRow.Priority`, `VistaRow.Id`, `VistaRow.Title`, `VistaRow.Stage`, `VistaRow.Part`, `VistaRow.Owner`, `VistaRow.Tags`, `VistaRow.Updated`

**When NOT to use this:**
- Do NOT use `arcade.Table` for a vista list view — it's a generic data table and won't produce the DevRev vista row shape.
- Do NOT hand-roll `<div className="flex items-center h-12 …">` rows. Use `<VistaRow>` and the column primitives so every vista looks identical.
- Do NOT render the Stage column as a colored Tag — the real app shows a small status icon + plain neutral text. Use `<VistaRow.Stage>`.
- Do NOT render the ID as a blue mono Tag — it's a soft type-tinted ObjectId badge (green for enhancements). Use `<VistaRow.Id>` and pass `intent` for the object type.

## VistaToolbar (composite)
_source: `composites/VistaToolbar.tsx`_

VistaToolbar — DevRev vista toolbar band.

Matches the filter/toolbar row on vista list views:

  ┌──────────────────────────────────────────────────────────────┐
  │  [icons] │ [filter pills…] [+] [Clear]                       │
  └──────────────────────────────────────────────────────────────┘

Live DOM reference (1728×945):
  Outer: flex items-start mb-4 px-page-gutter justify-between
    → padding 0 36px, margin-bottom 16px
  Inner: flex gap-2 items-center flex-wrap (content 30px tall)

The vertical separator after the icon cluster is owned by this
composite. When `toolbarIcons` is provided, the separator renders.
When absent, the row starts with `filters` directly.

Slots:
- `toolbarIcons` (optional) — icon cluster (@ / chart / clock / …).
  Pass a list of `<VistaToolbar.IconAction icon={…} label="…" />` children.
  The composite owns spacing (`gap-0.5`) and each IconAction bakes in the
  correct IconButton variant+size — callers don't remember it.
- `filters` (optional) — filter pill group + add-filter + clear.

**Compound:** `VistaToolbar.IconAction`

```ts
type VistaToolbarProps = {
  toolbarIcons?: ReactNode;
  filters?: ReactNode;
}
```

**When NOT to use this:**
- Do NOT inline `<IconButton variant="secondary" size="sm">…</IconButton>` into the `toolbarIcons` slot. Use `<VistaToolbar.IconAction icon={<AtSymbol />} label="Mentions" />` — the subcomponent bakes variant/size so icons in the toolbar match DevRev vista chrome exactly.
- Do NOT wrap `toolbarIcons` children in your own `<div className="flex gap-*">`. The composite applies the correct inter-icon spacing; your wrapper will either collapse it or double it.
