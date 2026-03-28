# DevRev Design System — Stitch Guide

> Free-form design instructions for Google Stitch prototyping.
> Consumed by the `designMd` field in the Stitch design system theme.

---

## Brand Identity

DevRev ships **two visual themes** on a shared component library:

| Theme | Products | Character |
|-------|----------|-----------|
| **Arcade** | Computer, Agent Studio, Marketplace | Warm, achromatic base with fruit-named accent palettes. Playful personality with "plastic" button effects and custom easing. |
| **DLS (DevRev App)** | SoR, Apps, Build | Professional, cool blue-indigo accent. Systematic HSL primitives with 22-step neutral scale. |

Default to **Arcade** (dark mode) unless specified otherwise.

---

## Typography

### Font Families
- **Primary (sans-serif):** System stack — `-apple-system, BlinkMacSystemFont, var(--font-inter), Segoe UI, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif`
- **Monospace:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- **For prototyping (Chip fonts):** Chip Display Variable (headings), Chip Text Variable (body/UI), Chip Mono (code)

Since Stitch cannot load Chip or the system stack, use **DM Sans** for both headline and body — it shares the geometric-humanist character.

### Font Weights (Variable Font `wght` axis)
- **440** — normal (regular text, captions, system labels)
- **540** — medium (emphasized body, medium labels, button text)
- **660** — bold (headings, titles, bold variants)

Never use 400/500/700. These are variable font axis values, not CSS standard weights.

### Type Scale

| Style | Size | Weight | Line Height | Letter Spacing |
|-------|------|--------|-------------|----------------|
| `text-title-large` | 2.125rem (34px) | 660 | 2.375rem (38px) | — |
| `text-title-1` | 1.8125rem (29px) | 660 | 2rem (32px) | — |
| `text-title-2` | 1.5rem (24px) | 660 | 2rem (32px) | — |
| `text-title-3` | 1.25rem (20px) | 660 | 1.75rem (28px) | — |
| `text-body-large` | 1.125rem (18px) | 440 | 1.625rem (26px) | -0.015em |
| `text-body` | 1rem (16px) | 440 | 1.5rem (24px) | -0.0175em |
| `text-body-small` | 0.875rem (14px) | 440 | 1.375rem (22px) | — |
| `text-system` | 0.875rem (14px) | 440 | 1.25rem (20px) | — |
| `text-callout` | 0.8125rem (13px) | 440 | 1.25rem (20px) | -0.02em |
| `text-system-small` | 0.75rem (12px) | 440 | 1rem (16px) | — |
| `text-caption` | 0.6875rem (11px) | 440 | 1rem (16px) | — |
| `text-code` | 0.875rem (14px) | 440 | 1.25rem (20px) | monospace font |

Every style has `-medium` (wt 540) and `-bold` (wt 660) variants (e.g. `text-body-medium`, `text-body-bold`).

### Device-Specific Typography Adjustments
- **Web:** 16px base, title-large 1.625rem, body tracking -0.0175em
- **Desktop app:** 15px base, title-large 1.932rem, body tracking -0.03em
- **Mobile:** 17px base, title-large 2rem, body tracking -0.03em

---

## Color Palette

### Arcade Theme (default)

**Base primitives:**
- `--day`: `0 0% 100%` (pure white)
- `--night`: `0 0% 6%` (near-black, dark theme base)

**Neutral scale (Husk) — 13 stops:**
The husk palette is NOT pure gray — mid-range stops carry a subtle warm-purple tint:

| Token | HSL | Character |
|-------|-----|-----------|
| husk-100 | `0 0% 100%` | Pure white |
| husk-200 | `0 0% 98%` | Near-white |
| husk-300 | `0 0% 96%` | Light gray |
| husk-400 | `0 0% 91%` | Soft gray |
| husk-500 | `0 0% 81%` | Medium-light gray |
| husk-600 | `320 2% 64%` | Warm mid-gray (purple tint) |
| husk-700 | `312 2% 47%` | Warm dark-gray |
| husk-800 | `324 3% 31%` | Dark gray |
| husk-900 | `330 2% 24%` | Very dark gray |
| husk-1000 | `330 2% 18%` | Near-black warm |
| husk-1100 | `330 3% 13%` | Deep dark |
| husk-1200 | `0 6% 9%` | Darkest warm |
| husk-1300 | `0 0% 9%` | Darkest neutral |

