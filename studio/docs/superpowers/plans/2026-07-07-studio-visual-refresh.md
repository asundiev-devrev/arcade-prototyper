# Studio Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Arcade Studio's own UI to the branded dark treatment from the Figma proposal — dark chrome everywhere, charcoal landing with corner pinstripe artwork, Arcade logo header, elevated dark hero card, underlined tabs, dark cards, dotted-grid editor canvas — while generated user frames keep their own light/dark toggle.

**Architecture:** One lever flips the chrome: pin the app-level `DevRevThemeProvider mode="dark"` in `App.tsx`. Generated frames are separate iframe *documents* (`server/plugins/frameMountPlugin.ts` mounts each frame's own `DevRevThemeProvider` from `project.mode`), so shell theme physically cannot cross into them. Branding (texture, logo, hero card, tabs, cards) layers on top with CSS + staged SVG assets + the arcade-gen `Tabs`/`Badge` primitives.

**Tech Stack:** Vite + React 18 + TypeScript, `@xorkavi/arcade-gen` design system, Vitest + @testing-library/react, Tailwind v4 (studio shell only).

## Global Constraints

- **Package manager is pnpm.** Never `npm`/`yarn`. Run all commands from the **repo root** (`/Users/andrey.sundiev/arcade-prototyper`), not `studio/`.
- **Test command:** `pnpm run studio:test <path>` for one file; `pnpm run studio:test` for the full suite (~90s). Run the full suite before the final commit.
- **Never `git add -A` / `git add .`** — stage explicit paths only (repo root has loose untracked scratch files).
- **Commits use Conventional Commits**, scope `studio/<area>`, e.g. `feat(studio/shell): …`, `fix(studio/home): …`.
- **Commit trailer** on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **The theme boundary is sacred:** do NOT touch `project.mode`, the per-project `ThemeToggle`, or `frameMountPlugin.ts`. Those drive the *frames*. This plan only changes the *shell chrome*.
- **Vite middleware does not hot-reload.** Not relevant here (no middleware changes), but if verifying in `pnpm run studio`, a full app restart is needed after `server/` edits — there are none in this plan.
- **Brand assets are already staged** at `studio/src/assets/brand/` (`arcade-mark.svg`, `wedge-tr.svg`, `wedge-bl.svg`). Vite serves SVG imports as URL strings by default. Commit them in Task 3.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `studio/src/App.tsx` | Pin shell theme dark; drop shell mode state/hydrate/listener | 1 |
| `studio/src/components/shell/AppSettingsModal.tsx` | Remove Appearance section + `mode-changed` dispatch + `studioMode` state | 2 |
| `studio/src/assets/brand/*.svg` | Staged Figma artwork (logo mark + 2 wedges) | 3 |
| `studio/src/components/shell/StudioBrand.tsx` | New — logo mark + "Arcade Studio" wordmark | 3 |
| `studio/src/routes/HomePage.tsx` | Use `StudioBrand` in header; add `.studio-canvas-bg` wrapper | 3, 4 |
| `studio/src/styles/studio.css` | `color-scheme: dark`; `.studio-canvas-bg` texture; dot-grid class | 1, 4, 6 |
| `studio/src/components/home/HeroPromptInput.tsx` | Elevated dark card wrapper + left cursor bar | 5 |
| `studio/src/components/home/HomeShelf.tsx` | Underlined `Tabs`; keep Import button | 7 |
| `studio/src/components/projects/ProjectCard.tsx` | Dark card restyle | 8 |
| `studio/src/components/viewport/ViewportPreview.tsx` | Dotted-grid canvas background | 6 |
| Tests under `studio/__tests__/…` | Guards + updated existing tests | each task |

---

## Task 1: Pin shell theme to dark

**Files:**
- Modify: `studio/src/App.tsx`
- Modify: `studio/src/styles/studio.css:2`
- Test: `studio/__tests__/components/app-theme-pin.test.tsx` (create)

**Interfaces:**
- Produces: `App` renders `<DevRevThemeProvider mode="dark">` with a **literal** `"dark"`, no state.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/app-theme-pin.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

// Capture the mode prop passed to DevRevThemeProvider.
const seenModes: string[] = [];
vi.mock("@xorkavi/arcade-gen", async () => {
  const R = await import("react");
  return {
    DevRevThemeProvider: ({ mode, children }: any) => {
      seenModes.push(mode);
      return R.createElement("div", { "data-mode": mode }, children);
    },
    Toaster: () => null,
  };
});

// Stub the child routes + providers so App mounts without a server.
vi.mock("../../src/frame/FrameFontProxy", () => ({ FrameFontProxy: () => null }));
vi.mock("../../src/routes/HomePage", () => ({ HomePage: () => null }));
vi.mock("../../src/routes/ProjectDetail", () => ({ ProjectDetail: () => null }));
vi.mock("../../src/components/feedback/StartupAuthGate", () => ({ StartupAuthGate: ({ children }: any) => children }));
vi.mock("../../src/components/feedback/WhatsNewModal", () => ({ WhatsNewModal: () => null }));
vi.mock("../../src/components/feedback/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("../../src/components/feedback/Dialogs", () => ({ DialogsProvider: ({ children }: any) => children }));

import { App } from "../../src/App";

afterEach(() => { cleanup(); seenModes.length = 0; });

describe("App shell theme", () => {
  it("pins the shell DevRevThemeProvider to dark", () => {
    render(<App />);
    expect(seenModes).toContain("dark");
    expect(seenModes.every((m) => m === "dark")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/app-theme-pin.test.tsx`
Expected: FAIL — current `App` passes `studioMode` (initial `"light"`), so `seenModes` contains `"light"`.

- [ ] **Step 3: Edit `App.tsx`**

Remove the shell-mode machinery and pin dark. Concretely, in `studio/src/App.tsx`:

1. Delete the `studioMode` state line:
   ```tsx
   const [studioMode, setStudioMode] = useState<"light" | "dark">("light");
   ```
2. Delete the entire settings-hydrate `useEffect` (the block starting `let cancelled = false;` that fetches `/api/settings` and calls `setStudioMode`).
3. In the second `useEffect`, delete the `onModeChanged` handler and both its `addEventListener`/`removeEventListener("arcade-studio:mode-changed", …)` lines. Keep the `hashchange`/`popstate` wiring.
4. Change the provider open tag from `<DevRevThemeProvider mode={studioMode}>` to `<DevRevThemeProvider mode="dark">`.
5. Remove now-unused imports: drop `useEffect` only if no longer used (it still is — hash listener), keep `useState`/`useCallback` as still used. Verify no unused-var lint by keeping only what remains referenced.

- [ ] **Step 4: Flip `color-scheme` in `studio.css`**

In `studio/src/styles/studio.css`, change line 2 from:
```css
:root { color-scheme: light dark; }
```
to:
```css
/* Shell chrome is pinned dark (see App.tsx). Advertise dark so native
 * scrollbars, form controls, and default backgrounds paint dark too.
 * Frames are separate iframe documents and set their own color-scheme. */
:root { color-scheme: dark; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/app-theme-pin.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/App.tsx studio/src/styles/studio.css studio/__tests__/components/app-theme-pin.test.tsx
git commit -m "feat(studio/shell): pin shell theme dark; color-scheme dark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Remove the Settings Appearance toggle

**Files:**
- Modify: `studio/src/components/shell/AppSettingsModal.tsx`
- Test: `studio/__tests__/components/settings-appearance-removed.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; both are independent shell edits.
- Produces: `AppSettingsModal` no longer renders a "Dark mode" switch nor dispatches `arcade-studio:mode-changed`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/settings-appearance-removed.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Minimal arcade-gen mock covering what AppSettingsModal imports.
vi.mock("@xorkavi/arcade-gen", async () => {
  const R = await import("react");
  const passthrough = (tag: string) => ({ children, ...p }: any) => R.createElement(tag, p, children);
  const Modal: any = passthrough("div");
  Modal.Root = ({ children }: any) => R.createElement("div", null, children);
  Modal.Content = passthrough("div");
  Modal.Header = passthrough("div");
  Modal.Title = passthrough("div");
  Modal.Description = passthrough("div");
  Modal.Body = passthrough("div");
  Modal.Footer = passthrough("div");
  const Select: any = ({ children }: any) => R.createElement("div", null, children);
  Select.Root = ({ children }: any) => R.createElement("div", null, children);
  Select.Trigger = passthrough("div");
  Select.Value = passthrough("div");
  Select.Content = passthrough("div");
  Select.Item = passthrough("div");
  return {
    Modal, Select,
    Button: passthrough("button"),
    IconButton: R.forwardRef((p: any, ref: any) => R.createElement("button", { ...p, ref })),
    Input: R.forwardRef((p: any, ref: any) => R.createElement("input", { ...p, ref })),
    Switch: (p: any) => R.createElement("input", { type: "checkbox", ...p }),
    Badge: passthrough("span"),
  };
});
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as Response)));

import { AppSettingsModal } from "../../src/components/shell/AppSettingsModal";

afterEach(() => cleanup());

describe("AppSettingsModal appearance section", () => {
  it("no longer renders a dark-mode / appearance toggle", () => {
    render(<AppSettingsModal open onClose={() => {}} />);
    expect(screen.queryByText(/dark mode/i)).toBeNull();
    expect(screen.queryByText(/appearance/i)).toBeNull();
  });
});
```

Note: check `AppSettingsModal`'s actual prop names first (`open`, `onClose`) by reading the component's export signature; adjust the `render(...)` props to match if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/settings-appearance-removed.test.tsx`
Expected: FAIL — "Appearance" heading and "Dark mode" label still render.

- [ ] **Step 3: Edit `AppSettingsModal.tsx`**

1. Delete the entire `{/* Appearance */}` `<section>…</section>` block (the one containing the `<h3>Appearance</h3>`, the `<Switch checked={studioMode === "dark"} …>`, and the `arcade-studio:mode-changed` dispatch — around lines 249–283).
2. Delete the `studioMode` state declaration: `const [studioMode, setStudioMode] = useState<"light" | "dark">("light");`.
3. Delete the WHOLE hydrate `if` (real anchor `AppSettingsModal.tsx:83-85`), not just its body:
   ```tsx
   if (data.studio?.mode === "light" || data.studio?.mode === "dark") {
     setStudioMode(data.studio.mode);
   }
   ```
   Deleting only the inner `setStudioMode(...)` line would leave an empty `if (…) {}` (dead code / `no-empty` lint). Remove the entire `if` block. Leave the rest of that effect (it also loads `studioModel`) intact.
4. If `Switch` is now unused, remove it from the `@xorkavi/arcade-gen` import.
5. If the "Generation model" section had a top border that assumed a section above it, make it the first section (remove its `paddingTop`/`borderTop` if it now looks like a stray divider at the top — visual judgment; keep the model section functional).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/settings-appearance-removed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Guard against re-introduced dispatch**

Confirm no `arcade-studio:mode-changed` string remains in the shell:
Run: `grep -rn "arcade-studio:mode-changed" studio/src`
Expected: no output (App.tsx listener removed in Task 1; dispatch removed here).

- [ ] **Step 6: Commit**

```bash
git add studio/src/components/shell/AppSettingsModal.tsx studio/__tests__/components/settings-appearance-removed.test.tsx
git commit -m "feat(studio/shell): remove Settings appearance toggle (shell pinned dark)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Arcade brand header

**Files:**
- Add (already staged, commit them): `studio/src/assets/brand/arcade-mark.svg`, `wedge-tr.svg`, `wedge-bl.svg`
- Create: `studio/src/components/shell/StudioBrand.tsx`
- Modify: `studio/src/routes/HomePage.tsx` (header title slot)
- Test: `studio/__tests__/components/studio-brand.test.tsx` (create)

**Interfaces:**
- Produces: `StudioBrand` — default-styled component rendering an `<img>` of the mark + the text "Arcade Studio". Signature: `export function StudioBrand(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `studio/__tests__/components/studio-brand.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StudioBrand } from "../../src/components/shell/StudioBrand";

afterEach(() => cleanup());

describe("StudioBrand", () => {
  it("renders the wordmark and a logo image", () => {
    render(<StudioBrand />);
    expect(screen.getByText("Arcade Studio")).toBeTruthy();
    // The logo mark renders as an <img>.
    expect(document.querySelector("img")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run studio:test __tests__/components/studio-brand.test.tsx`
Expected: FAIL — module `StudioBrand` does not exist.

- [ ] **Step 3: Create `StudioBrand.tsx`**

```tsx
import markUrl from "../../assets/brand/arcade-mark.svg";

/**
 * Arcade wordmark for the home header: the logo mark + "Arcade Studio".
 * Chrome is pinned dark, so the mark and text use onProminent/prominent
 * foreground tokens. Frames are unaffected (separate documents).
 */
export function StudioBrand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
        src={markUrl}
        alt=""
        aria-hidden="true"
        style={{ width: 28, height: 28, display: "block" }}
      />
      <span
        style={{
          fontFamily: "var(--core-font-display), 'Chip Display Variable', sans-serif",
          fontWeight: 640,
          fontSize: 18,
          lineHeight: "24px",
          color: "var(--fg-neutral-prominent)",
        }}
      >
        Arcade Studio
      </span>
    </div>
  );
}
```

SVG-as-URL imports typecheck out of the box: `tsconfig.json` already sets
`"types": ["node", "vite/client"]`, and `vite/client` declares `*.svg` as a
default-export URL string. No ambient `.d.ts` is needed. (Vite has no svgr
plugin configured, so the default asset-URL behavior applies at runtime too.)

- [ ] **Step 4: Wire into `HomePage.tsx`**

In `studio/src/routes/HomePage.tsx`:
1. Add import: `import { StudioBrand } from "../components/shell/StudioBrand";`
2. Change `<StudioHeader title="Studio" right={<AppSettingsButton />} />` to `<StudioHeader title={<StudioBrand />} right={<AppSettingsButton />} />`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run studio:test __tests__/components/studio-brand.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/src/assets/brand/arcade-mark.svg studio/src/assets/brand/wedge-tr.svg studio/src/assets/brand/wedge-bl.svg studio/src/components/shell/StudioBrand.tsx studio/src/routes/HomePage.tsx studio/__tests__/components/studio-brand.test.tsx
git commit -m "feat(studio/shell): Arcade brand header + staged brand SVGs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Landing background texture

**Files:**
- Modify: `studio/src/styles/studio.css` (add `.studio-canvas-bg` + wedge/square children)
- Modify: `studio/src/routes/HomePage.tsx` (apply the class to the root)
- Test: none (pure CSS/visual — verified by eye in the final gate). No unit test; this is presentation-only.

**Interfaces:**
- Consumes: staged wedge SVGs from Task 3.
- Produces: a `.studio-canvas-bg` class the home root uses.

- [ ] **Step 1: Add the texture CSS**

Append to `studio/src/styles/studio.css`:

```css
/* Landing background: charcoal fill + two diagonal-pinstripe wedges in
 * opposite corners (top-right, bottom-left) from the Figma branding. The
 * wedges are absolutely positioned artwork behind content, not a full-bleed
 * hatch. Content sits above via its own stacking context. */
.studio-canvas-bg {
  position: relative;
  background: var(--bg-neutral-prominent, #211e20);
}
.studio-canvas-bg::before,
.studio-canvas-bg::after {
  content: "";
  position: absolute;
  pointer-events: none;
  z-index: 0;
  width: 46%;
  max-width: 620px;
  aspect-ratio: 1 / 1.9;
  background-repeat: no-repeat;
  background-size: contain;
  opacity: 0.9;
}
/* top-right wedge */
.studio-canvas-bg::before {
  top: 0;
  right: 0;
  background-image: var(--studio-wedge-tr);
  background-position: top right;
}
/* bottom-left wedge */
.studio-canvas-bg::after {
  bottom: 0;
  left: 0;
  background-image: var(--studio-wedge-bl);
  background-position: bottom left;
}
/* Content layer sits above the wedges. */
.studio-canvas-bg > * {
  position: relative;
  z-index: 1;
}
```

Note: CSS cannot import an SVG URL directly the way JS can. The wedge URLs are injected as CSS custom properties from `HomePage.tsx` (next step), which imports the SVGs and sets them as inline `style` vars on the root — this keeps the hashed asset URLs correct in both dev and packaged builds.

- [ ] **Step 2: Apply the class + inject wedge URLs in `HomePage.tsx`**

In `studio/src/routes/HomePage.tsx`:
1. Add imports at top:
   ```tsx
   import wedgeTrUrl from "../assets/brand/wedge-tr.svg";
   import wedgeBlUrl from "../assets/brand/wedge-bl.svg";
   ```
2. On the outermost `<div>` (currently `style={{ display: "flex", flexDirection: "column", height: "100vh" }}`), add the class and the CSS-var injection:
   ```tsx
   <div
     className="studio-canvas-bg"
     style={{
       display: "flex",
       flexDirection: "column",
       height: "100vh",
       ["--studio-wedge-tr" as any]: `url(${wedgeTrUrl})`,
       ["--studio-wedge-bl" as any]: `url(${wedgeBlUrl})`,
     }}
   >
   ```
3. The `StudioHeader` inside should stay visually on top — it already renders before the scroll area; the `.studio-canvas-bg > *` rule lifts both header and content above the wedges.

- [ ] **Step 3: Verify existing HomePage-consuming tests still pass**

Run: `pnpm run studio:test __tests__/components/studio-brand.test.tsx`
Expected: PASS (StudioBrand unaffected). There is no dedicated HomePage render test; if the suite has one it must still pass — run the home folder:
Run: `pnpm run studio:test __tests__/components/home`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/src/styles/studio.css studio/src/routes/HomePage.tsx
git commit -m "feat(studio/home): charcoal landing with corner pinstripe wedges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Elevated dark hero card

**Files:**
- Modify: `studio/src/components/home/HeroPromptInput.tsx`
- Test: `studio/__tests__/components/home/hero-prompt-input.test.tsx` (exists — keep green; extend only if it asserts container shape)

**Interfaces:**
- Consumes: nothing new. Send button is ALREADY `variant="expressive"` (yellow) at ~line 355 — do not change its color; only ensure it reads correctly inside the card.
- Produces: the hero's outer container is a rounded elevated dark card with a left accent bar.

- [ ] **Step 1: Read the existing hero test to avoid breaking it**

Run: `pnpm run studio:test __tests__/components/home/hero-prompt-input.test.tsx`
Expected: PASS currently. Read the test file; it exercises typing/submit behavior, not container styling — the wrapper change below must not alter the textarea, buttons, or submit handler, so it should stay green.

- [ ] **Step 2: Wrap the hero body in a card**

In `HeroPromptInput.tsx`, the top-level returned element is the `<div ref={containerRef} … style={{ position: "relative" }}>`. Change that outer `style` to make it the elevated card, and add a left accent bar. Replace the outer `<div>`'s style object with:

```tsx
style={{
  position: "relative",
  background: "var(--surface-overlay, #2a2728)",
  border: "1px solid var(--stroke-neutral-subtle)",
  borderRadius: 24,
  padding: "28px 28px 20px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  borderLeft: "3px solid var(--bg-expressive-yellow-prominent, #ffe000)",
}}
```

The yellow left border reproduces the design's cursor-accent bar at the card edge. The textarea, attachment row, controls row, and MentionPopover inside are unchanged.

- [ ] **Step 3: Run the hero test**

Run: `pnpm run studio:test __tests__/components/home/hero-prompt-input.test.tsx`
Expected: PASS (behavior unchanged).

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/home/HeroPromptInput.tsx
git commit -m "feat(studio/home): elevated dark hero card with yellow accent bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Dotted-grid editor canvas

**Files:**
- Modify: `studio/src/styles/studio.css` (add `.studio-dot-grid`)
- Modify: `studio/src/components/viewport/ViewportPreview.tsx:~313` (swap the inline background)
- Test: none (visual). Keep existing viewport tests green.

**Interfaces:**
- Consumes: nothing. Changes only the ViewportPreview outer scroll container's background (inline style at ~line 313, currently `background: "var(--bg-neutral-soft)"`). This is a per-usage change, NOT a token redefinition — `--bg-neutral-soft` stays intact for its other ~40 consumers.

- [ ] **Step 1: Add the dot-grid CSS**

Append to `studio/src/styles/studio.css`:

```css
/* Editor canvas backdrop: dark base + a subtle dotted grid. Frames render
 * on top inside their own iframe documents, so this never touches frame
 * theming. */
.studio-dot-grid {
  background-color: var(--bg-neutral-prominent, #211e20);
  background-image: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.08) 1px,
    transparent 1px
  );
  background-size: 22px 22px;
}
```

- [ ] **Step 2: Apply it in `ViewportPreview.tsx`**

Read `ViewportPreview.tsx` around the outer container (the `<div>` opened near line 300 whose `style` includes `background: "var(--bg-neutral-soft)"` around line 313). Add `className="studio-dot-grid"` to that same `<div>` and remove the `background: "var(--bg-neutral-soft)"` line from its inline `style` (the class supplies the background now). Leave all other style properties on that element intact.

- [ ] **Step 3: Verify viewport tests still pass**

Run: `pnpm run studio:test __tests__/components` — target any viewport/preview test if present.
Expected: PASS. If no viewport test exists, this is verified visually in the final gate.

- [ ] **Step 4: Commit**

```bash
git add studio/src/styles/studio.css studio/src/components/viewport/ViewportPreview.tsx
git commit -m "feat(studio/viewport): dotted-grid dark canvas backdrop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Underlined tabs (keep Import)

**Files:**
- Modify: `studio/src/components/home/HomeShelf.tsx`
- Test: `studio/__tests__/components/home/home-shelf.test.tsx` (update mock + keep behavior)
- Test: `studio/__tests__/components/home-import.test.tsx` (update mock)

**Interfaces:**
- Consumes: `Tabs` from `@xorkavi/arcade-gen` (confirmed exported). Verify its subcomponent shape by reading its type in `node_modules/.pnpm/@xorkavi+arcade-gen@*/…/dist/index.d.mts` (search `Tabs`). If `Tabs` does not expose a Radix-style `Root/List/Trigger`, fall back to plain underlined `<button>`s (styling below works either way).
- Produces: two tabs labeled "Projects" and "Templates", active = bold + underline; the Import button stays in the same row.

- [ ] **Step 1: Update the two existing tests FIRST (they assert old labels/mocks)**

The spec explicitly flagged these do NOT pass unchanged.

In `studio/__tests__/components/home/home-shelf.test.tsx`:
- The three assertions query by project name ("Demo"), not tab label, so they survive the rename. But the `ToggleGroup` mock (lines 9) becomes dead if we drop `ToggleGroup`. Replace the mock's `ToggleGroup` entry with a `Tabs` mock OR, if switching to plain buttons, remove `ToggleGroup` from the mock. Keep `Menu`, `IconButton`, `ThreeDotsHorizontal`. If using `Tabs`, add:
  ```tsx
  const Tabs: any = {
    Root: ({ children }: any) => React.createElement("div", null, children),
    List: ({ children }: any) => React.createElement("div", null, children),
    Trigger: ({ children, value, onClick }: any) => React.createElement("button", { onClick, "data-value": value }, children),
    Content: ({ children }: any) => React.createElement("div", null, children),
  };
  ```
  and return `Tabs` alongside the others. (Plain-button path needs no arcade-gen tab mock at all.)

In `studio/__tests__/components/home-import.test.tsx`:
- Same swap: the mock currently defines `ToggleGroup`. Replace with the `Tabs` mock (or drop it for the plain-button path). The `/import project/i` click assertion stays.

- [ ] **Step 2: Run the two tests to verify they fail against current component**

Run: `pnpm run studio:test __tests__/components/home/home-shelf.test.tsx __tests__/components/home-import.test.tsx`
Expected: FAIL — the mocks now expect `Tabs`/buttons the current `HomeShelf` (still using `ToggleGroup`) doesn't render, or (plain path) the component still imports `ToggleGroup` which is no longer mocked → render throws. This is the red state that drives Step 3.

- [ ] **Step 3: Rewrite the tabs row in `HomeShelf.tsx`**

Replace the `ToggleGroup.Root … </ToggleGroup.Root>` block (lines ~36–39) with underlined tabs. Plain-button implementation (no dependency on `Tabs` internals — safest):

```tsx
<div style={{ display: "flex", gap: 24, alignItems: "center" }}>
  {(["projects", "templates"] as const).map((t) => {
    const label = t === "projects" ? "Projects" : "Templates";
    const active = tab === t;
    return (
      <button
        key={t}
        type="button"
        onClick={() => setTab(t)}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          padding: "8px 2px",
          fontSize: 18,
          lineHeight: "24px",
          fontWeight: active ? 700 : 500,
          color: active ? "var(--fg-neutral-prominent)" : "var(--fg-neutral-medium)",
          borderBottom: active
            ? "2px solid var(--fg-neutral-prominent)"
            : "2px solid transparent",
          cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  })}
</div>
```

Update the import line: remove `ToggleGroup` from `@xorkavi/arcade-gen` (line 2) since it's no longer used. Keep the surrounding row `<div>` that also holds the Import button (lines ~35 and ~40–45) — the Import button stays exactly as-is (restyled by the dark theme automatically; no markup change needed). No "New" badge.

- [ ] **Step 4: Run the two tests to verify they pass**

Run: `pnpm run studio:test __tests__/components/home/home-shelf.test.tsx __tests__/components/home-import.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/src/components/home/HomeShelf.tsx studio/__tests__/components/home/home-shelf.test.tsx studio/__tests__/components/home-import.test.tsx
git commit -m "feat(studio/home): underlined Projects/Templates tabs; keep Import

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Dark project cards

**Files:**
- Modify: `studio/src/components/projects/ProjectCard.tsx`
- Test: `studio/__tests__/components/home/projects-section.test.tsx` (exists — keep green)

**Interfaces:**
- Consumes: nothing new. Restyle only — no prop or behavior change; name, date, and the `⋯` menu stay. No live thumbnails (deferred).

- [ ] **Step 1: Run the existing projects test to establish the baseline**

Run: `pnpm run studio:test __tests__/components/home/projects-section.test.tsx`
Expected: PASS. It renders cards and checks name/menu behavior; the style-only change below must keep it green.

- [ ] **Step 2: Restyle the card**

In `ProjectCard.tsx`, update the `<article>` inline `style`. Note the fill is
ALREADY `var(--surface-shallow)` (`ProjectCard.tsx:23`) — the real visible change
is the **border**: today it's `var(--control-stroke-neutral-medium-active)`
(`:24`), too loud on dark. Replace both values (fill gains only a fallback):

```tsx
background: "var(--surface-shallow, #2a2728)",
border: "1px solid var(--stroke-neutral-subtle)",
```

Keep `borderRadius: 12`, `minHeight: 180`, `padding: 16`, the flex column, and the `⋯` menu block unchanged. The name and date already use `--fg-neutral-prominent` / `--fg-neutral-subtle`, which resolve dark-appropriately under the pinned dark provider — no change needed there.

- [ ] **Step 3: Run the test to verify it still passes**

Run: `pnpm run studio:test __tests__/components/home/projects-section.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/src/components/projects/ProjectCard.tsx
git commit -m "feat(studio/home): dark project cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full-suite gate + visual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm run studio:test`
Expected: all green (~90s). If any `@xorkavi/arcade-gen`-mocked test now fails because a newly-imported DS component isn't in its mock, add the missing export to that test's mock (do not weaken assertions). Commit any such test-mock fixes with `test(studio): …`.

- [ ] **Step 2: Visual check against Figma**

Run: `pnpm run studio` (opens `:5556`). Compare the landing to Figma frame `483:16734`:
- charcoal background with pinstripe wedges in top-right and bottom-left corners
  (spec §2a also mentions small 13×13 registration-mark squares at the wedge tips
  — the exported wedge SVGs likely already contain them; if they're visibly
  absent vs Figma `483:16734`, add two small CSS squares near the wedge tips)
- Arcade logo mark + "Arcade Studio" wordmark in the header
- elevated dark hero card with yellow left accent and yellow circular send
- underlined "Projects" / "Templates" tabs + "Import project…" affordance, no "New" badge
- dark project cards

- [ ] **Step 3: Verify the theme boundary by eye**

Open a project. Confirm:
- editor chrome (header, chat pane, gutter) is dark
- the viewport canvas shows the dotted grid
- a generated frame still honors its own light/dark toggle (flip the per-project `ThemeToggle` in the project header — the frame changes, the chrome does not)

- [ ] **Step 4: Spot-check editor chrome contrast**

Scan the project header, chat/left pane, resize handles for any hard-coded light color that now looks wrong on dark. If found, replace the literal with the appropriate `var(--…)` token and commit `fix(studio/…): …`. (Review pass 8/9 found none in StartupAuthGate/ProjectPicker — shadows only — but confirm live.)

- [ ] **Step 5: Final confirmation**

No commit needed if everything passed. If test-mock or contrast fixes were made in Steps 1/4, ensure they're committed.

---

## Self-Review Notes (author)

- **Spec coverage:** theme flip §1 → Task 1; color-scheme §1b → Task 1; landing texture §2a → Tasks 3(assets)+4; editor texture §2b → Task 6; brand header §3 → Task 3; hero card §4 → Task 5; tabs+import §5 → Task 7; cards §6 → Task 8; editor chrome §7 → Task 9 step 4; settings removal §8 → Task 2. All covered, except the §2a registration-mark
squares are handled conditionally in Task 9 step 2 (the wedge SVGs may already
include them).
- **Deferred (out of scope):** live card thumbnails, starter chips — not in any task, by design.
- **Type consistency:** `StudioBrand()` used identically in Task 3 test + HomePage; `.studio-canvas-bg` / `.studio-dot-grid` class names consistent between CSS-def task and usage task; `--studio-wedge-tr`/`-bl` vars defined in HomePage and consumed in CSS.
- **Ordering:** Tasks 1–2 independent. Task 3 stages assets (needed by 4). 4 depends on 3's assets. 5–8 independent of each other. 9 last.
