# Hide `size="sm"` from the Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `<Button size="sm">` and `<IconButton size="sm">` unreachable from generator-authored frames by narrowing the `arcade` / `arcade/components` Vite + esbuild aliases onto a studio-local shim. Studio shell and prototype-kit composites keep `sm` because they import `@xorkavi/arcade-gen` directly.

**Architecture:** A 20-line shim file `studio/prototype-kit/arcade-components.tsx` re-exports `@xorkavi/arcade-gen`, then overrides `Button`/`IconButton` with wrappers that (a) narrow the TypeScript `size` prop to `"md" | "lg"` and (b) coerce `"sm"` → `"md"` at runtime as belt-and-suspenders. Both the Vite dev server (`studio/vite.config.ts`) and the Vercel share bundler (`studio/server/vercel/bundler.ts`) repoint their `arcade` / `arcade/components` aliases at this shim.

**Tech Stack:** TypeScript, React `forwardRef`, Vite (dev), esbuild (Vercel share), vitest. No new dependencies.

---

## File Structure

**Create:**
- `studio/prototype-kit/arcade-components.tsx` — the shim (re-export + Button/IconButton override).
- `studio/__tests__/prototype-kit/arcade-components-shim.test.tsx` — unit tests for the shim.

**Modify:**
- `studio/vite.config.ts` — repoint `arcade` + `arcade/components` aliases from `"@xorkavi/arcade-gen"` to the shim.
- `studio/server/vercel/bundler.ts` — same repoint in `ARCADE_ALIASES`.
- `studio/vitest.config.ts` — same repoint, so tests that import `arcade` / `arcade/components` exercise the shim.

No existing composites or studio shell files need edits: both already import `@xorkavi/arcade-gen` directly.

---

## Task 1: Create the shim file (no behavior yet, just re-export)

This task establishes the file and confirms Vite + vitest + esbuild all find it before we add the narrowed Button/IconButton overrides. Once this task passes with no behavior change, the next task adds the narrowing safely.

**Files:**
- Create: `studio/prototype-kit/arcade-components.tsx`

- [ ] **Step 1: Create the shim file with a plain re-export**

Write this exact content:

```tsx
// studio/prototype-kit/arcade-components.tsx
//
// Generator-facing surface for `arcade` / `arcade/components`. Re-exports
// @xorkavi/arcade-gen verbatim; next task narrows Button/IconButton so that
// `size="sm"` is unreachable from generator-authored frame code. Studio
// shell and prototype-kit composites import @xorkavi/arcade-gen directly
// and keep full access.

export * from "@xorkavi/arcade-gen";
```

- [ ] **Step 2: Commit**