**Fruit-named accent scales (6 stops each, 100–600):**

| Name | Hue Range | Role | 400-step (dark mode primary) |
|------|-----------|------|------------------------------|
| **Banginapalli** | 48–55 (golden/yellow) | Primary action, CTAs | `48 100% 51%` |
| **Jabuticaba** | 259–270 (deep purple) | AI / intelligence | `259 94% 44%` |
| **Shuiguo** | 197–199 (cyan/blue) | Links, developer objects | `198 100% 64%` |
| **Hardy** | 89 (lime/green) | Success, customer, runnable | `89 100% 64%` |
| **Persimmon** | 13 (orange-red) | Database, product, incident | `13 100% 60%` |
| **Dragonfruit** | 346 (pink-magenta) | Destructive actions | `346 98% 58%` |
| **Maoshigua** | 196–225 (sky/teal) | Topics, special cards | `225 91% 59%` |

**Dynamic color aliases:**
- `--action` → banginapalli (golden yellow) by default
- `--intelligence` → jabuticaba (deep purple) by default
- Theme variant `data-arcade-theme='dragonfruit'` swaps: action → hardy (green), intelligence → dragonfruit (pink)

### DLS (DevRev App) Theme

**HSL primitives:**
- Accent: `H:237 S:81% L:56%` (blue-indigo, ~`#4068F9`)
- Neutral: `H:228 S:10%` (cool blue-gray, 22 stops from 80–1000)
- Alert: `H:360 S:72%` (red)
- Warning: `H:47 S:74%` (yellow)
- Success: `H:135 S:55%` (green)
- Smart: `H:256 S:94%` (purple)

### Semantic Color Tokens (both themes)

**Dark mode:**
- Primary text: `--day` (white)
- Secondary text: `--husk-600` / `neutral-740` (warm mid-gray)
- Tertiary text: `--husk-400` / `neutral-940`
- Links: shuiguo-500 / accent-500
- Muted text: `--husk-700` / `neutral-480`

**Light mode:**
- Primary text: `--husk-900` / `neutral-120` (near-black)
- Secondary text: `--husk-700` / `neutral-360`
- Links: shuiguo-600 / accent-600

**Feedback colors (dark → light):**
- Alert: dragonfruit-400 → dragonfruit-500
- Warning: banginapalli-400 → banginapalli-500
- Success: hardy-400 → hardy-500
- Smart/AI: jabuticaba-400 → jabuticaba-500

---

## Background Layers

Backgrounds use a 5-layer depth system. In dark mode, deeper nesting = slightly lighter surface:

| Token | Dark (Arcade) | Light (Arcade) |
|-------|---------------|----------------|
| `layer-00` | `--night` (0 0% 6%) | `--husk-300` (0 0% 96%) |
| `layer-01` | `--husk-1000` (330 2% 18%) | `--day` (white) |
| `layer-02` | `--husk-900` (330 2% 24%) | `--day` (white) |
| `layer-03` | `--husk-900` | `--day` |
| `layer-04` | `--husk-900` | `--day` |

---

## Spacing

### Phi-Ratio Scale (1.41x multiplier, 16px base)

| Token | Value | Common Use |
|-------|-------|------------|
| 5xs | 2px (0.125rem) | Hairline gaps |
| 4xs | 2.7px (0.17rem) | Tight inline spacing |
| 3xs | 4px (0.25rem) | Badge padding, compact gaps |
| 2xs | 5.6px (0.35rem) | Small component padding |
| xs | 8px (0.5rem) | Default inline gap, input internal padding |
| sm | 11.2px (0.7rem) | Component internal padding |
| base | 16px (1rem) | Standard gap, card padding |
| lg | 22.6px (1.41rem) | Section spacing |
| xl | 32px (2rem) | Major section breaks |
| 2xl | 45.3px (2.83rem) | Page-level spacing |
| 3xl | 64px (4rem) | Hero spacing |
| 4xl | 90.4px (5.65rem) | Large hero areas |
| 5xl | 128px (8rem) | Full-bleed sections |

**Page gutters:** `--page-gutter`: 2.25rem (36px), `--side-panel-gutter`: 1rem (16px)

---

## Border Radius

