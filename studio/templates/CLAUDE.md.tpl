# {{PROJECT_NAME}}

You are helping a DevRev designer prototype a feature. All work happens inside this project directory.

## Goal

You are building prototype frames for a designer. Speed matters more than completeness. A working frame in 2 minutes beats a perfect plan in 20. Implement directly; do not produce plan documents.

## Execution discipline

- Do NOT use ExitPlanMode, do NOT write planning markdown files, do NOT describe what you'll do — just do it.
- Aim for one frame written within 2-3 minutes.
- When unsure about a detail (copy, icon, exact pixel), pick something reasonable and move on. The designer will iterate.
- Never mention file paths, tool names, stack traces, or terminal commands to the user. Speak about colors, type, spacing, components, screens.

## The eight principles of accurate generation

These are the rules for how you translate a design into code. They apply to every frame regardless of what you're building, and violating any one of them is how frames drift from the intended design. Internalize these before reaching for the mechanics below.

**P1. When a Figma frame is provided, Figma is the source of truth — composites are convenience.**
If the designer gave you a Figma URL, Figma overrides any opinion baked into a composite. Every composite has built-in rendering that can be suppressed via props (e.g. `NavSidebar` has `workspace?` + `showFooter?`; `TitleBar` has `showTrafficLights?`, `showCollapseButton?`, and accepts `nav={null}` to hide back/forward; `NavSidebar.Section`'s `title` only renders when provided). When Figma does not show a piece, suppress it — never render the composite default **and** the Figma content stacked on top of each other. When no Figma frame is provided, composite opinions are your source of truth — build from them directly and do not invent alternatives.

**P2. Read before render — exhaustive enumeration.**
Before writing a single JSX element, produce a mental inventory of every Figma node in the target subtree. No JSX until every node has been named in your read. Any unenumerated node is a blind spot, and blind spots become inventions.

**P3. Slot inventory is a mandatory step — not a guideline.**
The FIRST file you open after reading Figma, before writing any JSX, is the source of every composite you intend to use. For each composite (`AppShell`, `NavSidebar`, `TitleBar`, `SettingsPage`, `BreadcrumbBar`, `PageBody`, `SettingsCard`, `SettingsRow`) you call in the frame, `Read` its `.tsx` file at `{{PROTOTYPER}}/studio/prototype-kit/composites/<Name>.tsx` — no exceptions, every frame, every time. Then state to yourself what the composite renders automatically and what each prop controls. Skipping this step is the single biggest source of generation errors. "I've used this composite before" is not a valid reason to skip — the props may have changed.

**P4. Named gaps over silent gaps.**
If a Figma region cannot be resolved to a composite slot or an arcade primitive, write `{/* TODO: Figma node "<name>" (<nodeId>) unresolved */}` and continue. Never fill a read failure with plausible-looking chrome. A named gap is recoverable; invention is not.

**P5. Closed-world imports.**
The only import roots that exist are `arcade`, `arcade/components`, `arcade-prototypes`, and `react`. Anything else — `lucide-react`, `heroicons`, `react-icons`, any other package, any relative path — will fail the build. There are no fallbacks; verify the import is in this closed set before writing it.

**P6. Self-verify by node count.**
After writing the JSX, trace each Figma node from your P2 inventory to either a JSX element, a composite slot assignment, or a gap comment from P4. Count mismatch means go back and reconcile.

**P7. Every Figma leaf has exactly one resolution.**
For every leaf in the Figma tree, pick exactly one of: (a) composite slot, (b) arcade primitive, (c) explicit TODO gap. There is no fourth category. A leaf that is silently omitted is a defect.

**P8. Styling tokens are closed-world, same as imports.**
Arbitrary Tailwind brackets — `text-[120px]`, `w-[1040px]`, `rounded-[17px]`, `bg-[#FF6B35]`, `text-[color:var(...)]`, `font-[440]` — are as forbidden as importing `lucide-react`. Size, radius, color, typography, shadow, and spacing all come from the named utility classes in the "Styling rules" section below. If a Figma value does not map cleanly to a token, pick the nearest named token (that is what Figma intended — tokens are the design system). If NO reasonable token match exists, treat it as a P4 gap and write a TODO comment instead of inventing a bracket. The only exception is `bg-[#FF5F57]` / `#FEBC2E` / `#28C840` used inside composite source for traffic-light dots — those are macOS-fixed colors, and you are not writing composite source.

These principles do not change when the design changes. They apply identically to a settings page, a chat screen, a dashboard, a form, or an empty state. The sections below give you the mechanics; these principles tell you what the mechanics are for.

### The mandatory first four steps (before any JSX)

For every new frame, in this order, with no skipping:

1. **Read Figma** — `figmanage reading get-nodes --depth 4 --json <FILE_KEY> <NODE_ID>` on the outer frame. No parallel calls, no deeper than 4 on the outer frame.
2. **Enumerate nodes** — list every major section and its leaves. If a section is unclear, do ONE focused deeper read on that subtree.
3. **Read composite source** — for every composite you intend to use, `Read {{PROTOTYPER}}/studio/prototype-kit/composites/<Name>.tsx`. You cannot pick slots and suppress defaults without knowing what's there.
4. **Map nodes → resolutions** — for each Figma node, pick composite slot, arcade primitive, or TODO gap. Now you can write JSX.

### Concrete anti-patterns (these are build-breakers, not warnings)

These are specific failure modes that have burned prior generations. None of them are abstract; they are things you WILL be tempted to do. Don't.

| Anti-pattern | What's wrong | Do instead |
|---|---|---|
| `<PageBody title="Agent" subtitle="Your AI assistant for work">…</PageBody>` when Figma has no title/subtitle | Invented content in composite slots. P1 + P4 violation. | Don't pass `title` / `subtitle`. Or don't use `<PageBody>` at all — if Figma shows a freeform center canvas, drop to a bare div with `mx-auto max-w-...` using a token. |
| `<div className="fixed bottom-6 left-1/2 -translate-x-1/2">` for a command bar inside AppShell | `fixed` escapes the AppShell's layout containment; the bar overlaps the sidebar and floats over the whole viewport. | Use `sticky bottom-0` inside the body container, or place the bar as a layout sibling of the scrolling region, never `position: fixed`. |
| `w-[1040px]`, `text-[120px]`, `px-[21px]`, `bg-[#FF6B35]`, SVG `width="145"` | Arbitrary sizes / colors. P8 violation. | Pick the nearest token (`max-w-[832px]` equivalent is PageBody's default; control heights are `h-control-*`; use `--fg-neutral-*` / `--bg-neutral-*`). If nothing fits, write a P4 TODO — don't invent a pixel. |
| `breadcrumbBar={null}` on `AppShell` while still worrying about a divider | AppShell now handles the null case correctly (no divider above body). Just pass `null` and don't add your own border. | Omit the prop entirely, or pass `null`. The composite does the right thing. |
| Writing your own `<svg>` for a logo/icon the Figma frame shows | Figma's rendered logo is an exported image asset, not a vector you reconstruct by eyeballing coordinates. | Export from Figma via `figmanage export nodes --format png --scale 2`, save to `shared/`, `<img src="..." />`. Or write a P4 TODO and let the designer supply the asset. |
| Re-enabling suppressed composite defaults (e.g. passing `workspace=""` to NavSidebar expecting it to hide) | Empty strings are not the same as omission. Composites check truthiness, not emptiness. | Omit the prop entirely: `<NavSidebar>…</NavSidebar>` with no `workspace` prop hides the brand header. |

If you catch yourself writing any of the left-column patterns, stop and revise. These are the exact mistakes the principles exist to prevent.

## The three layers (read this first)

You have THREE layers of building blocks. Always reach for the highest layer that fits before dropping down.

1. **`arcade-prototypes` / templates** — whole-page compositions. Today only `SettingsPage` exists. Pick it if the Figma frame matches; otherwise drop to composites. **Do not import any other template name** (no `ChatPage`, `AgentPage`, etc.) — the import will fail.
2. **`arcade-prototypes` / composites** — opinionated chrome pieces like `AppShell`, `NavSidebar`, `PageHeader`, `PageBody`, `SettingsCard`, `SettingsRow`. Use these when no template matches, or as slots inside a template.
3. **`arcade` / components** — primitives like `Button`, `Switch`, `Input`, `Breadcrumb`, `Avatar`, `IconButton`. Use these as leaves inside composites, or directly when you really are rendering just one control.

Hand-rolled `<div>` + Tailwind is a LAST resort. Every time you are about to write `<aside>`, `<header>`, or a bordered group of settings rows, stop and pick the composite that does it for you.

### Prototype-kit vs arcade

- `arcade-prototypes` is for prototyping only. It is **not** a production package and exists purely inside this studio.
- `arcade` is the production design system. Use its components as the atomic building blocks.
- Import paths:
  - `import { SettingsPage, AppShell, TitleBar, BreadcrumbBar, PageBody, NavSidebar, ComputerSidebar, ComputerHeader, CanvasPanel, ChatInput, ChatEmptyState, ChatMessages, SettingsCard, SettingsRow } from "arcade-prototypes";`
  - `import { Button, Switch, Breadcrumb, Avatar, IconButton, Separator } from "arcade/components";`
- Never write relative paths (`../...`) or filesystem paths. Only these two aliases.

## Templates (start here)

A template encodes the whole chrome assembly for a known DevRev page shape. Using one is almost always a win: your frame becomes ~40 lines of slots instead of ~250 lines of hand-rolled chrome, and you can't skip the sidebar or the page header by accident.

### `SettingsPage`

For any DevRev settings-style page (Agent Settings, Workspace Settings, Profile, Integrations, etc.). Composes `AppShell` + `NavSidebar` + `PageHeader` + `PageBody` in the canonical layout.

```tsx
import {
  SettingsPage,
  NavSidebar,
  SettingsCard,
  SettingsRow,
} from "arcade-prototypes";
import {
  Breadcrumb,
  Button,
  Switch,
  IconButton,
  Avatar,
} from "arcade/components";

export default function AgentSettings() {
  return (
    <SettingsPage
      sidebar={
        /* If the Figma sidebar has no nav items, leave children empty.
           ONLY add NavSidebar.Section + NavSidebar.Item when the Figma
           frame actually shows them — never invent sections or items. */
        <NavSidebar workspace="DevRev" />
      }
      breadcrumb={
        <Breadcrumb.Root>
          <Breadcrumb.Item><Breadcrumb.Link href="#">Settings</Breadcrumb.Link></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item>Agent</Breadcrumb.Item>
        </Breadcrumb.Root>
      }
      actions={
        <>
          {/* Top-right cluster: lives in the TitleBar */}
          <IconButton aria-label="Search" variant="tertiary" size="sm">{/* icon */}</IconButton>
          <IconButton aria-label="Notifications" variant="tertiary" size="sm">{/* icon */}</IconButton>
          <Avatar name="User" size="sm" />
        </>
      }
      pageActions={
        /* Page-level action cluster (right side of breadcrumb bar) */
        <IconButton aria-label="More" variant="tertiary" size="sm">{/* icon */}</IconButton>
      }
      title="Agent Settings"
      subtitle="Personalise computer to your workflow."
    >
      <SettingsCard title="Inference Settings">
        {/* Separators between rows are inserted automatically — do NOT add them manually */}
        <SettingsRow
          label="LLM model"
          description="Choose the model used for inference."
          action={<Button variant="secondary" size="sm">Configure</Button>}
          control={<Switch />}
        />
        <SettingsRow label="Budget" description="Daily token budget." control={<Switch />} />
      </SettingsCard>
    </SettingsPage>
  );
}
```

If the Figma frame has a title bar + sidebar + breadcrumb + centered body with grouped rows, **this template fits** — do not hand-roll it.

More templates may be added over time. Check `{{PROTOTYPER}}/studio/prototype-kit/templates/` (read-only) for the current list.

## Composites (use when no template fits)

When your frame is not a settings page, drop down one layer and compose directly.

The DevRev desktop chrome is built out of FOUR composites arranged like this:

```
┌─────────────────────────────────────────────────────────┐
│  TitleBar (full-width, 52px)                            │  ← traffic lights + collapse | back/forward + actions
├─────────────────────────────────────────────────────────┤
│ NavSidebar │  BreadcrumbBar                             │  ← breadcrumb + page actions
│            ├─────────────────────────────────────────── │
│  (240px)   │  PageBody (centered column, title+content) │
│            │                                            │
└────────────┴────────────────────────────────────────────┘
```

- **`AppShell`** — assembles the chrome. Slots: `titleBar`, `sidebar`, `breadcrumbBar`, `children`. TitleBar is full-width across the TOP; sidebar+body split is below it.
- **`TitleBar`** — the 52px window title row. Traffic lights + collapse icon on the left (always rendered); `nav` (back/forward arrows) and `trailingActions` (search, bell, more, avatar) on the right.
- **`NavSidebar`** — the left sidebar for the DevRev **SoR desktop app** (workspace dropdown header + nav sections + Computer footer). Compound: `NavSidebar.Section`, `NavSidebar.Item`. Does NOT render traffic lights or a collapse button — TitleBar owns those.
- **`ComputerSidebar`** — the left sidebar for the **Computer / Agent Studio chat interface**. Different shape from `NavSidebar`: owns its OWN window chrome (traffic lights + collapse hugging the traffic lights + back/forward on the right), then a default "New Chat" + history actions row (rendered automatically — pass `primaryAction={null}` to suppress), then chat groups, then an "Agent Studio" link (rendered by default above the user footer — pass `agentStudioLink={null}` to suppress), then a user footer (avatar + name + subtitle + optional bell). Compound: `ComputerSidebar.Group`, `ComputerSidebar.Item`, `ComputerSidebar.User`. When you use `ComputerSidebar`, you typically do NOT render a `TitleBar` — the sidebar owns the window chrome. **Chat item `leading` must be an arcade `<Avatar name="..." src="..." size="sm" />` — never a raw string letter placeholder.** Pick `ComputerSidebar` when Figma shows a chat-style sidebar with "New Chat" / chat history; pick `NavSidebar` when Figma shows a DevRev app sidebar with workspace dropdown + My Work sections.
- **`BreadcrumbBar`** — the 44px breadcrumb row directly above the page body. Slots: `breadcrumb`, `actions` (page-level action cluster, e.g. a "More" IconButton).
- **`PageBody`** — centered max-width column with a hero title + subtitle + children. Slots: `title`, `subtitle`, `children`.
- **`SettingsCard`** — a bordered group with an optional section heading rendered above the border. Slot: `title`, `children`. **Separators between children are inserted automatically — do not add explicit `<Separator />` between rows.**
- **`SettingsRow`** — a single settings row with label + description + action + control. Slots: `label`, `description`, `action`, `control`.
- **`ChatInput`** — the Computer / Agent Studio command bar. A single pill that owns an optional row of attachment chips above an input row with a leading mark (defaults to the Computer logomark), a placeholder input, and a trailing slot for action buttons. Slots: `attachments`, `leading`, `trailing`, `placeholder`, `value`, `defaultValue`, `onChange`, `onSubmit`. Compound: `ChatInput.ContextAttachment` (dashed-border chip for external contexts like a Notion tab or URL — props: `icon`, `title`, `subtitle`), `ChatInput.FileAttachment` (solid-border file card — props: `kind`, `name`, optional `progress` 0-100 → shows uploading overlay; omit for indexed state), `ChatInput.AddAttachmentButton`, `ChatInput.SendButton`, `ChatInput.StopButton`. Typical trailing = `<><ChatInput.AddAttachmentButton /><ChatInput.SendButton /></>`. When Figma shows the command bar inside an app body, place it as a sibling of the scrolling content with `sticky bottom-0` — never `position: fixed`.
- **`ComputerHeader`** — the thin 48px top bar for a Computer chat screen. Left side: a chat-icon + conversation title + chevron rendered as a borderless pill (suggests a rename/switch dropdown). Right side: a trailing action slot (typically 1-2 `<IconButton />`, e.g. "Add collaborator", "Open canvas panel"). Slots: `title` (required), `icon` (defaults to `<ChatBubbles />`), `onTitleClick`, `actions`. No border below — the chat body sits directly beneath on the same surface.
- **`CanvasPanel`** — the right-hand side panel showing artefacts of the current conversation (created files, connected sources, local folders). Fixed 272px wide, scrolls vertically. Slots: `step` (optional progress header — use `<CanvasPanel.Step current={2} total={4} title="…" />`), `children` (`<CanvasPanel.Group>` tree). Compound: `CanvasPanel.Step` (progress ring + title), `CanvasPanel.Group` (title + optional `trailing` + children — pass `<CanvasPanel.GroupAddButton />` for a "+" affordance), `CanvasPanel.Item` (single row — slots: `leading`, `trailing`, `children`, `onClick`), `CanvasPanel.FileIcon`, `CanvasPanel.FolderIcon`, `CanvasPanel.StatusDot` (for "new/unread" indicator), `CanvasPanel.CountBadge` (pill for counts like `12`, `20`). Lives as a sibling of the chat column, typically to the RIGHT of the main body; does NOT own window chrome.
- **`ChatEmptyState`** — centered faded Computer logomark for a brand-new conversation. No slots — render as the sole child of the scrolling chat body when there are no messages yet.
- **`ChatMessages`** — the chat transcript. Owns vertical spacing between blocks. For user / receiver messages, render `<ChatBubble variant="user">…</ChatBubble>` / `<ChatBubble variant="assistant">…</ChatBubble>` directly as children (imported from `arcade/components`). The composite supplies `ChatMessages.Agent` for agent turns — a pause glyph + optional expandable thoughts block + follow-up text. For the thoughts block use `<ChatMessages.Thoughts label="Thought for 4s" />` (collapsed chip) or `<ChatMessages.Thoughts label="Working" expanded>...<ChatMessages.ThoughtItem>step name</ChatMessages.ThoughtItem>...</ChatMessages.Thoughts>` (expanded with a list of running steps). Pass `<ChatMessages.ThoughtItem subtitle="npm ci">Running bash command</ChatMessages.ThoughtItem>` to render a step with a trailing muted detail.

(The old `PageHeader` composite is deprecated — its functionality is now split across TitleBar + BreadcrumbBar. Do not use it.)

Read the source in `{{PROTOTYPER}}/studio/prototype-kit/composites/<Name>.tsx` if you need the exact props — each file has a short header comment explaining slots and opinions.

## Arcade components (leaves)

Use arcade primitives INSIDE composites — as the `action` in a `SettingsRow`, the `actions` cluster in a `PageHeader`, the controls in a form, etc.

- Every component lives at `{{ARCADE}}/src/components/<group>/<Name>/` and ships a `<Name>.stories.tsx` showing canonical usage.
- Before using a component you haven't already used in this session, open its story file. That IS the API reference.
- Compound components (`Select.Root`, `Tabs.Root`, `Breadcrumb.Root`, `Dropdown.Root`, etc.) are common. Stories show which pieces compose.
- **Never render the bare compound name** (`<Breadcrumb>…</Breadcrumb>`, `<Select>…</Select>`). Most compounds are plain objects with no default render and will crash with `Element type is invalid: … got: object`. Always enter via `.Root`.
- Public barrel: `{{ARCADE}}/src/components/index.ts`. Available: Button, IconButton, ButtonGroup, SplitButton, Input, TextArea, Select, Checkbox, Radio, Switch, Toggle, ToggleGroup, DatePicker, Avatar, Badge, Tag, Tooltip, Separator, Table, Modal, Toast, Popover, Dropdown, Menu, Sidebar, Tabs, ChatBubble, Banner, Breadcrumb, KeyboardShortcut, Link.
- Import from `arcade/components` — never relative paths.

Do NOT use `arcade.Sidebar` for the app's main navigation sidebar — the prototype-kit's `NavSidebar` is the opinionated wrapper that includes the workspace dropdown and Computer footer. `arcade.Sidebar` is the bare primitive; reach for it only if you have a reason not to use `NavSidebar`.

### Icons

Arcade ships its own icon set. **Never import from `lucide-react`, `heroicons`, `react-icons`, or any other icon library — none of them are installed and the frame will fail to build.** Always import icons from `arcade/components`, the same alias as the rest of the primitives:

```tsx
import { Bell, MagnifyingGlass, ChevronLeftSmall, ChevronRightSmall, ThreeDotsVertical, PlusSmall } from "arcade/components";
```

- Icon names are **PascalCase** and often carry a `Large` / `Small` size suffix (e.g. `ChevronLeftSmall`, `PlusLarge`, `CheckmarkSmall`). Compound names are spelled out (`MagnifyingGlass`, not `Search`; `ThreeDotsVertical`, not `MoreVertical`; `Bell`, not `Notification`).
- Each icon accepts `size` (number, default 24), `color` (default `"currentColor"`), and `className`. The SVG uses `fill={color}` and inherits text color by default, so the usual `<IconButton>` + icon pattern just works.
- **MANDATORY: discover available names before writing imports.** Before you write ANY icon import, `Read` the barrel file `{{ARCADE}}/src/components/icons/index.ts` and confirm every name you plan to use appears there verbatim. Do NOT guess based on conventions from other libraries. Examples of wrong guesses that will silently break the frame: `UserPlusSmall` (correct: `HumanSilhouetteWithPlus`), `Search` (correct: `MagnifyingGlass`), `MoreVertical` (correct: `ThreeDotsVertical`), `Notification` (correct: `Bell`), `Send` (correct: `PaperPlane`), `Trash` (correct: `TrashCan`). A single missing import throws at module load and the entire frame renders blank with no visible error — so it is critical that every icon name be verified against the barrel before import.
- Figma → arcade icon name mapping: `Search` / magnifier → `MagnifyingGlass`; `Notification` / bell → `Bell`; `More` (vertical dots) → `ThreeDotsVertical`; `More` (horizontal dots) → `ThreeDotsHorizontal`; `Back` arrow in a title bar → `ChevronLeftSmall`; `Forward` → `ChevronRightSmall`; `Plus` / add → `PlusSmall` or `PlusLarge` depending on context.

## Responsive design (required for every frame)

Studio renders frames in five device widths, switchable from the top toolbar:

| Preset  | Width   |
|---------|---------|
| Mobile  | 375 px  |
| Tablet  | 1024 px |
| Desktop | 1440 px |
| Wide    | 1920 px |
| Fit     | Column width (varies) |

**Every frame MUST look reasonable at all five widths.** Not pixel-perfect on every preset — "reasonable" means no horizontal scroll, no clipped content, no overlapping panels, and the primary content remains usable.

Rules of thumb:

- **Mobile (≤ 640 px):** collapse multi-column layouts to a single column. Hide or collapse secondary chrome (nav sidebars, agent panels, filter rails) — move them into a drawer or a top-level dropdown. Primary action stays visible. Use Tailwind `sm:`/`md:`/`lg:` breakpoints to layer up for wider screens.
- **Tablet (641–1279 px):** two-column is fine; three-column usually needs to drop one column. Hide optional chrome if it crowds the primary content.
- **Desktop (≥ 1280 px):** design target. Full multi-column layouts are welcome.
- **Wide (≥ 1600 px):** don't let content stretch edge-to-edge; cap max-widths on primary columns (`max-w-5xl`, etc.) so the frame doesn't read as a desktop layout zoomed up.
- **Fit:** whatever the column happens to be. The frame should fill the available width without horizontal scroll.

Concrete patterns:

- Use Tailwind responsive prefixes (`hidden sm:flex`, `flex-col md:flex-row`, `grid-cols-1 lg:grid-cols-3`). Never use JS viewport detection for layout.
- For composite chat screens: the sidebar should collapse behind a toggle at Mobile width. The chat transcript stays full-width.
- Never set a fixed pixel width on the frame's outer container that exceeds ~375 px. If a sub-component needs a minimum size, use `min-w-0` on its parent and let it overflow internally (scroll, wrap, or truncate) rather than forcing the page to scroll horizontally.

If the user asks for a "mobile" or "desktop" design specifically, design for that width first and treat the others as secondary — but still avoid horizontal scroll on Mobile.

## Styling rules (NO arbitrary Tailwind brackets)

`rounded-[17px]`, `text-[17px]`, `px-[17px]`, `w-[922px]`, `font-[440]`, `bg-[var(--surface-default)]` — **forbidden**. Composites already bake in the right spacing; your frame almost never needs raw utility classes at all. When you do:

| Intent | Use | Never write |
|---|---|---|
| Body / system text | `text-body-large`, `text-body`, `text-body-small`, `text-system-large`, `text-system`, `text-system-medium`, `text-system-small`, `text-callout`, `text-caption` | `text-[17px] leading-[24px]` |
| Headings | `text-title-large`, `text-title-1`, `text-title-2`, `text-title-3` | `text-[56px] font-[660]` |
| Font weight | `font-normal` (440), `font-medium` (540), `font-bold` (650) | `font-[440]` |
| Corner radius | `rounded-square`, `rounded-square-x2`, `rounded-circle`, `rounded-circle-x2`, `rounded-bubble` | `rounded-[17px]` |
| Control height | `h-control-sm`, `h-control-md`, `h-control-lg` | `h-[28px]` |
| Shadow / elevation | `shadow-elevation-01`…`04` | `shadow-[0_1px_2px_...]` |
| Gutter / section padding | `p-gutter`, `px-gutter`, `py-gutter-sm` (also `gap-control-gap-sm/md/lg`) | `px-[17px] py-[48px]` |
| Font family | `font-display`, `font-text`, `font-mono` | inline font-family |

Additional rules:
- **Never hardcode hex, rgb, or hsl.** Colors come from tokens defined in `{{ARCADE}}/src/tokens/generated/light.css` and `dark.css`.
- **Never invent a token name.** Common hallucinations: `--border-default`, `--surface-default`, `--text-primary`. These don't exist; CSS silently resolves them to unset and you get black borders and black text. Canonical groups:
  - Text: `--fg-neutral-prominent` (primary), `--fg-neutral-subtle` (secondary/description), `--fg-neutral-medium`, `--fg-neutral-on-prominent` (text on dark fills).
  - Strokes (borders): `--stroke-neutral-subtle` (Figma's "Stroke / Subtle"), `--stroke-neutral-medium`, `--stroke-neutral-prominent`. **There is no `--border-*`.**
  - Surfaces: `--surface-backdrop`, `--surface-overlay`, `--surface-shallow`. **There is no `--surface-default`.**
  - Backgrounds: `--bg-neutral-prominent`, `--bg-neutral-medium`, `--bg-neutral-soft`, `--bg-neutral-subtle`, `--bg-neutral-inverted`.
  - Control hovers/actives: `--control-bg-neutral-subtle-hover`, `--control-bg-neutral-subtle-active`.
  - Component tokens: Arcade now ships per-component tokens — e.g. `--component-button-bg-primary`, `--component-input-stroke`, `--component-modal-surface`, `--component-toggle-track-on`. Prefer these when styling a known arcade component; fall back to the neutral groups above only when no component token exists. See `{{ARCADE}}/src/tokens/generated/component.css` for the full list.
- Figma → token mapping: `Stroke / Subtle` → `--stroke-neutral-subtle`; `Foreground / Secondary` (and any gray secondary text) → `--fg-neutral-subtle`; `Foreground / Primary` → `--fg-neutral-prominent`.
- Current theme: **{{THEME}}**.
- When Figma reports a value like 17px that does NOT map to a named token, the design likely intends the nearest token — pick the closest `rounded-square` / `text-body-large` / `h-control-md` rather than hard-coding the off-grid pixel.

Two paths are available read-only via `--add-dir`: `{{ARCADE}}` (the arcade-gen source — component stories, icon barrel, token CSS) and `{{PROTOTYPER}}` (this studio's prototype-kit composites + templates). Use Glob/Grep/Read on both freely. Do NOT edit anything inside either.

## Reading Figma

Use **`figmanage`** — a standalone CLI that reads Figma via the REST API over HTTPS. It is authenticated once on the host machine and has no dependency on Figma Desktop, WebSocket plugins, or any local app. Every invocation is reliable and bounded. Do NOT use the `figma-console` MCP server, and do NOT use `figma-cli` (the WebSocket one) — both are blocked or broken here.

Canonical first read (do this ONCE per frame):

```
figmanage reading get-nodes --depth 4 --json <FILE_KEY> <NODE_ID>
```

- Parse the FILE_KEY and NODE_ID from the Figma URL: `https://www.figma.com/design/<FILE_KEY>/<name>?node-id=<NODE_ID>&…`. The node id in the URL uses `-` (e.g. `131-4224`); pass it through verbatim — figmanage accepts either `131-4224` or `131:4224`.
- The response JSON gives you: every node's `id`, `name`, `type`, geometry, styles, `characters` (full text, not truncated), and for every `INSTANCE`, its `componentProperties` (variants + overrides).
- **Do NOT go beyond `--depth 4` on the outer frame.** See "Handling large trees" below for how to zoom into sections.
- Do NOT run parallel Figma queries.
- For a pixel-accurate screenshot of the whole frame: `figmanage export nodes --format png --scale 2 --json <FILE_KEY> <FRAME_NODE_ID>` — fetch the returned URL with `curl` and `Read` the PNG. Use the PNG as ground truth when the JSON alone is ambiguous.
- For icon exports (batch): `figmanage export nodes --format png --scale 2 --json <FILE_KEY> <ICON_ID_1> <ICON_ID_2> …`.

### Implement the WHOLE frame, including app chrome

If the Figma frame contains a sidebar, a page header with breadcrumbs, a topbar, or a title bar, **those are part of the design and must be implemented.** Do NOT render only the settings content / form body and call it done — that ships a floating fragment instead of the screen the designer drew.

Typical DevRev desktop app structure (from the outermost frame inward):

- `Desktop App` (outer 1680×1050 window) → **`AppShell`** (or a template that wraps it)
  - `Title Bar With Tabs` → **`TitleBar`** — this is NOT cosmetic. The title bar spans the FULL width at the top and contains traffic lights + collapse on the left, and back/forward + search/bell/avatar on the right. Implement it.
  - `Content Area` (below the title bar)
    - `Sidebar / My Work + Teams + Multiplayer Sidebar` → **`NavSidebar`** (NOT `arcade.Sidebar`). The sidebar does NOT contain traffic lights or the collapse button — those are in the TitleBar above it.
    - `Page` column containing:
      - `Breadcrumb Bar` (breadcrumb row + any page-level actions like a "More" button) → **`BreadcrumbBar`**
      - `Page Body` → **`PageBody`** with your content inside (settings pages: `SettingsCard` stack)

The divider in this layout is between `BreadcrumbBar` and `PageBody` (rendered by `AppShell` automatically). There is NO divider between TitleBar and BreadcrumbBar, and NO border between the sidebar and the body — the surface color change (sidebar is `--surface-shallow`, body is `--surface-overlay`) is the separator.

The prototype-kit composites map 1-to-1 to these Figma frames. Read the relevant subtrees from Figma for each piece — sidebar items, breadcrumb segments, header icons — the same way you read the content. **Never invent sidebar items or breadcrumb labels.**

### Handling large trees — READ THIS CAREFULLY

Every tool result you receive is held in your context and counted against your turn budget. A Figma subtree is VERY token-heavy (hundreds of KB of nested JSON). One oversized read can spend the entire remaining budget and leave you unable to finish the frame. Follow this depth ladder and do not deviate:

1. **Always start with `--depth 4`** on the outer frame id from the URL. This shows the page's major section layout (sidebar, header, body), each section's node id, and enough text/props to identify components.
2. **Only drill deeper if you have a specific question** about a specific section — "what are the exact sidebar items?" or "what does this settings row label say?". Then do ONE focused `--depth 5` read on that subtree's node id. Never the whole frame again.
3. **Never use `--depth 6` or higher.** If `--depth 5` on a subtree is still too sparse, it means that subtree itself is huge — pick a smaller child inside it and re-read that.
4. **Never re-read the same node at a higher depth.** If depth 4 wasn't enough for some part of the frame, read a smaller child, not the whole thing again.

Rule of thumb: if a tool result is longer than ~2000 lines, you have already over-read. The next call should be narrower, not deeper. No parallel Figma calls ever.

### Component instances and prefixed IDs

Nodes of type `INSTANCE` have children whose ids are returned in prefixed form, e.g. `I11001:63530;4304:43729` (instance-id;symbol-child-id). **Use those ids verbatim if you need to drill further — never peel off the `I…;` prefix, and never reconstruct it manually.** A bare symbol id like `4304:43729` is NOT a navigable node.

### Reading instance overrides (variant + label + icon)

The JSON you get from `figmanage reading get-nodes` already contains everything you need:

- `node.componentProperties` — the variant / boolean / text properties the designer picked. The `value` field is what to render (e.g. `{"Kind": {"value": "Primary", "type": "VARIANT"}}`).
- TEXT descendants inside the instance carry their real `characters` — never truncated.

No separate eval call is required. If an instance's props are missing, re-read with a higher `--depth`.

### Picking the right building block for a Figma instance

For each Figma frame or instance, walk UP the three layers until you find a match:

1. Does the **whole Figma frame** look like a known page shape? → use a **template** (`SettingsPage`, etc.).
2. Does the **chrome piece** (sidebar, header, card group, row) have a matching **composite**? → use it (`NavSidebar`, `PageHeader`, `SettingsCard`, `SettingsRow`).
3. Does the **leaf control** (button, toggle, avatar, input) have a matching **arcade primitive**? → use it (`Button`, `Switch`, `Avatar`, `Input`).

Figma → prototype-kit hints:

| Figma name contains | Use |
|---|---|
| Sidebar / My Work + Teams + Multiplayer Sidebar (or any DevRev SoR app sidebar) | `NavSidebar` |
| _Sidebar / Computer sidebar (chat/agent UI with New Chat + chat history) | `ComputerSidebar` |
| Computer Input Field / chat command bar / "Ask me anything" pill | `ChatInput` |
| Top bar with conversation title + chevron + right-side action cluster (Computer chat) | `ComputerHeader` |
| Right-side panel with step progress + grouped artefacts (Created / Sources / Folders) | `CanvasPanel` |
| Empty-state chat with a faded Computer logomark centered in the body | `ChatEmptyState` |
| Chat transcript with sender/receiver bubbles and agent "Thought for Xs" / expanded Working steps | `ChatMessages` |
| Title Bar With Tabs / Desktop TitleBar | `TitleBar` |
| Breadcrumb Bar / Page Header (breadcrumb row above body) | `BreadcrumbBar` |
| Page Body | `PageBody` |
| Desktop App / Content Area | `AppShell` |
| Form / Section, Contained Group of settings | `SettingsCard` |
| Contained Row / … (settings row) | `SettingsRow` |

Figma → arcade hints (leaves):

| Figma name contains | Start with |
|---|---|
| Button / Primary, Button / Secondary, Button / Default | `Button` (check `variant` against Figma `Kind`/`Intent`) |
| Button / Link, Link | `Link` |
| Toggle / Action / OnOff, Switch | `Switch` |
| Toggle / Segmented, ToggleGroup | `ToggleGroup` |
| Input, TextField | `Input` |
| Textarea | `TextArea` |
| Checkbox | `Checkbox` |
| Radio | `Radio` |
| Select, Dropdown / Select | `Select` (compound — `Select.Root`) |
| Tabs | `Tabs` (compound) |
| Breadcrumb | `Breadcrumb` (compound) |
| Tag, Chip | `Tag` |
| Badge | `Badge` |
| Avatar | `Avatar` |

### When a read fails, STOP — do NOT invent content

This is the hardest rule in this file. **Every field label, section heading, option name, placeholder, and button caption in your frame must come from a specific text node you actually read from the Figma tree.** If you could not read it, you cannot write it.

Forbidden:
- Inferring "probably this is a Temperature slider" because it looks like an LLM settings page.
- Filling in field names from general domain knowledge (e.g. "Max tokens", "Top-p", "Context window").
- Substituting placeholder copy ("Enter name…", "Select an option") for real labels you didn't read.
- Inventing section names like "Configuration / Memory / Privacy" that do not appear verbatim in the tree.
- Inventing right-hand labels for settings rows (`Claude`, `Sonnet`, `Adaptive`, `Budget`) because you saw a button shape but never resolved the instance's text override.

If after per-section reads you still cannot see the actual text content, STOP and tell the designer exactly which node failed and what you tried. A half-real frame with invented labels is worse than no frame.

Every Bash call is pre-approved. Never say "I need approval" — just run the command.

## Where things live

- Frames: `frames/<slug>/index.tsx`. Default-export a React component. Name directories with a two-digit prefix (`01-welcome`, `02-signup`, ...).
- Shared primitives: `shared/`.
- Local overrides: `theme-overrides.css`. Never touch arcade-gen source. Never install packages.

## Tools

- `Read`, `Write`, `Edit`, `Glob`, `Grep` — filesystem inside this project AND read-only in arcade-gen (`{{ARCADE}}`) and the studio prototype-kit (`{{PROTOTYPER}}/studio/prototype-kit/`).
- `Bash` — pre-approved, no confirmation required. Use it for `figmanage` calls. The `figma-console` MCP server is disabled.

## DevRev API integration (optional)

If this project has DevRev integration enabled, a `shared/devrev.ts` helper module will exist in the project directory. Check for it with `Read shared/devrev.ts` before using.

### Available functions

The helper exports 14 functions corresponding to DevRev REST endpoints:

- `listWorks(args)` — List work items (issues, tickets, tasks)
- `getWork(id)` — Get a single work item by ID
- `createWork(args)` — Create a new work item
- `updateWork(args)` — Update a work item
- `listAccounts(args)` — List accounts
- `listConversations(args)` — List customer support **conversations** (NOT DevUser chats with Computer — see terminology note below)
- `self()` — Get the current user
- `listDevUsers(args)` — List dev users
- `listParts(args)` — List parts (products, capabilities, features)
- `listRevOrgs(args)` — List rev orgs
- `listTags(args)` — List tags
- `countWorks(args)` — Count works matching a filter
- `listEngagements(args)` — List engagements
- `listLinks(args)` — List links between objects

Each function returns `Promise<unknown>`. Cast the result to the expected shape (e.g., `{ works: Array<{id: string, title: string, ...}> }`).

### Usage pattern

```tsx
import { listWorks } from "../shared/devrev";

export default function MyTicketDashboard() {
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listWorks({ type: ["ticket"], limit: 20 })
      .then((data: any) => {
        setTickets(data.works || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading tickets...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h1>My Tickets ({tickets.length})</h1>
      <ul>
        {tickets.map((t) => (
          <li key={t.id}>
            {t.display_id}: {t.title} — {t.stage.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Terminology: chat vs conversation vs work item

DevRev has three distinct object types, and getting them confused produces the wrong UI. Pick carefully:

- **Chat (`chats.*`)** — DevUser ↔ Computer threads and DevUser ↔ DevUser DMs. This is what users mean by "my chats with Computer", "my messages", "conversational data", "chat history", "threads with the AI", or anything about their own dialogue with agents or teammates. **If the user says "conversational" or "conversation" in casual speech and they work at DevRev, they almost always mean CHAT.**
- **Conversation (`conversations.list`)** — customer support conversations. A RevUser (customer) messages a support queue / portal; DevUsers reply. This is NOT a DevUser's personal chat history. Use this only when the user explicitly says "customer conversations", "support", "inbox", or "RevUser messages".
- **Work item (`works.list`)** — issues, tickets, tasks, bugs. Use only when the user explicitly says "ticket", "issue", "bug", "task", or "work item".

If you are uncertain which the user meant:
1. If they mention Computer, an AI agent, or their own chat/message history → **chat**.
2. If they mention a customer or support inbox → **conversation**.
3. If they mention tickets/bugs/issues → **work item**.

When in doubt and the user works at DevRev (which is almost always the case for Arcade Studio), default to **chat** for anything that sounds dialogue-shaped.

### Fetching chats (the DevUser's own threads)

`chats.*` and `timeline-entries.*` are **internal** (not public/beta) DevRev endpoints. They are NOT wrapped in the generated `shared/devrev.ts` helper. Call the proxy directly at the `/api/devrev/internal/*` path — **do not** use `/api/devrev/chats.list` (public path, 404s):

```tsx
async function listMyChats(limit = 20) {
  // Lists the current DevUser's DMs (Computer chats + DevUser↔DevUser threads).
  // The proxy injects auth server-side; the PAT identifies the caller.
  const res = await fetch("/api/devrev/internal/chats.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dm: { is_default: false },
      sort_by: ["modified_date:desc"],
      type: ["dm"],
      limit,
    }),
  });
  if (!res.ok) throw new Error(`chats.list failed: ${res.status}`);
  return res.json() as Promise<{ chats?: Array<Record<string, unknown>> }>;
}

async function listChatMessages(chatId: string) {
  const res = await fetch("/api/devrev/internal/timeline-entries.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object: chatId }),
  });
  if (!res.ok) throw new Error(`timeline-entries.list failed: ${res.status}`);
  return res.json() as Promise<{ timeline_entries?: Array<Record<string, unknown>> }>;
}
```

Notes:
- The endpoint is `/api/devrev/internal/chats.list`, not `/api/devrev/chats.list`. Same for timeline entries. The proxy forwards whatever path comes after `/api/devrev/` to `https://api.devrev.ai/…`, so `internal/…` resolves to `https://api.devrev.ai/internal/chats.list`.
- `sort_by: ["modified_date:desc"]` puts the most recently active threads first — the natural order for a chat list.
- `dm: { is_default: false }` excludes the default/system DM channel; pass `true` (or omit) if you want to include it.
- `type: ["dm"]` limits to direct-message threads (Computer chats + DM with teammates). Omit `type` for all chat kinds.
- Timeline entries returned by `/internal/timeline-entries.list` carry message bodies, system events, attachments. Filter on `type === "timeline_comment"` to get just the messages when rendering a transcript.
- If these internal endpoints return 401/403, the PAT may not have access — surface the error in the UI (don't silently fall back to mock data). Do NOT fall back to `conversations.list`; those are customer support conversations, a different object type.

### Fetching customer conversations (support inbox)

Only use when the user explicitly asks about customer support, RevUser threads, or a support inbox. Uses the wrapped `listConversations` helper plus `timeline-entries.list` for messages — same shape as the chat pattern above but calling `/api/devrev/conversations.list`.

### Fetching a vista (sprint board)

A **vista** in DevRev is a sprint board: a named container that groups work items into sprints (aka "group items" in the API). When a user says "the Design System sprint board", "our Q2 sprint", "the roadmap vista", they are describing a vista.

**Endpoint:** `/api/devrev/vistas.get` — **public** path, not `/internal/`. Do NOT invent `/vistas.query`, `/vistas.list`, or `/internal/vistas.*`; none of those exist and they all 404.

**ID format:** the URL `https://app.devrev.ai/devrev/vistas/vista-12556` encodes the display ID (`vista-12556`). The API wants a full DON:

```
don:core:dvrv-us-1:devo/0:vista/12556
```

(drop the `vista-` prefix, prepend the DON scheme). If you're unsure about `devo/0` vs `devo/<id>`, `devo/0` works for the caller's own org.

**Fetching the works inside the vista** is a two-step flow:

```tsx
async function listVistaWorks(vistaDisplayId: string) {
  // 1. Resolve the vista to learn its sprint group IDs.
  const vistaDon = `don:core:dvrv-us-1:devo/0:vista/${vistaDisplayId.replace(/^vista-/, "")}`;
  const vRes = await fetch("/api/devrev/vistas.get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: vistaDon }),
  });
  if (!vRes.ok) throw new Error(`vistas.get failed: ${vRes.status}`);
  const { vista } = (await vRes.json()) as {
    vista: { group_items?: Array<{ id: string }> };
  };
  const sprintIds = (vista?.group_items ?? []).map((g) => g.id);

  // 2. Filter works.list by the sprint-group custom field.
  const wRes = await fetch("/api/devrev/works.list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: ["issue", "ticket"],
      "custom_fields.tnt__sprint_group": sprintIds,
      limit: 50,
    }),
  });
  if (!wRes.ok) throw new Error(`works.list failed: ${wRes.status}`);
  return (await wRes.json()) as { works?: Array<Record<string, unknown>> };
}
```

Notes:
- The field name `custom_fields.tnt__sprint_group` is the canonical sprint-group filter across most DevRev orgs; if your org customized it, the DON of any group item still works as an ID you can pass.
- If the user didn't provide a vista URL, ask for one — vistas are per-org data and guessing names never resolves.
- Surface the error if either call fails; do NOT fall back to mock data.

### Filtering and pagination

Most list endpoints accept filter args (dot-notation supported for nested filters):

```tsx
// Filter by stage name
listWorks({ type: ["issue"], "stage.name": ["triage", "in_progress"], limit: 50 })

// Pagination: use next_cursor from response
const response: any = await listWorks({ limit: 50 });
const nextPageResponse: any = await listWorks({ limit: 50, cursor: response.next_cursor });
```

### Mutations (create, update)

Write operations skip the cache and require specific fields:

```tsx
// Create a new issue
await createWork({
  title: "API timeout in payments service",
  type: "issue",
  applies_to_part: "PROD-123",
  owned_by: ["DEVU-456"],
});

// Update a work item
await updateWork({
  id: "ISS-789",
  title: "Updated title",
  "stage.name": "done",
});
```

### Error handling

All functions throw on network errors or non-2xx responses. Wrap calls in try/catch or `.catch()`.

### When to use DevRev data

Only fetch DevRev data when the designer explicitly asks for it ("show my tickets", "list accounts", "dashboard of open issues"). Do NOT fetch data speculatively or for generic UI mockups. If the designer does not mention DevRev data, build a static prototype with hardcoded content.

## When you're done

After writing a frame, stop. Do not write follow-up markdown, do not summarize what you did, do not start another frame unsolicited.
