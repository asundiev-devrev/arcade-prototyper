# Arcade Prototyper

An agent skill for building interactive HTML prototypes with DevRev's real production design system. One command to install, one sentence from the user to generate a working prototype.

## Install

```bash
npx skills add asundiev-devrev/arcade-prototyper
```

## What it does

When a user asks to prototype a screen, layout, component, or flow, the agent reads the CSS files from this skill, embeds them into a single self-contained HTML file, and saves it to the user's Desktop. The file opens in any browser — no build step, no dependencies, no dev server.

Everything the agent needs is in `SKILL.md`. This README covers the essentials to get started quickly.

## Quick start

### 1. Pick a theme

| Theme | Attribute | When to use |
|-------|-----------|-------------|
| **Arcade** | `data-theme="arcade"` | Computer, Agent Studio, new AI surfaces |
| **DevRev App** | `data-theme="devrev-app"` | Main DevRev product (System of Record) |

If the user doesn't specify, ask: *"Is this for Computer/Agent Studio, or the main DevRev app?"*

### 2. Assemble the HTML

Create a single `.html` file. Embed the CSS files **in this order** inside a `<style>` tag:

1. `chip-fonts.css` — base64-encoded Chip font family (required)
2. Theme tokens — either `arcade-tokens.css` or `devrev-app-tokens.css`
3. `typography-spacing.css` — text utility classes and spacing scale
4. `arcade-components.css` — component patterns (works with both themes)

```html
<html lang="en" data-theme="arcade" class="light" data-device="web">
<head>
  <style>
    /* 1. chip-fonts.css contents */
    /* 2. arcade-tokens.css contents */
    /* 3. typography-spacing.css contents */
    /* 4. arcade-components.css contents */
  </style>
</head>
<body>
  <!-- prototype here -->
</body>
</html>
```

Set `class="light"` for light mode (default). Remove it for dark mode.

### 3. Build with components

All component classes follow the pattern `.arcade-{component}--{variant}--{size}`:

```html
<button class="arcade-btn arcade-btn--primary">Save</button>
<button class="arcade-btn arcade-btn--secondary arcade-btn--S">Cancel</button>
<span class="arcade-badge arcade-badge--success">Active</span>
<div class="arcade-card arcade-card--elevated">Card content</div>
<input class="arcade-input" placeholder="Search...">
```

Full component reference (buttons, inputs, badges, cards, tabs, tables, dialogs, menus, avatars, toggles, checkboxes, alerts, skeletons, empty states) is in `SKILL.md`.

### 4. Save and deliver

Save to `~/Desktop/prototype-{name}.html`. Tell the user to open it in their browser.

## Key rules

### Color tokens need `hsl()` wrapping

Token values are raw HSL triplets (`228 10% 94%`), not complete color values. Always wrap:

```css
/* Correct */
color: hsl(var(--text-color-primary));
background: hsla(var(--bg-layer-01) / 0.5);
border: 1px solid hsl(var(--border-outline-01));

/* Wrong — will not render */
color: var(--text-color-primary);
```

Shadow tokens are the exception — they're complete values, use directly:

```css
box-shadow: var(--shadow-depth-02);
```

### Chip fonts are mandatory

Never use Inter, system fonts, or Google Fonts. DevRev uses the Chip font family:

| Variable | Usage |
|----------|-------|
| `var(--font-text)` | Body text, labels, buttons, inputs |
| `var(--font-display)` | Headings and titles |
| `var(--font-mono)` | Code blocks |

Key weights: **440** (normal), **540** (medium), **660** (bold).

### Communication style

Users of this skill are **designers, not engineers**. The agent must:

- Never show code, file paths, CSS, or terminal output
- Never explain the build process — just produce the prototype
- Speak in design language (colors, spacing, layout — not variables, HSL, DOM)
- Frame questions around design intent, not technical choices

## File reference

| File | Size | Contents |
|------|------|----------|
| `SKILL.md` | 26 KB | Complete agent instructions — themes, components, tokens, Figma, layout patterns |
| `arcade-tokens.css` | 26 KB | Arcade theme tokens (verbatim from production monorepo) |
| `devrev-app-tokens.css` | 38 KB | DevRev App theme tokens (verbatim from production monorepo) |
| `typography-spacing.css` | 14 KB | 25 text utility classes + phi-ratio spacing system |
| `arcade-components.css` | 22 KB | Component patterns — buttons, inputs, cards, tables, dialogs, etc. |
| `chip-fonts.css` | 325 KB | Base64-embedded Chip Text, Display, and Mono fonts |

Total skill size: ~450 KB. All CSS is embedded inline — prototypes have zero external dependencies.

## Figma integration

The skill supports pulling designs directly from Figma Desktop via [figma-cli](https://github.com/silships/figma-cli) (no API token needed — connects locally via CDP). The agent can:

- Export any Figma frame as a screenshot for reference
- Read the node tree to understand component structure
- Translate Figma designs into working prototypes using the component classes

Setup is automatic and silent — the agent handles it on first use. See the Figma section in `SKILL.md` for the full command reference.

## Common components

A quick cheat sheet of what's available (see `SKILL.md` for full HTML examples):

- **Buttons** — primary, secondary, tertiary, destructive, smart. Sizes: S, M, L.
- **Inputs** — text fields, textareas, error states, hints, labels.
- **Badges** — default, info, success, warning, alert, action, intelligence, attribute colors 1-8.
- **Cards** — basic, elevated, prominent, interactive.
- **Tabs** — tab bar with active state.
- **Tables** — styled with header and body rows.
- **Menus** — popover with menu items, dividers, keyboard shortcuts.
- **Dialogs** — overlay + dialog with header, body, footer.
- **Alerts** — info, success, warning, error banners.
- **Avatars** — sizes S/M/L, 8 color variants, image support.
- **Toggles & checkboxes** — on/off states.
- **Sidebar** — navigation with section titles and menu items.
- **Skeletons** — loading placeholders (text, circle, rectangle).
- **Empty states** — icon, title, description, action button.

## Layout patterns

Three ready-made patterns in `SKILL.md`:

- **App shell** — sidebar + scrollable main area (full viewport)
- **Centered content** — max-width container with auto margins
- **Header bar** — flex row with title and action buttons

## Token architecture

Both themes define the same semantic token names (`--text-color-primary`, `--bg-layer-01`, etc.) with different visual values. Components reference semantic tokens, so the same HTML renders correctly in both themes — just change `data-theme`.

The **Arcade** palette uses fruit-named color scales (husk, shuiguo, hardy, persimmon, dragonfruit, jabuticaba, banginapalli, maoshigua). The **DevRev App** palette uses an HSL primitive system with `calc()`.

## Contributing

Token files are extracted from the DevRev product monorepo at `devrev-web/libs/design-system/shared/themes/`. To update:

1. Pull latest from the monorepo
2. Copy the relevant CSS source files
3. Verify the component CSS still maps correctly to the updated token names
4. Test a prototype in both themes, both light and dark modes
