# Studio Visual Refresh — Design

**Date:** 2026-07-07
**Status:** Approved, ready for implementation plan
**Figma source:** ADS-Branding, node `473-4891` ("Final designs"). Relevant frames:
`483:16734` (Landing), `461:4697` / `461:4698` (Canvas/editor interface).

## Goal

Reskin Arcade Studio's own UI to the branded dark treatment shown in the Figma
proposal. The landing screen gets a charcoal background with corner pinstripe
artwork, an Arcade logo header, an elevated dark prompt card, restyled tabs, and
dark project cards. The editor (project detail) gets the same dark chrome plus a
dotted-grid canvas background.

## The one hard constraint

**Studio's own chrome goes dark. Generated frames do NOT.**

Generated frames render inside iframes, each with its own theme provider driven
by `project.mode` and toggled by the per-project `ThemeToggle` in the project
header. The shell chrome (headers, hero, chat pane, viewport gutter, cards) is
styled by the app-level `DevRevThemeProvider mode={studioMode}` in `App.tsx`.

Because these are two independent theme scopes (shell provider vs. per-iframe
provider), forcing the chrome dark is a single lever — pin `studioMode` to
`"dark"` — and it leaves the frames' light/dark behavior completely untouched.
This separation is the backbone of the whole change; do not collapse it.

## Approach: flip + brand-layer

Pin the shell theme to dark, then layer branding on top. Smallest new surface,
reuses the design-system dark palette, and the editor comes along for free.

Rejected alternatives:
- **Bespoke dark landing only** — contradicts the requirement that the editor
  also goes dark.
- **Separate "studio brand" token layer** — max control, most work, risks
  drifting from the arcade-gen design system. Overkill for a reskin.

## Changes

### 1. Theme flip (`App.tsx`)

- Pin the shell `DevRevThemeProvider` to `mode="dark"`.
- Remove the shell-side `studioMode` state, the `/api/settings` hydrate effect
  that reads `studio.mode`, and the `arcade-studio:mode-changed` listener. These
  existed only to drive the shell theme, which is now constant.
- The per-project `ThemeToggle` and `project.mode` handling in
  `ProjectDetail.tsx` are **untouched** — they drive the frames, not the chrome.

### 2a. Landing background (`studio.css` + assets)

The Figma landing background is **not** a full-bleed CSS hatch. It is a charcoal
base with two rasterized diagonal-pinstripe **wedges** in opposite corners
(top-right = Figma node `483:16815`, bottom-left = `483:16827`), each with fine
fading pinstripes, plus small 13×13 registration-mark squares near the wedge
tips.

- Export the two wedges as assets into `studio/src/assets/` (they come from
  Figma as **SVG**, ~7KB each — scalable, so no raster pitch drift).
  - `wedge-tr.svg` (top-right), `wedge-bl.svg` (bottom-left).
- New `.studio-canvas-bg` treatment on the home root: charcoal fill +
  the two wedges positioned absolute in their corners (behind content,
  `pointer-events: none`, `z-index` below the content layer).
- The corner squares render as small CSS elements at the documented positions.
- A CSS approximation via `repeating-linear-gradient` was rejected: the
  pinstripe pitch and fade would not match. Use the exported artwork.

### 2b. Editor canvas background (`ViewportPreview.tsx`)

The editor canvas texture is **different** from the landing — a dotted grid, not
pinstripes. Today `ViewportPreview` fills its scroll area with
`--bg-neutral-soft` (currently line ~313).

- Replace that background with a dark base + a dotted-grid pattern via CSS
  `radial-gradient` (cheap, tiles cleanly, no asset). Frames sit on top and stay
  iframe-isolated — their own theme is unaffected.

### 3. Header branding (`StudioHeader.tsx` + new `StudioBrand.tsx`)

- New `StudioBrand.tsx`: inline Arcade logo mark (SVG, from the Figma logo node)
  + "Arcade Studio" wordmark.
- On the **home** page, the header title slot renders `StudioBrand` instead of
  the plain "Studio" text.
- The **project** header keeps its existing title content (ChatToggle + project
  picker + left-pane tab toggle) — unchanged.

