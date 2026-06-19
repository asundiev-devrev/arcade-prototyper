# Computer Chat — In-Content Pieces (Sub-project B) Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming → design)
**Predecessor:** Sub-project A (structural shell — responsive container, collapsible sidenav, canvas tabs, resizable panes), shipped on `feat/homepage-templates`. Spec: `2026-06-19-computer-chat-structural-design.md`.

## Goal

Borrow two **in-content** chat behaviors from the external prototype (`DeReGilz/responsive`, live at responsive-rosy-one.vercel.app/#/chat) into Arcade Studio's Computer chat composites: an **avatar popup menu** and an **artefact card** embedded in agent messages. Sub-project A gave us the shell; this fills the content.

## Background & decisions

The prototype offers six borrowable behaviors. Sub-project A took the three structural ones. The remaining three were "avatar popup menu, artefact card, overall style polish." During brainstorming the style-polish item collapsed into the artefact card, because the user chose **selective** style adoption with a precise scope:

- **Style direction:** *selectively borrow* — keep core surfaces + typography on DevRev `arcade-gen` tokens (so generated frames stay mergeable into `devrev-web`); adopt expressive flourishes only where they add value.
- **Expressive touches adopted:** the **fanned 3-page thumbnail** and the **pink card + red tag** — both contained entirely within the artefact card.
- **Expressive touches rejected:** the yellow send button (`#ffe000`), and the Chip variable-font weights (460/520/650). These would make frames visibly diverge from DevRev production for little functional gain.

Because every adopted style lives inside the artefact card, "style polish" is **not a separate work item**. Sub-project B = exactly two pieces:

1. **Avatar popup menu** — a modification of the existing `ComputerSidebar.User` footer.
2. **Artefact card** — a new `ArtefactCard.tsx` composite that drops into a `ChatMessages.Agent` body.

Neither depends on the other; both are reusable by the generator; they are wired together only in `ComputerScene`.

## Key prior-art facts (from prototype analysis)

- The prototype hand-rolls the avatar menu with `getBoundingClientRect` + `position: fixed` because it is vanilla JS. **We do not need this** — `@xorkavi/arcade-gen` ships a Radix-backed `DropdownMenu` (`Root / Trigger / Content / Item / Separator / Label / Group`) that anchors, portals out of `overflow:hidden`, and handles Esc / click-outside / focus for free.
- The prototype's responsive behaviors key off `@container main` (the whole main pane). Our equivalent target is the **chat column**, because its width shrinks when the canvas docks — exactly the behavior we want the card to react to.
- The card's `--stack-scale` is a CSS custom property **stepped at discrete container-query breakpoints**; Tailwind v4 arbitrary `@container` variants cannot set a custom property per breakpoint, so the card needs raw CSS.

---

## Piece 1 — Avatar popup menu

### Mechanism

Extend `ComputerSidebar.User` with one optional prop. When present, the avatar becomes a `DropdownMenu` trigger; Radix owns positioning and dismissal.

### API change

```tsx
type UserProps = {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  /** Render a green presence dot bottom-right of the avatar. Default true. */
  presence?: boolean;
  /** Menu contents (DropdownMenu.Item / .Separator children). When present the
   *  AVATAR becomes a menu trigger; when omitted the footer renders exactly as
   *  before (backward-compatible, no trigger, no behavior change). */
  menu?: ReactNode;
};
```

### Trigger scope (decided)

**Avatar only.** Only the avatar circle (the existing `<div className="relative shrink-0">` that holds the avatar + presence dot) is the trigger. Name/subtitle remain inert text. This is deliberately narrower than the prototype's whole-row `#profileMenuTrigger`. Works identically in the collapsed 64px rail, where only the avatar survives.

### Rendering

- `menu == null` → render the footer exactly as today.
- `menu != null` → wrap the avatar container in:
  ```tsx
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" aria-label="Account menu" className="relative shrink-0 …">
        {avatar}
        {presence ? <span …presence dot… /> : null}
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content side="top" align="start" sideOffset={4}>
      {menu}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
  ```
  `side="top"` reproduces "opens above the avatar"; `align="start"` left-aligns to the avatar; `sideOffset={4}` is the prototype's 4px gap.
- The presence dot must stay visually attached to the avatar inside the trigger button (same absolute positioning as today).

### Default menu contents (supplied by `ComputerScene`)

Mirrors the prototype's three groups, separated by `DropdownMenu.Separator`:

```
Group 1:  Settings · Help
──────────
Group 2:  Upgrade plan · Get mobile app
──────────
Group 3:  Log out
```

Each item is a `DropdownMenu.Item` with a leading 16px icon (use existing `arcade-gen` icons: `Gear`/settings, a question-mark/help, an up-arrow/upgrade, a tray-down/mobile, a tray-right/log-out — choose the closest available icons; exact icon identity is not load-bearing). `ComputerScene` passes this default so generated frames get it for free; the generator may override via the `menu` prop.

### Acceptance

- `User` with no `menu` prop renders identically to current (regression guard).
- `User` with a `menu` prop: clicking the avatar opens a menu containing the passed items; the items render with their labels; Esc / click-outside close it (Radix).
- Works in the collapsed rail (avatar-only) without extra code.

---

## Piece 2 — Artefact card

### New composite: `ArtefactCard.tsx` + co-located `ArtefactCard.css`

Drops into an agent message body:

```tsx
<ChatMessages.Agent thoughts={…}>
  Here's the launch brief I drafted:
  <ArtefactCard tag="DOC" title="Q3 launch brief" onOpen={() => …} />
</ChatMessages.Agent>
```

### Props

```tsx
type ArtefactCardProps = {
  /** Filetype label shown in the red tag pill, e.g. "DOC". */
  tag: string;
  /** Document title. */
  title: string;
  /** "Open in canvas" CTA handler. When omitted, the CTA is not rendered. */
  onOpen?: () => void;
};
```

### Layout

Flex row, `min-height: 152px`, **pink surface `#FFE5DB`**, border-radius 4px, horizontal padding 20px.

- **Left column** (`flex: 1`, the content):
  - Red filetype tag: `#FF342D` text, monospace-ish small caps, with a small document glyph rendered via CSS `mask` (so it picks up `currentColor` — an `<img>` would ignore the color). Use an inline SVG mask or a masked pseudo-element.
  - Title: the document title. On DevRev typography tokens (NOT Chip 650 — rejected). Use the closest existing heading token.
  - "Open in canvas" CTA: a soft-gray pill button (~28px tall, radius 4). Rendered only when `onOpen` is set. Clicking calls `onOpen`.
- **Right column** (the fanned thumbnail): `flex: 0 0 calc(410px * var(--stack-scale))`, holds `.artefact-card__stack`.

### Fanned 3-page thumbnail

Three absolutely-positioned page layers inside `.artefact-card__stack` (which is `transform: scale(var(--stack-scale)); transform-origin: top right`):

- **back** — `rotate(4deg)`, palest pink (≈70% white wash over `#FF342D`).
- **mid** — `rotate(-3deg)`, pale pink (≈75% white wash over `#FF342D`).
- **top/front** — `rotate(-6deg)`, white page with a small shadow, containing a tiny replica scene: an icon, a title line, a hairline rule, and 2–3 body lines (a miniature of "what opens in the canvas").

Each layer ≈316px wide, `aspect-ratio: 573/692`, radius 6px. Back/mid carry a soft shadow (a `::after` with `mix-blend-mode: multiply` per the prototype, or a plain box-shadow if blend-mode proves fragile in the iframe).

### Responsive — `ArtefactCard.css`

The card must sit inside a **named container** `@container/chat` (added to the chat column in `ComputerPage`; see Integration). The CSS file scopes all rules to the card's own class names.

**A. `--stack-scale` step-down** (drives both the right column's flex-basis and the inner stack transform):

| `@container chat (max-width: …)` | `--stack-scale` |
|---|---|
| base (>900px) | `1` |
| 900px | `0.92` |
| 820px | `0.82` |
| 680px | `0.7` |
| 540px | `0.58` |
| 420px | `0.5` |

**B. Snap-to-edges** at `@container chat (max-width: 900px)`:
- `border-radius: 0`
- negate the chat column's horizontal padding so the card goes flush edge-to-edge (`width: calc(100% + 2 * PAD); margin-inline: calc(-1 * PAD)` where `PAD` matches the chat column's horizontal padding). Width AND margin must be set together — negative margin alone will not stretch a `width:100%` block.

A transition on `border-radius / width / margin` (~40ms ease-out) is acceptable but not required; if added, suppress it on first paint to avoid an animated card on load.

### Acceptance

- Renders tag, title, and (when `onOpen` set) the CTA.
- `onOpen` fires when the CTA is clicked.
- CTA is absent when `onOpen` is omitted.
- At narrow container widths the thumbnail scales down (not horizontally squished) and the card snaps flush to the column edges.

---

## Integration

### `ComputerPage.tsx`

Add a **named container scope** to the chat column so the artefact card queries the column's width (which shrinks when the canvas docks):

```tsx
<div className="@container/chat flex-1 min-w-0 flex flex-col h-full bg-(--surface-overlay)">
```

This is additive: the root keeps its existing unnamed `@container` from Sub-project A; the chat column gets a *named* scope `chat`. The card's CSS queries `@container chat (...)`. Must not disturb Sub-project A's responsive shell.

### `ComputerScene.tsx`

- Pass a default `menu` to `<ComputerSidebar.User menu={…} />` (the three-group menu above).
- Place an `<ArtefactCard tag="DOC" title="Q3 launch brief" onOpen={() => setPanelOpen(true)} />` inside one of the agent messages, so the CTA opens the canvas pane (decided behavior; mirrors the prototype's `openCanvas()`).

### Barrel / examples

- Add `ArtefactCard` to the composites barrel so the generator can `import { ArtefactCard } from "arcade-prototypes"`.
- `ArtefactCard` is visible + self-contained → it gets a **real example** (renders a sample card) and therefore a thumbnail in the Assets panel. It does NOT go in `OPT_OUT.ts` (unlike `CanvasTabs`/`ResizeHandle`, which need runtime context).
- The avatar menu is a prop on an existing composite, not a standalone composite — no new export, no example.

## Testing

- **`ArtefactCard`**: (1) renders tag/title/CTA; (2) `onOpen` fires on CTA click; (3) CTA absent when `onOpen` omitted.
- **`ComputerSidebar.User`**: (1) no `menu` prop → renders as before, no trigger/menu in the DOM (backward-compat); (2) with `menu` → avatar is a trigger, items appear on open.
- The existing examples-coverage + assets-freshness guard tests enforce that a new visible composite has an example — satisfied by the real `ArtefactCard` example.

## Build / verify loop

Same as Sub-project A:
1. Edit composite → `pnpm run kit:build`.
2. Kill the dev server on :5556, `rm -rf node_modules/.vite`, restart, wait ~13s (avoids the `.vite` 504 stale-dep trap).
3. Live-review in the `computer-chat-review` project at wide / mid / narrow widths:
   - avatar menu: click the avatar, confirm the menu opens above it with the three groups; Esc closes.
   - artefact card: resize and confirm the thumbnail scales (not squishes) and snaps flush at ≤900px.

## Out of scope

- Yellow send button (`#ffe000`).
- Chip variable-font weights (460/520/650).
- Smooth (non-stepped) thumbnail scaling.
- Any change to Sub-project A's structural shell beyond adding the `@container/chat` scope.
