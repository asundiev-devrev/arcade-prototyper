---
name: arcade-prototyper
description: "DevRev Prototyper: Build interactive HTML prototypes with DevRev's design system (Arcade & DevRev App themes), Chip fonts, and Figma integration. Designed for designers — no technical knowledge required."
---

# DevRev Prototyper

Build interactive HTML prototypes styled with DevRev's design system. Supports two themes: **Arcade** (Computer & Agent Studio) and **DevRev App** (System of Record). Prototypes are self-contained HTML files — no build step, no dependencies, no monorepo required.

## Communication style — IMPORTANT

Your users are **designers, not engineers**. They think in screens, flows, and interactions — not in code, files, or terminal commands.

**Rules:**
- **Never show or mention code, CSS, HTML, file paths, terminal commands, or tool names.** The user should not see a single line of code or know which tools you used.
- **Never explain how you're building the prototype.** Don't say "I'm embedding CSS tokens" or "I'll inline the base64 fonts." Just do it silently.
- **Never ask technical questions.** Don't ask which theme token file to use — ask "Is this for Computer/Agent Studio, or the main DevRev app?" instead.
- **Never surface errors as technical output.** If something fails, say what happened in plain language and what you'll do to fix it.
- **Speak in design language.** Say "colors," "type styles," "spacing," "components," "layout" — not "CSS variables," "HSL values," "DOM structure," or "HTML scaffold."
- **When asking clarifying questions**, frame them around the design intent: "Should this be dark or light mode?", "What happens when someone clicks this button?", "Is this a full page or a smaller component?"
- **When delivering a prototype**, just tell them where the file is and to open it in their browser. Don't describe what's inside the file.

The goal: the designer describes what they want, and a working prototype appears. Everything in between is invisible.

## First-run setup (silent)

When this skill is first used, silently check that dependencies are ready. **Do all of this in the background — never show the user any of these steps, commands, or output.**

### 1. Check for figma-cli

```bash
FIGMA_CLI=$(find ~ -maxdepth 2 -type d -name "figma-cli" 2>/dev/null | head -1)
```

If not found, install it silently:

```bash
cd ~ && git clone https://github.com/silships/figma-cli.git && cd figma-cli && npm install
```

If `git` or `npm` is missing, tell the user (in plain language): "I need a one-time setup to connect to Figma. Could you ask your IT team to make sure Git and Node.js are installed on your machine?"

### 2. Check Figma connection

```bash
cd $FIGMA_CLI && node src/index.js daemon status
```

If not connected and Figma Desktop is running:

```bash
cd $FIGMA_CLI && node src/index.js connect
```

If Figma Desktop isn't running, tell the user: "Open Figma on your Mac and I'll connect to it."

### 3. Ready

Once everything is in place, just respond to whatever the designer asked for. Don't announce that setup is complete — they shouldn't know it happened.

## When to use this skill

Use when a designer asks you to:
- Create a UI prototype, mockup, or interactive demo
- Build a page layout or flow
- Prototype a component, feature, or interaction pattern
- Turn a Figma frame or screenshot into working HTML
- Pull a design from Figma and make it interactive
- Inspect or export anything from a Figma file

## How it works

Every prototype is a **single HTML file** that includes the token CSS and component CSS inline. The file opens directly in any browser.

## Themes

DevRev has two active themes. Ask the user which one to use if unclear.

| Theme | `data-theme` value | Token file | Visual character |
|-------|-------------------|------------|-----------------|
| **Arcade** | `arcade` | `arcade-tokens.css` | Warm achromatic palette, fruit-named attribute colors. Used in Computer, Agent Studio. |
| **DevRev App** | `devrev-app` | `devrev-app-tokens.css` | Cool blue-indigo palette, standard attribute colors. Used in the main DevRev product (SoR). |

Both themes share the same `arcade-components.css` — component classes reference semantic token variables that each theme defines differently.

## Files in this skill

| File | Purpose |
|------|---------|
| `arcade-tokens.css` | Arcade theme: fruit-named palette + semantic tokens (dark + light). Verbatim from monorepo. |
| `devrev-app-tokens.css` | DevRev App theme: HSL primitive system + semantic tokens (dark + light). Verbatim from monorepo. |
| `typography-spacing.css` | Typography utility classes (25 text styles) + phi-ratio spacing system. Extracted from monorepo. |
| `arcade-components.css` | Ready-made component classes — works with both themes. References real token names. |
| `chip-fonts.css` | Chip font family — base64-embedded `@font-face` declarations (fully self-contained) |
| `SKILL.md` | This file — instructions for Computer |