```bash
git add studio/prototype-kit/arcade-components.tsx
git commit -m "feat(studio/kit): add arcade-components shim (pass-through)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Repoint Vite, Vitest, and esbuild aliases at the shim

Before we narrow the shim, repoint every `arcade` / `arcade/components` alias to point at it. At this point the shim is a pass-through, so behavior is unchanged — but we'll verify the existing studio test suite still passes, which proves the redirect is clean.

**Files:**
- Modify: `studio/vite.config.ts:64-69`
- Modify: `studio/vitest.config.ts:6-12`
- Modify: `studio/server/vercel/bundler.ts:149-153`

- [ ] **Step 1: Update `studio/vite.config.ts`**

Find this block (around lines 63-70):

```ts
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: "@xorkavi/arcade-gen" },
      { find: /^arcade$/, replacement: "@xorkavi/arcade-gen" },
      { find: "arcade-studio", replacement: path.resolve(__dirname, "src") },
      { find: "arcade-prototypes", replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
```

Replace with:

```ts
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: "arcade-studio",         replacement: path.resolve(__dirname, "src") },
      { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
```

- [ ] **Step 2: Update `studio/vitest.config.ts`**

Find this block:

```ts
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: "@xorkavi/arcade-gen" },
      { find: /^arcade$/, replacement: "@xorkavi/arcade-gen" },
      { find: "arcade-prototypes", replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
```

Replace with:

```ts
  resolve: {
    alias: [
      { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
      { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
    ],
  },
```

- [ ] **Step 3: Update `studio/server/vercel/bundler.ts`**

Find the `ARCADE_ALIASES` constant (around lines 149-153):

```ts
const ARCADE_ALIASES = {
  "arcade": "@xorkavi/arcade-gen",
  "arcade/components": "@xorkavi/arcade-gen",
  "arcade-prototypes": path.join(REPO_ROOT, "studio", "prototype-kit"),
} as const;
```

Replace with:

```ts
const ARCADE_SHIM_PATH = path.join(REPO_ROOT, "studio", "prototype-kit", "arcade-components.tsx");
const ARCADE_ALIASES = {
  "arcade": ARCADE_SHIM_PATH,
  "arcade/components": ARCADE_SHIM_PATH,
  "arcade-prototypes": path.join(REPO_ROOT, "studio", "prototype-kit"),
} as const;
```

- [ ] **Step 4: Run the existing test suite**

Run: `pnpm run studio:test`
Expected: all existing tests pass. The shim is a pass-through, so nothing should regress. If a test fails, investigate — typically it's a subtle alias path mismatch.

- [ ] **Step 5: Commit**

```bash
git add studio/vite.config.ts studio/vitest.config.ts studio/server/vercel/bundler.ts
git commit -m "feat(studio): route arcade/components alias through local shim

Vite, Vitest, and the Vercel share bundler all now resolve
\`arcade\` / \`arcade/components\` to studio/prototype-kit/arcade-components.tsx,
which currently re-exports @xorkavi/arcade-gen unchanged. Sets up the
next task (narrow Button/IconButton size).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Write failing tests for the narrowed shim

Before implementing the narrowing, write tests that assert both the runtime coercion and the pass-through behavior. We use `React.createElement`-level inspection (no DOM mount) to avoid introducing `@testing-library/react` to a suite that doesn't use it yet. The wrappers pass props through to the raw component; we assert on the element returned.

**Files:**
- Create: `studio/__tests__/prototype-kit/arcade-components-shim.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `studio/__tests__/prototype-kit/arcade-components-shim.test.tsx` with this exact content:

```tsx
// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect } from "vitest";
import {
  Button as RawButton,
  IconButton as RawIconButton,
} from "@xorkavi/arcade-gen";
import {
  Button,
  IconButton,
} from "../../prototype-kit/arcade-components";

/**
 * The shim wraps @xorkavi/arcade-gen's Button/IconButton in a forwardRef
 * component that:
 *  1) Narrows the TypeScript `size` prop to "md" | "lg" (checked via
 *     `@ts-expect-error` below — these lines MUST be type errors).
 *  2) Coerces runtime `size="sm"` → `size="md"` before delegating to the
 *     real component.
 *
 * We render the wrapper via React.createElement and inspect the returned
 * element's type + props. This avoids pulling @testing-library/react into
 * a suite that doesn't use it yet; we don't need a DOM to verify the
 * coercion — React's render function returns an element tree we can walk.
 */

function renderOnce(element: React.ReactElement): React.ReactElement {
  // Wrapper components are forwardRef function components. Invoking them
  // as functions with their own props returns the JSX they create — one
  // level deep is enough to reach the raw component.
  const type = element.type as any;
  // forwardRef components expose the inner render function at `.render`.
  const render = typeof type === "object" && type.render ? type.render : type;
  return render(element.props, null);
}

describe("arcade-components shim — Button", () => {
  it("passes size=\"md\" through to the raw Button", () => {
    const out = renderOnce(<Button size="md">Save</Button>);
    expect(out.type).toBe(RawButton);
    expect(out.props.size).toBe("md");
    expect(out.props.children).toBe("Save");
  });

  it("passes size=\"lg\" through to the raw Button", () => {
    const out = renderOnce(<Button size="lg">Save</Button>);
    expect(out.type).toBe(RawButton);
    expect(out.props.size).toBe("lg");
  });

  it("passes undefined size through (uses raw Button's default)", () => {
    const out = renderOnce(<Button>Save</Button>);
    expect(out.type).toBe(RawButton);
    expect(out.props.size).toBeUndefined();
  });

  it("coerces runtime size=\"sm\" to \"md\" before delegating", () => {
    // Cast forces the runtime value through despite the type narrowing —
    // simulates a dynamic prop or a JS caller bypassing the types.
    const out = renderOnce(
      <Button size={"sm" as "md"}>Save</Button>,
    );
    expect(out.type).toBe(RawButton);
    expect(out.props.size).toBe("md");
  });

  it("preserves other props when coercing (variant, iconLeft, onClick)", () => {
    const onClick = () => {};
    const out = renderOnce(
      <Button
        size={"sm" as "md"}
        variant="primary"
        onClick={onClick}
      >
        Save
      </Button>,
    );
    expect(out.props.size).toBe("md");
    expect(out.props.variant).toBe("primary");
    expect(out.props.onClick).toBe(onClick);
  });
});

describe("arcade-components shim — IconButton", () => {
  it("passes size=\"md\" through to the raw IconButton", () => {
    const out = renderOnce(
      <IconButton size="md" aria-label="Close">×</IconButton>,
    );
    expect(out.type).toBe(RawIconButton);
    expect(out.props.size).toBe("md");
    expect(out.props["aria-label"]).toBe("Close");
  });

  it("passes size=\"lg\" through to the raw IconButton", () => {
    const out = renderOnce(
      <IconButton size="lg" aria-label="Close">×</IconButton>,
    );
    expect(out.props.size).toBe("lg");
  });

  it("coerces runtime size=\"sm\" to \"md\" before delegating", () => {
    const out = renderOnce(
      <IconButton size={"sm" as "md"} aria-label="Close">×</IconButton>,
    );
    expect(out.type).toBe(RawIconButton);
    expect(out.props.size).toBe("md");
  });
});

describe("arcade-components shim — type narrowing", () => {
  it("rejects size=\"sm\" at the type level", () => {
    // These are expected TYPE errors; if the shim is not narrowed,
    // vitest will still pass this test at runtime but `tsc` / the IDE
    // would compile successfully and the `@ts-expect-error` directive
    // would itself error (as "unused expect-error").
    //
    // The runtime expect below is cosmetic; the real assertion is the
    // presence of the @ts-expect-error directives.
    // @ts-expect-error — size="sm" is intentionally unreachable via the shim
    const b1 = <Button size="sm">x</Button>;
    // @ts-expect-error — size="sm" is intentionally unreachable via the shim
    const b2 = <IconButton size="sm" aria-label="x">×</IconButton>;
    expect(b1).toBeTruthy();
    expect(b2).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm run studio:test arcade-components-shim`
Expected: tests fail because the shim currently re-exports `Button`/`IconButton` directly from arcade-gen. The `renderOnce` helper will fail on `type.render` being undefined for a non-forwardRef component, or the `type` assertion will fail because `Button === RawButton` at this point.

(The `@ts-expect-error` lines will also likely fail compilation once types are narrowed — that's the point of the type-level test. At this stage, before Task 4, TypeScript will compile `<Button size="sm">` fine, so the `@ts-expect-error` directives will be flagged as unused. That is the runtime `vitest` + TypeScript's `tsc` disagreement window, narrow. We accept the failing state for this one task — Task 4 fixes it.)

- [ ] **Step 3: Commit**

```bash
git add studio/__tests__/prototype-kit/arcade-components-shim.test.tsx
git commit -m "test(studio/kit): shim narrows Button/IconButton size (failing)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Narrow the shim so tests pass

Replace the pass-through shim with the narrowed version: wrappers that override `Button` and `IconButton` with `size?: "md" | "lg"` types and runtime `"sm" → "md"` coercion.

**Files:**
- Modify: `studio/prototype-kit/arcade-components.tsx`

- [ ] **Step 1: Replace the shim file contents**

Overwrite `studio/prototype-kit/arcade-components.tsx` with exactly this:

```tsx
// studio/prototype-kit/arcade-components.tsx
//
// Generator-facing surface for `arcade` / `arcade/components`. Re-exports
// @xorkavi/arcade-gen verbatim, except Button and IconButton are narrowed
// to size "md" | "lg" — sm is intentionally unreachable from agent-authored
// frame code. Studio shell and prototype-kit composites import the real
// arcade-gen package directly and keep full access.
//
// Why: at sm both controls render at 20px with zero vertical padding and
// 11px text, which does not match the Figma design system (Default 28px,
// Large 40px). Historically the generator has picked sm frequently, which
// produces "squished" top bars and buttons that read as inline links.
//
// Belt-and-suspenders: the wrappers also coerce a runtime size="sm" to
// "md" before delegating, so a dynamic prop or a JS caller that bypasses
// the TypeScript narrowing still renders correctly.

import * as React from "react";
import {
  Button as RawButton,
  IconButton as RawIconButton,
  type ButtonProps as RawButtonProps,
  type IconButtonProps as RawIconButtonProps,
} from "@xorkavi/arcade-gen";

export * from "@xorkavi/arcade-gen";

type NarrowSize = "md" | "lg";

export type ButtonProps = Omit<RawButtonProps, "size"> & { size?: NarrowSize };
export type IconButtonProps = Omit<RawIconButtonProps, "size"> & { size?: NarrowSize };

function coerceSize<T extends { size?: string }>(props: T): T {
  return props.size === "sm" ? { ...props, size: "md" } : props;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    return <RawButton ref={ref} {...(coerceSize(props) as RawButtonProps)} />;
  },
);

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <RawIconButton ref={ref} {...(coerceSize(props) as RawIconButtonProps)} />;
  },
);
```

- [ ] **Step 2: Run the shim test file**

Run: `pnpm run studio:test arcade-components-shim`
Expected: all tests in the file pass. Button and IconButton tests verify pass-through and coercion; type-narrowing tests verify `@ts-expect-error` directives are satisfied (TypeScript now rejects `size="sm"` on the narrowed component).

- [ ] **Step 3: Commit**

```bash
git add studio/prototype-kit/arcade-components.tsx
git commit -m "feat(studio/kit): narrow shim to hide size=\"sm\"

