# Prototype kit manifest

> Auto-generated from `studio/prototype-kit/{composites,templates}/*.tsx`.
> DO NOT edit by hand — run the studio dev server (or `writeManifest()`)
> to refresh. Read this file BEFORE reading any individual composite or
> template source; if a prop signature here is enough, skip the extra
> `Read`. Open the `.tsx` only when you need the full rendered markup.

_22 entries — 20 composites, 2 templates._

## Templates


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


```ts
type VistaPageProps = {
  sidebar: ReactNode;

  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  primaryAction?: ReactNode;

  toolbarIcons?: ReactNode;
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

**Compound:** `ChatInput.ContextAttachment`, `ChatInput.FileAttachment`, `ChatInput.AddAttachmentButton`, `ChatInput.SendButton`, `ChatInput.StopButton`

## ChatMessages (composite)
_source: `composites/ChatMessages.tsx`_

ChatMessages — conversation transcript composite for Computer / Agent Studio.

Matches Figma "chat" (node 161:9716 in the "Untitled" prototype file).
The transcript contains two kinds of blocks:

  - Sender / receiver bubbles — use the arcade `<ChatBubble variant="user" />`
    / `<ChatBubble variant="assistant" />` component directly.
  - `ChatMessages.Agent` — agent's turn: a pause/running icon, an optional
    expandable "Thoughts" block, and body text below.

The thoughts block (collapsed + expanded) follows Figma `_Thoughts`
component set 6064:65430 — a rounded pill + small detached circle
drawn as a thought-cloud. Geometry taken verbatim from the Figma SVG
export.

Usage:

  <ChatMessages>
    <ChatBubble variant="user">Help me create a presentation…</ChatBubble>
    <ChatBubble variant="assistant">Sure — what's the topic?</ChatBubble>
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
  icon?: ReactNode;
  onTitleClick?: () => void;
  actions?: ReactNode;
}
```

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

## NavSidebar (composite)
_source: `composites/NavSidebar.tsx`_

NavSidebar — DevRev navigation sidebar composite.

Matches Figma "Sidebar / My Work + Teams + Multiplayer Sidebar". Replaces
the bare `arcade.Sidebar` for prototype use. This composite lives BELOW
the TitleBar in AppShell, so it does NOT render traffic lights or a
collapse button — those are the TitleBar's responsibility.

Intentional opinions:
- Three zones: brand header (top, workspace dropdown only), nav body
  (scrollable middle), Computer footer (bottom).
- Uses --surface-shallow so the sidebar reads as a muted panel against
  the body's --surface-overlay.
- Nav body accepts NavSidebar.Section and NavSidebar.Item children —
  same compound pattern as arcade.Sidebar for familiarity.
- Active item is solid --bg-info-prominent with --fg-info-on-prominent,
  matching the DevRev production app (not a muted gray pill).
- Section titles render at text-system-medium with --fg-neutral-prominent
  — NOT uppercase/caption. Uppercase was a carry-over from an older
  design and doesn't match the current sidebar spec.

Slots:
- `workspace` (optional) — label in the brand header (e.g. "DevRev").
  When omitted or falsy, the brand header is NOT rendered — use this when
  the Figma frame does not show a workspace header.
- `showFooter` (optional, default true) — when false, the Computer footer
  is not rendered. Use this when Figma shows a different footer pattern.
- `children` — NavSidebar.Section / NavSidebar.Item tree.

**Compound:** `NavSidebar.Section`, `NavSidebar.Item`

**When NOT to use this:**
- When Figma shows a chat-style sidebar (with "New Chat" and chat history), use `ComputerSidebar` instead. That composite owns its own window chrome; do NOT also render a `TitleBar` alongside it.
- Never use `arcade.Sidebar` directly for the main app sidebar — it's the bare primitive. `NavSidebar` adds the workspace dropdown, Computer footer, and correct tokens.
- Do not pass `workspace=""` to hide the brand header. Composites check truthiness; the empty string counts as "present but empty". Omit the prop entirely.

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
- `children` — the page body sections (typically a stack of SettingsCards).