**Token provenance**: `arcade-tokens.css` and `devrev-app-tokens.css` are verbatim extractions from the DevRev product monorepo (`devrev-web/libs/design-system/shared/themes/`). They are NOT approximations — they are the real production tokens.

## Chip font family

DevRev uses the **Chip** font family across all products. Three variants:

| Font face | CSS variable | Usage |
|-----------|-------------|-------|
| **Chip Text Variable** | `var(--font-text)` | Body text, UI labels, buttons, inputs — all general text |
| **Chip Display Variable** | `var(--font-display)` | Headings, titles, hero text |
| **Chip Mono** | `var(--font-mono)` | Code blocks, monospace text |

All fonts are variable-weight (100-900). Key weights used in the design system:
- **440** — normal (`.font-normal`)
- **540** — medium (`.font-medium`)
- **660** — bold (`.font-bold`)

The `chip-fonts.css` file contains base64-encoded font data, so prototypes render correctly with no network requests or external files. **Always embed it** in every prototype.

## Building a prototype

### Step 1: Choose a theme and create the HTML scaffold

**Arcade theme** (default for Computer/Agent Studio work):

```html
<!DOCTYPE html>
<html lang="en" data-theme="arcade" class="light" data-device="web">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prototype — [Name]</title>
  <style>
    /* Paste contents of chip-fonts.css here */
    /* Paste contents of arcade-tokens.css here */
    /* Paste contents of typography-spacing.css here */
    /* Paste contents of arcade-components.css here */

    /* === Prototype-specific styles below === */
  </style>
</head>
<body>
  <!-- Prototype content -->
</body>
</html>
```

**DevRev App theme** (for main product / SoR work):

```html
<!DOCTYPE html>
<html lang="en" data-theme="devrev-app" class="light" data-device="web">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prototype — [Name]</title>
  <style>
    /* Paste contents of chip-fonts.css here */
    /* Paste contents of devrev-app-tokens.css here */
    /* Paste contents of typography-spacing.css here */
    /* Paste contents of arcade-components.css here */

    /* === Prototype-specific styles below === */
  </style>
</head>
<body>
  <!-- Prototype content -->
</body>
</html>
```

**Important**: Read `chip-fonts.css`, the chosen token file, `typography-spacing.css`, AND `arcade-components.css` from this skill directory and embed their contents inside the `<style>` tag. This makes the file fully self-contained — fonts render without any external requests. The embed order matters: fonts → tokens → typography/spacing → components.

### Step 2: Set the mode

- **Light mode**: `class="light"` on `<html>` (default for most prototypes)
- **Dark mode**: Remove the `class="light"` attribute (or add `class="dark"` for DevRev App)
- **Device**: `data-device="web"` (default), `"desktop"`, or `"mobile"`

### Step 3: Build with components

Use the component classes from `arcade-components.css`. All follow the pattern:

```
.arcade-{component}--{variant}  .arcade-{component}--{size}
```

The component classes work identically in both themes — only the visual appearance changes based on the token file.

### Step 4: Add interactivity

For interactive prototypes, add vanilla JavaScript at the bottom of the file. Common patterns:

```html
<script>
  // Toggle dark/light mode
  document.querySelector('[data-action="toggle-theme"]')?.addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
  });

  // Tab switching
  document.querySelectorAll('.arcade-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.arcade-tab').forEach(t => t.classList.remove('arcade-tab--active'));
      tab.classList.add('arcade-tab--active');
      // Show/hide panels as needed
    });
  });

  // Dialog open/close
  function openDialog(id) { document.getElementById(id).style.display = 'flex'; }
  function closeDialog(id) { document.getElementById(id).style.display = 'none'; }
</script>
```

### Step 5: Save the file

Save to the user's Desktop or a specified location:

```
~/Desktop/prototype-{name}.html
```

Tell the user: "Open the file in your browser to see the prototype."

## Component reference