Shim now wraps Button/IconButton with type-narrowed (md | lg) props and
runtime sm→md coercion. The generator imports \`arcade/components\` and
therefore loses access to sm; studio shell and prototype-kit composites
import @xorkavi/arcade-gen directly and are unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Run the full studio test suite

Sanity-check that nothing else regressed. The shim is now active in Vite, Vitest, and the Vercel bundler.

- [ ] **Step 1: Run the full suite**

Run: `pnpm run studio:test`
Expected: all tests pass. If `__tests__/prototype-kit-boundary.test.ts` or any `__tests__/components/*.test.*` regressed, investigate — those are the most likely points of interference.

- [ ] **Step 2: If all pass, no commit needed.** If a regression surfaces, fix it, re-run, and commit with `fix(studio): <specific regression>`.

---

## Task 6: Manual verification in the running studio

The automated tests cover the shim's logic. This task confirms the whole pipeline (generator → Vite → rendered frame) actually emits correct JSX and renders at the expected sizes.

- [ ] **Step 1: Restart the studio dev server**

Vite middleware does not hot-reload (per studio/CLAUDE.md). You MUST restart:

```bash
# If running: kill the pnpm run studio process (Ctrl-C in its terminal)
pnpm run studio
```

Wait for browser to open localhost:5556.

- [ ] **Step 2: Ask the generator to rewrite the Skills frame**

Open the `Skills` project in studio, then send this chat prompt:

> Rewrite the Skills gallery frame. Keep the same layout and copy, but make sure every Button and IconButton uses the default size.

Wait for the turn to finish and the frame to rebuild.

- [ ] **Step 3: Inspect the emitted JSX**

Read `~/Library/Application Support/arcade-studio/projects/skills/frames/01-skills-gallery/index.tsx`. Confirm:
- No `size="sm"` appears on any `<Button>` or `<IconButton>` from `arcade/components`.
- Either `size` is omitted, or it is `"md"` / `"lg"`.

- [ ] **Step 4: Visual check in the browser**

Open `http://localhost:5556/#/project/skills`. Confirm:
- The TitleBar IconButtons (Back, Forward, Share, Search) render as 28px with a tertiary idle background — not 20px floating icons.
- The page header "Admin settings" and "Add skills" buttons render at 28px tall with visible vertical padding around the label.
- Nothing else looks worse than before (sidebar icons, message-hover Copy button) — those belong to composites that still use sm directly and should be unchanged.

- [ ] **Step 5: Spot-check a share-to-Vercel build (optional but recommended)**

From the Skills project, click "Share" → Vercel. If you have Vercel connected, confirm the deployed URL renders the same sizes as the local frame. If the esbuild alias is misconfigured, Vercel builds will either fail outright ("Could not resolve 'arcade/components'") or ship the un-narrowed behavior.

- [ ] **Step 6: Commit nothing here — this task is verification only.** If something visually regresses, file the issue against the shim or the alias config and iterate.

---

## Self-review notes (completed during plan authoring)

- **Spec coverage:** every section of the spec has a task. Shim file → Task 1 + 4. Vite/Vercel aliases → Task 2. Tests → Task 3 + 4. Manual verification → Task 6. Deployment considerations (dev-server restart) → Task 6 step 1. Rollback is trivial and called out in the spec; no task needed.
- **Placeholders:** none — every step contains either exact code, an exact command, or a concrete verification criterion.
- **Type consistency:** `ButtonProps`, `IconButtonProps`, `NarrowSize`, `coerceSize` are introduced once (Task 4) and referenced only within the same file; tests import the named re-exports `Button` and `IconButton`, which are the public API. Consistent across all tasks.
- **One accepted quirk:** Task 3 leaves the suite in a known-failing state for one commit — standard TDD red step. Task 4 resolves it. The `@ts-expect-error` directives will initially be flagged as unused during the red step; this is documented in the task notes.