```ts
type PageBodyProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
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
  - Count renders at `text-body` with `--fg-neutral-subtle`.
Pass plain text / numbers as children — do NOT wrap in your own
`<span className="text-…">`, it will be overridden.

Slots:
- `title` — the vista title. A string or inline node; wrapped in the
  composite's title-3 h1 automatically.
- `count` (optional) — item count; rendered with text-body + fg-neutral-subtle.
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

Live DOM reference (app.devrev.ai/…/vistas/…?view_type=table):
  Row: h-11, border-b --stroke-neutral-subtle, hover --surface-overlay-hovered (in arcade-gen this is --control-bg-neutral-subtle-hover),
    items-center
  Column gap: the row has internal gap-0 — cells own their own px-3,
    with a leading 24px left indent (pl-6) to align with the group header

Layout:

  ┌── pl-6 ──┬──────────┬─── flex-1 ────┬──────────┬──────────┬──────────┐
  │ leading  │  id      │  title        │  stage   │  part    │ trailing │
  └──────────┴──────────┴───────────────┴──────────┴──────────┴──────────┘

Column components encode token choices so callers can't drift:
  - <VistaRow.Priority value="P0" /> — Tag, intent mapped from P0..P3.
  - <VistaRow.Id>ISS-4231</VistaRow.Id> — tinted info Tag with mono font.
  - <VistaRow.Title>…</VistaRow.Title> — truncating body-small-prominent.
  - <VistaRow.Stage tone="info">In development</VistaRow.Stage> — tinted
    Tag using the tone→intent mapping (see below).
  - <VistaRow.Part>Identity / SSO</VistaRow.Part> — text-body-small
    medium fg.
  - <VistaRow.Owner name="Priya Shah" /> — Avatar + name.
  - <VistaRow.Tags tags={["regression", "enterprise"]} /> — row of
    neutral tinted Tags.
  - <VistaRow.Updated>2h ago</VistaRow.Updated> — text-caption subtle.

Stage tone → Tag intent mapping:
  triage     → warning   (yellow)
  dev        → info      (blue)
  review     → intelligence (purple)
  queued     → neutral   (gray)
  done       → success   (green)
  blocked    → alert     (red)

Intentional opinions:
- The row is `items-center`, not `items-baseline`. Baseline alignment
  looks broken when cells mix Tags (height 24) with plain text (h~18).
- The row does NOT own its columns' widths. Callers decide: most vista
  tables use `w-24` for ID, `flex-1 min-w-0` for Title, `w-40` for
  Stage/Part/Owner, `w-28` for Updated. Header cells use the same widths.
- The HeaderCell subcomponent exists because the column header has the
  same width+padding invariants as the row cell — pairing them here
  keeps them from drifting apart.

**Compound:** `VistaRow.Header`, `VistaRow.HeaderCell`, `VistaRow.GroupHeader`, `VistaRow.Select`, `VistaRow.Priority`, `VistaRow.Id`, `VistaRow.Title`, `VistaRow.Stage`, `VistaRow.Part`, `VistaRow.Owner`, `VistaRow.Tags`, `VistaRow.Updated`

**When NOT to use this:**
- Do NOT use `arcade.Table` for a vista list view — it's a generic data table and won't produce the DevRev vista row shape.
- Do NOT hand-roll `<div className="flex items-center h-11 …">` rows. Use `<VistaRow>` and the column primitives so every vista looks identical.
- For the Priority column, use `<VistaRow.Priority value="P0" />` — don't render a colored dot + label yourself. The composite maps P0/P1/P2/P3 to Tag intents for you.
- For the Stage column, use `<VistaRow.Stage tone="dev">…</VistaRow.Stage>` with the tone alias (triage/dev/review/queued/done/blocked). Don't pass a raw Tag intent — the tone mapping encodes DevRev's stage-color convention.

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