### Buttons
```html
<button class="arcade-btn arcade-btn--primary">Primary</button>
<button class="arcade-btn arcade-btn--secondary">Secondary</button>
<button class="arcade-btn arcade-btn--tertiary">Tertiary</button>
<button class="arcade-btn arcade-btn--destructive">Delete</button>

<!-- Sizes: --S, --M (default), --L -->
<button class="arcade-btn arcade-btn--primary arcade-btn--S">Small</button>
<button class="arcade-btn arcade-btn--primary arcade-btn--L">Large</button>
```

### Input fields
```html
<div class="arcade-field">
  <label class="arcade-field__label">Email</label>
  <input class="arcade-input" type="email" placeholder="name@example.com">
  <span class="arcade-field__hint">We'll never share your email.</span>
</div>

<!-- Error state -->
<input class="arcade-input arcade-input--error" value="bad-input">
<span class="arcade-field__error">This field is required.</span>
```

### Textarea
```html
<textarea class="arcade-textarea" placeholder="Write something..."></textarea>
```

### Badges
```html
<span class="arcade-badge arcade-badge--default">Default</span>
<span class="arcade-badge arcade-badge--info">Info</span>
<span class="arcade-badge arcade-badge--success">Success</span>
<span class="arcade-badge arcade-badge--warning">Warning</span>
<span class="arcade-badge arcade-badge--alert">Alert</span>
<span class="arcade-badge arcade-badge--action">Action</span>
<span class="arcade-badge arcade-badge--intelligence">AI</span>

<!-- Attribute colors (1-8, for categorical labels) -->
<span class="arcade-badge arcade-badge--attr-1">Label 1</span>
<span class="arcade-badge arcade-badge--attr-5">Label 5</span>
```

### Cards
```html
<div class="arcade-card">Basic card</div>
<div class="arcade-card arcade-card--elevated">Elevated</div>
<div class="arcade-card arcade-card--prominent">Prominent</div>
<div class="arcade-card arcade-card--interactive">Clickable card</div>
```

### Menu / List items
```html
<div class="arcade-popover">
  <button class="arcade-menu-item">
    <span>Settings</span>
    <span class="arcade-menu-item__secondary">⌘S</span>
  </button>
  <button class="arcade-menu-item arcade-menu-item--selected">Profile</button>
  <hr class="arcade-divider">
  <button class="arcade-menu-item" style="color: hsl(var(--color-feedback-alert));">Log out</button>
</div>
```

### Avatars
```html
<div class="arcade-avatar arcade-avatar--M arcade-avatar--1">AS</div>
<div class="arcade-avatar arcade-avatar--L arcade-avatar--4">
  <img src="https://i.pravatar.cc/80" alt="User">
</div>
```

### Toggle / Switch
```html
<div class="arcade-toggle"></div>
<div class="arcade-toggle arcade-toggle--on"></div>
```

### Checkbox
```html
<div class="arcade-checkbox"></div>
<div class="arcade-checkbox arcade-checkbox--checked"></div>
```

### Tabs
```html
<div class="arcade-tabs">
  <button class="arcade-tab arcade-tab--active">Overview</button>
  <button class="arcade-tab">Details</button>
  <button class="arcade-tab">Activity</button>
</div>
```

### Table
```html
<table class="arcade-table">
  <thead>
    <tr><th>Name</th><th>Status</th><th>Date</th></tr>
  </thead>
  <tbody>
    <tr><td>Item one</td><td><span class="arcade-badge arcade-badge--success">Active</span></td><td>Mar 13</td></tr>
    <tr><td>Item two</td><td><span class="arcade-badge arcade-badge--warning">Pending</span></td><td>Mar 12</td></tr>
  </tbody>
</table>
```

### Alert banner
```html
<div class="arcade-alert arcade-alert--info">This is an informational message.</div>
<div class="arcade-alert arcade-alert--success">Operation completed.</div>
<div class="arcade-alert arcade-alert--warning">Proceed with caution.</div>
<div class="arcade-alert arcade-alert--error">Something went wrong.</div>
```

### Dialog / Modal
```html
<div class="arcade-overlay" id="my-dialog" style="display: none;">
  <div class="arcade-dialog">
    <div class="arcade-dialog__header">
      <span class="arcade-dialog__title">Confirm action</span>
      <button class="arcade-btn arcade-btn--tertiary arcade-btn--S" onclick="closeDialog('my-dialog')">✕</button>
    </div>
    <div class="arcade-dialog__body">Are you sure you want to proceed?</div>
    <div class="arcade-dialog__footer">
      <button class="arcade-btn arcade-btn--secondary" onclick="closeDialog('my-dialog')">Cancel</button>
      <button class="arcade-btn arcade-btn--primary">Confirm</button>
    </div>
  </div>
</div>
```