The system uses a specific set of radius values — not arbitrary:

| Tailwind Class | Value | Used By |
|----------------|-------|---------|
| `rounded` | 4px | Checkbox, chip/tag (default) |
| `rounded-md` | 6px | Small buttons (S), small icon buttons |
| `rounded-lg` | 8px | Medium buttons (M), inputs, icon buttons, accordion |
| `rounded-lg2` | 10px | Popovers, compact cards |
| `rounded-xl` | 12px | Normal-density cards |
| `rounded-2xl` | 16px | Spacious cards, select popovers |
| `rounded-[25%]` | 25% | Square avatars |
| `rounded-full` | 50% / 9999px | Circle avatars, badges, toggles |

---

## Components

### Buttons
- **Arcade: Pill-shaped** (`rounded-full` / 9999px). This is an Arcade override — DLS uses `rounded-lg` (8px) for M, `rounded-md` (6px) for S.
- **Sizes:** S (min-height 24px, px 6px), M (min-height 32px, px 8px), L (py dynamic-xs, px dynamic-base)
- **Variants:** primary, secondary, tertiary, destructive, smart
- **Text weight:** 540 (medium) via `text-body-small-medium` (M) or `text-system-small` (S)
- **Primary button (Arcade dark):** White background, near-black text at rest. Shifts to action color (golden) on hover/press. Hover adds `scale-105`, active resets to `scale-100`.
- **Primary button (DLS dark):** Uses `--bg-interactive-primary-*` tokens. No scale transform.
- **Arcade "plastic" effect:** Primary buttons get a multi-layer box-shadow on hover — outer shadow + inset highlight + inset bottom shadow — creating a 3D embossed look. Uses custom `ease-glide` easing over 400ms.
- **States:** resting → hovered → pressed → focused → disabled. All transitions use `ease-in-out duration-300`.
- **Focus:** `shadow-interactive-focused` ring.
- **Outline:** All buttons carry `outline outline-1 -outline-offset-1`.

### Icon Buttons
- **Size M:** 32x32px, padding 6px, `rounded-lg` (8px) for square, `rounded-full` for circle
- **Size S:** 24x24px, padding 4px, `rounded-md` (6px) for square
- **Separator:** 1px wide, 16px tall divider line

### Cards
- **Border radius varies by density:**
  - Compact: `rounded-[10px]` (10px), padding 12px horizontal / 8px top / 12px bottom, gap 8px
  - Normal: `rounded-xl` (12px), padding 16px horizontal / 12px vertical, gap 12px
  - Spacious: `rounded-2xl` (16px), padding 16px all, gap 12px
- **Visual:** `outline outline-1 -outline-offset-1 outline-outline-01`, background `bg-layer-02`, shadow `shadow-depth-01`
- **Expandable** modifier available

### Text Inputs
- **Border radius:** `rounded-lg` (8px)
- **Structure:** Flex wrapper with 6px gap between icon and content
- **Padding:** wrapper px 8px, input py 4px
- **Background:** `bg-input-text-resting` (dark: husk-1000, light: white)
- **Focus:** `shadow-interactive-focused bg-input-text-pressed outline-input-text-pressed`
- **Feedback states:** info (accent), smart (purple), success, error (alert/dragonfruit), warning
- **Font variants:** h1, h2, h3, large, default, small — map to typography tokens

### Select / Popover
- **Popover container:** `rounded-lg2` (10px), `bg-layer-01`, `shadow-depth-02`, `outline-outline-01`
- **Select dropdown:** `rounded-2xl` (16px), `bg-layer-01`, `shadow-depth-03`, max-height 240px
- **Arrow:** fill matches `bg-layer-01` with drop shadow
- **Max width variants:** 320px, 480px, 720px

### Badges
- **Shape:** `rounded-full` (pill), always
- **Padding:** py 2px, px 6px, min-width 16px
- **Text:** `text-caption-medium` (11px, weight 540)
- **Outline:** `outline outline-1 -outline-offset-1 outline-transparent`
- **Variants:** alert (red bg, white text), accent (action bg, white text), smart (purple bg, white text), warning (yellow bg, black text), neutral (10% opacity bg, neutral text), inverted, mini (no background)