### 4. Hero prompt card (`HeroPromptInput.tsx`)

- Wrap the existing hero input in an elevated dark rounded card (dark surface,
  radius ~24, padding, subtle elevation).
- Add the yellow cursor/accent bar on the left edge of the text area to match
  the design.
- The controls row already has the model selector (`Opus ▾`), the `+` attach
  button, and the send button. Restyle the send to the yellow circle from the
  design. No new control behavior — visual only.

### 5. Tabs + import (`HomeShelf.tsx`)

- Replace the pill `ToggleGroup` ("My projects" / "Templates") with **underlined
  text tabs**: "Projects" / "Templates". Active tab = bold + underline.
- **No** "New" badge (design showed one; explicitly dropped).
- **Keep** the existing "Import project…" button that lives in this row today —
  right-aligned, restyled for the dark treatment. Do not remove it.

### 6. Project cards (`ProjectCard.tsx`)

- Restyle dark: darker fill, subtle stroke, matching the design's card chrome.
- Keep name + date + the `⋯` (rename/delete) menu.
- **No live frame-preview thumbnails this pass.** The design shows live
  previews; that is a render-to-image pipeline and is explicitly deferred to a
  follow-up. Cards get the new look without preview art.

### 7. Editor chrome (spot-check)

The theme flip carries the editor (project detail) chrome to dark automatically.
Spot-check contrast on: the project header, the chat/left pane, the viewport
gutter, and resize handles. Fix any hard-coded light values found. No structural
change expected here beyond 2b.

### 8. Settings appearance toggle (`AppSettingsModal.tsx`)

- Remove the "Appearance" section (the light/dark shell toggle). With the shell
  pinned dark it is a no-op.
- Verified safe: the section only wrote `studio.mode` (shell theme) and its own
  copy states "each project's preview theme is controlled by the toggle in the
  project header." It does not seed the generator's frame theme.

## Scope (files)

| File | Change |
|---|---|
| `src/App.tsx` | Pin shell theme dark; remove shell mode state/hydrate/listener |
| `src/styles/studio.css` | `.studio-canvas-bg` (charcoal + corner wedges + squares) |
| `src/assets/wedge-tr.svg`, `wedge-bl.svg` | New — exported Figma wedge artwork |
| `src/components/shell/StudioHeader.tsx` | Home title slot renders brand |
| `src/components/shell/StudioBrand.tsx` | New — logo mark + wordmark |
| `src/components/home/HeroPromptInput.tsx` | Elevated dark card + yellow accent/send |
| `src/components/home/HomeShelf.tsx` | Underlined tabs; keep import button |
| `src/components/projects/ProjectCard.tsx` | Dark card restyle |
| `src/components/viewport/ViewportPreview.tsx` | Dotted-grid canvas bg |
| `src/components/shell/AppSettingsModal.tsx` | Remove Appearance toggle |

## Tests

- **Theme-pin guard** — `App.tsx` renders `DevRevThemeProvider` with a constant
  `mode="dark"` (no state-driven mode on the shell provider).
- **Settings-toggle-removed guard** — `AppSettingsModal` no longer renders the
  Appearance / dark-mode switch.
- **Tabs render** — `HomeShelf` shows "Projects" / "Templates" underlined tabs
  and still renders the "Import project…" affordance.
- Existing `@xorkavi/arcade-gen`-mocked component tests must keep passing (mock
  must cover any newly-imported DS components).

## Out of scope / deferred

- Live project-card thumbnails (render-to-image pipeline) — follow-up.
- Any change to generated-frame theming or the per-project toggle.
- Starter/suggestion chips on the landing (design showed them; explicitly not
  wanted).

## Verification

- Run `pnpm run studio` and eyeball the landing against Figma `483:16734`:
  charcoal bg, corner wedges, logo header, dark hero card with yellow send,
  underlined tabs + import button, dark cards.
- Open a project; confirm editor chrome is dark and the canvas shows the dotted
  grid, while a generated frame still honors its own light/dark toggle.
- `pnpm run studio:test` green.