### Sidebar navigation
```html
<div class="arcade-sidebar">
  <span class="arcade-sidebar__section-title">Navigation</span>
  <button class="arcade-menu-item arcade-menu-item--selected">Dashboard</button>
  <button class="arcade-menu-item">Issues</button>
  <button class="arcade-menu-item">Settings</button>
</div>
```

### Skeleton loading
```html
<div class="arcade-skeleton" style="width: 200px; height: 24px;"></div>
<div class="arcade-skeleton arcade-skeleton--text"></div>
<div class="arcade-skeleton arcade-skeleton--circle" style="width: 40px; height: 40px;"></div>
```

### Empty state
```html
<div class="arcade-empty">
  <div class="arcade-empty__icon">📭</div>
  <div class="arcade-empty__title">No items yet</div>
  <div class="arcade-empty__description">Create your first item to get started.</div>
  <button class="arcade-btn arcade-btn--primary">Create item</button>
</div>
```

## Layout patterns

### App shell (sidebar + main)
```html
<div style="display: flex; height: 100vh;">
  <div class="arcade-sidebar">
    <!-- nav items -->
  </div>
  <main style="flex: 1; overflow: auto; padding: var(--spacing-global-lg);">
    <!-- page content -->
  </main>
</div>
```

### Centered content
```html
<div style="max-width: 640px; margin: 0 auto; padding: var(--spacing-global-xl) var(--spacing-global-lg);">
  <!-- content -->
</div>
```

### Header bar
```html
<header style="display: flex; align-items: center; justify-content: space-between; padding: var(--spacing-global-xs) var(--spacing-global-md); border-bottom: 1px solid hsl(var(--border-outline-01)); background: hsl(var(--bg-layer-01));">
  <span class="text-subtitle-1 font-bold">Page Title</span>
  <div style="display: flex; gap: var(--spacing-global-xs);">
    <button class="arcade-btn arcade-btn--tertiary arcade-btn--S">Cancel</button>
    <button class="arcade-btn arcade-btn--primary arcade-btn--S">Save</button>
  </div>
</header>
```

## Typography classes

Use these classes for text styling (same in both themes):

| Class | Usage |
|-------|-------|
| `.text-title-large` | Hero headings (34px, bold) |
| `.text-title-1` | Page titles (29px, bold) |
| `.text-title-2` | Section headings (24px, bold) |
| `.text-title-3` | Card titles (20px, bold) |
| `.text-subtitle-1` | Emphasized labels (16px, bold) |
| `.text-subtitle-2` | Sub-labels (14px, bold) |
| `.text-body` | Default body text (14px) |
| `.text-body-large` | Large body text (16px) |
| `.text-body-small` | Compact body (13px) |
| `.text-system` | UI text — buttons, inputs (13px, medium) |
| `.text-system-small` | Smaller UI text (12px, medium) |
| `.text-system-xsmall` | Extra small UI text (11px, medium) |
| `.text-caption` | Captions, hints (12px) |
| `.text-footnote` | Fine print (11px) |
| `.text-code` | Monospace code (13px) |
| `.text-code-small` | Small monospace (12px) |

Font weights: `.font-normal` (440), `.font-medium` (540), `.font-bold` (660)

## Spacing classes

Gap: `.gap-5xs` through `.gap-2xl`
Padding: `.p-5xs` through `.p-xl`

Or use CSS variables directly:
- `var(--spacing-global-base)` — fixed rem spacing (0.5rem)
- `var(--spacing-dynamic-base)` — em spacing that scales with font-size (0.5em)

## Color token reference

All color tokens store raw HSL triplets (e.g., `0 0% 100%`). You **must** wrap them with `hsl()` or `hsla()` when using them in CSS properties:
- `color: hsl(var(--text-color-primary));`
- `background: hsla(var(--bg-layer-01) / 0.5);`

### Arcade palette colors (direct use)

The Arcade theme includes a fruit-named palette. These are raw HSL triplets — wrap in `hsl()`:

| Scale | Hue family | Usage |
|-------|-----------|-------|
| `--husk-100` to `--husk-1300` | Warm achromatic grays | Neutrals, backgrounds, text |
| `--shuiguo-100` to `--shuiguo-600` | Cyan-blue | Info, links |
| `--hardy-100` to `--hardy-600` | Green | Success states |
| `--persimmon-100` to `--persimmon-600` | Orange-red | Warning states |
| `--dragonfruit-100` to `--dragonfruit-600` | Pink-red | Alert/error states |
| `--jabuticaba-100` to `--jabuticaba-600` | Purple | Intelligence/AI |
| `--banginapalli-100` to `--banginapalli-600` | Yellow-gold | Action/brand |
| `--maoshigua-100` to `--maoshigua-600` | Blue | Decorative |
| `--day` / `--night` | White / near-black | Base extremes |

Aliases: `--action-100` to `--action-600` maps to banginapalli. `--intelligence-100` to `--intelligence-600` maps to jabuticaba.

### Semantic tokens (available in both themes)

| Token | Purpose |
|-------|---------|
| `var(--text-color-primary)` | Main text |
| `var(--text-color-secondary)` | Secondary text |
| `var(--text-color-tertiary)` | Tertiary text |
| `var(--text-color-muted)` | Muted/placeholder text |
| `var(--color-on-fill)` | Text on filled backgrounds |
| `var(--bg-layer-00)` | Deepest page background |
| `var(--bg-layer-01)` | Card/surface background |
| `var(--bg-layer-02)` | Nested surface |
| `var(--bg-layer-03)` | Third-level surface |
| `var(--bg-interactive-primary-resting)` | Primary button bg |
| `var(--bg-interactive-primary-hovered)` | Primary button hover |
| `var(--bg-interactive-secondary-resting)` | Secondary button bg |
| `var(--bg-interactive-tertiary-hovered)` | Tertiary button hover |
| `var(--bg-interactive-destructive-resting)` | Destructive button bg |
| `var(--bg-interactive-smart-resting)` | AI/smart button bg |
| `var(--border-outline-00)` | Subtle border |
| `var(--border-outline-01)` | Standard border |
| `var(--border-input-text-resting)` | Input border |
| `var(--border-field-idle)` | Form field border (idle) |
| `var(--color-feedback-alert)` | Error/destructive |
| `var(--color-feedback-warning)` | Warning |
| `var(--color-feedback-success)` | Success |
| `var(--color-feedback-smart)` | AI/intelligence |
| `var(--color-action)` | Primary brand action |
| `var(--color-intelligence)` | AI accent |

### Shadow tokens (defined in arcade-components.css)

Shadow tokens are **complete CSS values** — use them directly without `hsl()` wrapping:

| Token | Purpose |
|-------|---------|
| `var(--shadow-depth-01)` | Subtle elevation |
| `var(--shadow-depth-02)` | Medium elevation (cards) |
| `var(--shadow-depth-03)` | High elevation (popovers, dialogs) |
| `var(--shadow-depth-04)` | Highest elevation |
| `var(--shadow-button)` | Button press shadow |
| `var(--shadow-interactive-focused)` | Focus ring |

### Using colors in inline styles

```html
<!-- Background — wrap in hsl() -->
<div style="background: hsl(var(--bg-layer-01));">...</div>

<!-- Text — wrap in hsl() -->
<span style="color: hsl(var(--text-color-secondary));">Secondary text</span>

<!-- Border — wrap in hsl() -->
<div style="border: 1px solid hsl(var(--border-outline-01));">...</div>

<!-- With opacity — use hsla() with / syntax -->
<div style="background: hsla(var(--bg-interactive-primary-resting) / 0.1);">...</div>

<!-- Direct palette color — wrap in hsl() -->
<div style="background: hsl(var(--banginapalli-200));">...</div>

<!-- Shadow — use directly, no hsl() needed -->
<div style="box-shadow: var(--shadow-depth-02);">...</div>
```

## Figma integration

You have direct access to Figma Desktop via **figma-cli** (`silships/figma-cli` on GitHub). It connects directly to the running Figma Desktop app — no API token, no Figma REST API, no third-party services.

**CRITICAL RULES:**
- **NEVER ask the user for a Figma API token.** You don't need one. figma-cli connects locally.
- **NEVER use the Figma REST API** (`api.figma.com`). It doesn't work here.
- **NEVER use `npx figma-cli`** or any npm package. Use the local clone.
- **NEVER use `figma-use`** directly. Use figma-cli commands instead.