### Chips / Tags
- **Default shape:** `rounded` (4px) — NOT pill by default
- **Pill mode:** `rounded-full` when `isRounded=true`
- **Padding:** py 4px, px 6px
- **Text:** `text-caption-medium`
- **Variants:** Same as badge plus success

### Avatars
- **Base size:** 48px (all others scale from this via CSS `scale()` transforms)
- **Available sizes:** 12, 16, 20, 24, 28, 32, 36, 48, 64, 72, 96, 128, 160, 224, 256px
- **Shapes:** circle (`rounded-full`), square (`rounded-[25%]`)
- **Background:** `bg-surface-backdrop/80`
- **Initials text:** 24px, `text-color-secondary`
- **Status indicator:** 12x12px dot, top-right position
  - Online: `bg-feedback-success`
  - Away: outline with neutral background

### Toggles
- **Dimensions:** 28px wide x 16px tall (NOT 36x20)
- **Shape:** `rounded-full` (pill)
- **Thumb:** 12x12px circle, 2px offset from left edge
- **Outline:** `1.5px`, offset `-1.5px`
- **Active:** `bg-input-select-active` (action color), thumb translates right
- **Animation:** `duration-100`
- **Disabled:** `opacity-40`

### Checkboxes
- **Size:** 16x16px
- **Border radius:** `rounded` (4px)
- **Outline:** 1.5px with -1.5px offset
- **Checked:** `bg-input-select-active`, white checkmark, hover scales to 110%
- **Unchecked:** transparent bg, `outline-input-select-resting`

### Modals / Dialogs
- **Width presets:** 480px (default), 720px, 960px, 1080px, fullscreen
- **Z-index:** 85
- **Animation:** Entry 300ms ease-out (scale 0.98→1 + fade), exit 200ms ease-in
- **Overlay:** Semi-transparent backdrop

### Drawers
- **Direction:** top, right (default), bottom, left
- **Size:** auto, 1/3, 2/3, full
- **Z-index:** 85

### Tooltips
- **Styled (default):** `rounded-md` (6px), `bg-layer-00` (force-dark), px 8px, py 6px, `shadow-depth-01`, max-width xs (320px)
- **Raw (custom content):** `rounded-lg2` (10px), `bg-layer-01`, `shadow-depth-03`
- **Delay:** 300ms
- **Z-index:** 100

### Tables
- Subtle row hover with background shift
- Header: bold system text
- Cell padding: xs (8px) vertical, sm horizontal

### Toasts
- `bg-surface-backdrop/80 backdrop-blur-sm shadow-2xl rounded-xl`
- Floating notification with blur effect

---

## Shadows

| Token | Use |
|-------|-----|
| `depth-01` | Cards, subtle elevation (1-2px offset) |
| `depth-02` | Popovers, dropdowns |
| `depth-03` | Select panels, dialogs |
| `depth-04` | High-priority overlays, large modals |
| `interactive-focused` | Focus ring glow |
| `interactive-resting` | Baseline interactive element |
| `interactive-lifted` | Hover lift effect |
| `interactive-pressed` | Press-down effect |
| `pill` | Pill-shaped element shadow |
| `popover` | Popover-specific |
| `modal` | Modal-specific |

**Arcade plastic button shadows (hover):**
```
9px 15px 8px 0px hsla(0,0%,0%,0.02),
5px 10px 6px 0px hsla(0,0%,0%,0.07),
3px 4px 5px 0px hsla(0,0%,0%,0.06),
1px 1px 3px 0px hsla(0,0%,0%,0.08),
inset 1px 1px 3px 1px hsla(0,0%,100%,0.3),
inset -0.5px -0.5px 1.5px 0px hsla(0,0%,0%,0.4)
```

---

## Z-Index Stack

| Layer | Value |
|-------|-------|
| Tooltip | 100 |
| Menu | 95 |
| Popover | 90 |
| Modal / Drawer | 85 |

---

## Interaction & Motion

### Custom Easing — `ease-glide`
```css
linear(
  0, 0.012 0.9%, 0.049 2%, 0.409 9.3%, 0.513 11.9%,
  0.606 14.7%, 0.691 17.9%, 0.762 21.3%, 0.82 25%,
  0.868 29.1%, 0.907 33.6%, 0.937 38.7%, 0.976 51.3%,
  0.994 68.8%, 1
)
```
Used with `duration: 0.4s` for all Arcade interactive transitions.

### Standard Motion
- **Button/icon transitions:** `ease-in-out duration-300`
- **Toggle thumb:** `duration-100`
- **Slide animations:** `150ms ease-in-out` (slideDown, slideUp, slideLeft, slideRight + fade)
- **Modal entry:** 300ms ease-out (scale + fade)
- **Modal exit:** 200ms ease-in
- **Hover states:** Subtle background shift. Never color inversion.
- **Focus states:** `shadow-interactive-focused` ring
- **Loading:** Skeleton pulse animation, smart loading gradient (jabuticaba purple sweep)

---

## Breakpoints

| Name | Width |
|------|-------|
| small | 480px |
| sm-max | max 639px |
| medium | 960px |
| md-max | max 960px |
| hd | 1280px |
| large | 1440px |
| xl | 1680px |
| 2xl | 1920px |

---

## Layout Principles

1. **Layer-based depth:** Use background layers (00–04) for surface hierarchy. Dark mode: deeper nesting = slightly lighter. Light mode: layer-00 is gray, layers 01–04 are white.
2. **Information density:** DevRev UIs are data-dense. Compact layouts with clear hierarchy. Not marketing-spacious.
3. **Sidebar + main:** Standard layout is left sidebar (256px) + main content. Sidebar uses dark background with gradient nav overlay.
4. **Page gutters:** 36px page gutter, 16px side-panel gutter.
5. **Card grids:** Consistent gap using phi-scale tokens (base or lg).
6. **Sticky headers:** Navigation and page headers should be sticky.

---

## Dark Mode (default)

- Base background: `--night` (0 0% 6%)
- Text hierarchy: primary (white), secondary (warm mid-gray, husk-600), muted (husk-700)
- Borders: subtle, never stark white — use `outline-01` through `outline-03`
- Field stroke idle opacity: 0.35
- Accent colors use -400 stops for contrast on dark surfaces
- Fill opacity: 0.75
- Primary button: white bg, black text (inverts from light mode)
- Chat bubbles: receiver = white bg, sender = deep dark bg

## Light Mode

- Base background: `--husk-300` (0 0% 96%), surfaces: white
- Text hierarchy: primary (husk-900), secondary (husk-700), muted (husk-500)
- Field stroke idle opacity: 0.2 (more subtle than dark)
- Accent colors use -500/-600 stops for readability on light surfaces
- Fill opacity: 1.0
- Primary button: dark bg, white text

---

## Gradients

**Smart loading (Arcade):**
```css
linear-gradient(to right,
  hsla(var(--jabuticaba-400), 0),
  hsla(var(--jabuticaba-400), 1),
  hsla(var(--jabuticaba-400), 0))
```

**Navigation sidebar (dark):**
```css
linear-gradient(90deg,
  rgba(22,22,22,0) 35%,
  rgba(22,22,22,0.35) 70%,
  rgba(16,16,16,0.8) 100%)
```

---

## Voice & Content

- **UI copy:** Concise, direct, no filler. Sentence case for labels and buttons.
- **Headings:** Title case for page titles, sentence case for section headings.
- **Error messages:** Specific and actionable ("Email is required" not "Invalid input").
- **Empty states:** Friendly, brief. One line description + CTA.

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use pill-shaped (`rounded-full`) buttons in Arcade | Use `rounded-lg` (8px) buttons in Arcade (that's DLS) |
| Vary card radius by density (10/12/16px) | Use a single fixed radius for all cards |
| Use the phi spacing scale exclusively | Use arbitrary pixel values |
| Layer backgrounds for depth hierarchy | Use flat single-color backgrounds |
| Use DM Sans in Stitch (proxy for Chip) | Use Inter, Roboto, or other fonts |
| Use 440/540/660 font weights | Use 400/500/700 standard weights |
| Apply negative letter-spacing on body text | Leave letter-spacing at default |
| Keep dark mode as default | Default to light mode |
| Use fruit-palette accent colors by role | Invent new accent colors |
| Respect the warm-purple tint in husk grays | Use pure neutral grays |
| Give Arcade primary buttons the plastic shadow | Use flat button styling in Arcade |
| Use 1.5px outlines on toggles/checkboxes | Use thicker or thinner borders |
| Maintain information density | Create spacious marketing layouts |