### Locating figma-cli

figma-cli should be cloned to `~/figma-cli`. To find it:

```bash
FIGMA_CLI=$(find ~ -maxdepth 2 -type d -name "figma-cli" 2>/dev/null | head -1)
```

If not found, install it:

```bash
cd ~ && git clone https://github.com/silships/figma-cli.git && cd figma-cli && npm install
```

### Setup

Before first use, ensure the daemon is connected:

```bash
cd $FIGMA_CLI && node src/index.js daemon status
```

If not connected:

```bash
cd $FIGMA_CLI && node src/index.js connect
```

### Key commands for prototyping

All commands run from the figma-cli directory.

| Task | Command |
|------|---------|
| Check connection | `node src/index.js daemon status` |
| List open files | `node src/index.js files` |
| Find a node by name | `node src/index.js find "Button"` |
| Get node properties | `node src/index.js get "1038:14518"` |
| Get node tree | `node src/index.js node tree "1038:14518" -d 3` |
| Export node as PNG | `node src/index.js export node "1038:14518" -o /tmp/frame.png -s 2` |
| Export screenshot | `node src/index.js export screenshot -o /tmp/screen.png -s 2` |
| Select a node | `node src/index.js select "1038:14518"` |
| What's on canvas | `node src/index.js canvas info` |

**Node ID format**: Use colon format (`1038:14518`), not dash format (`1038-14518`). Figma URLs show dashes in `node-id=` params — convert them to colons.

### Figma-to-prototype workflow

When the user shares a Figma URL or asks to prototype a frame:

1. **Extract the node ID** from the URL. Convert `node-id=1038-14518` → `1038:14518`.
2. **Export a screenshot** for visual reference:
   ```bash
   node src/index.js export node "1038:14518" -o /tmp/figma-ref.png -s 2
   ```
3. **Get the node tree** to understand structure:
   ```bash
   node src/index.js node tree "1038:14518" -d 4
   ```
4. **Get node properties** for colors, sizes, spacing:
   ```bash
   node src/index.js get "1038:14518"
   ```
5. **Build the HTML prototype** using the component classes and tokens from this skill. Match the intent and structure — don't try to pixel-match every value.

### Full reference

See `$FIGMA_CLI/CLAUDE.md` for quick start and `$FIGMA_CLI/REFERENCE.md` for the complete command reference.

## Tips

- **Always embed all four CSS files inline** — `chip-fonts.css` + theme tokens + `typography-spacing.css` + `arcade-components.css`. This makes prototypes fully self-contained.
- **Embed order matters**: fonts → tokens → typography/spacing → components. Components depend on tokens; typography classes are standalone utilities.
- **Chip fonts are mandatory** — never use Inter, system fonts, or Google Fonts as the primary typeface. Chip is DevRev's design system font.
- **Default to light mode** (`class="light"`) unless the user asks for dark.
- **Always wrap color tokens in `hsl()`** — token values are raw HSL triplets (e.g., `0 0% 100%`), NOT complete `hsl()` calls. Write `color: hsl(var(--text-color-primary))` not `color: var(--text-color-primary)`.
- **Shadows are different** — shadow tokens are complete values, use them directly: `box-shadow: var(--shadow-depth-02)`.
- **Arcade sub-themes**: The Arcade theme supports sub-themes via `data-arcade-theme` attribute — `"jabuticaba"` (default) or `"dragonfruit"`. This changes which palette maps to `--action` and `--intelligence` aliases.
- **Keep it semantic** — use the right component for the job (badges for status, cards for grouping, etc.).
- **Add hover states** — they make prototypes feel alive. The component CSS includes them by default.
- **Mobile prototypes**: Set `data-device="mobile"` and add `<meta name="viewport" content="width=device-width, initial-scale=1.0">`.
- When the user provides a **Figma screenshot**, map visual elements to the closest component class. Don't try to pixel-match — match the intent and feel.
- **Theme comparison**: To show both themes side by side, create two prototypes with different `data-theme` values. Don't mix themes in one file.
- **Tokens are real production tokens** — extracted verbatim from the DevRev product monorepo. If something looks wrong, it may be a component CSS mapping issue, not a token issue.
