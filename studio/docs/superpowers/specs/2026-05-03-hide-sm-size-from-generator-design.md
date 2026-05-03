# Hide `size="sm"` from the generator

_Status: spec — awaiting user review._
_Scope: studio only (Scope B, carve-out). arcade-gen unchanged._

## Problem

The studio generator repeatedly picks `size="sm"` on `<Button>` and `<IconButton>` imported from `arcade/components`. Concrete render consequences observed in the `Skills` project (`projects/skills/frames/01-skills-gallery/index.tsx`):

- `<IconButton variant="tertiary" size="sm">` → 20×20, zero padding, transparent background. The TitleBar "row of squished plain icons" symptom.
- `<Button variant="primary" size="sm">` / `<Button variant="tertiary" size="sm">` → 20px tall, `px-2`, 11px text, **zero vertical padding** (Button's CVA controls height only via `--control-size-small`, never `py-*`). Buttons read as inline links.

The Figma design system (per [`~/arcade-gen/src/components/ui/IconButton/IconButton.tsx:17-18`](../../../../arcade-gen/src/components/ui/IconButton/IconButton.tsx#L17-L18)) uses only Default (28px / `md`) and Large (40px / `lg`). The `sm` variant is documented in-source as "kept for flexibility" — a fallback, not a design choice.

Per the scalable-accuracy principle in auto-memory (`feedback_scalable_accuracy.md`): fixes must address the **class** of failure, not individual frames. The class here is "agent picks an off-Figma control size."

## Goal

Make `size="sm"` **unreachable from generator-authored frame code**, without changing arcade-gen or studio's own shell code. Curated composite code that already uses `sm` intentionally is preserved.

## Non-goals

- No changes to `@xorkavi/arcade-gen` (neither source nor dist).
- No changes to studio shell code that imports `@xorkavi/arcade-gen` directly (e.g., `AppSettingsModal.tsx`, `ProjectList.tsx`). Those `sm` usages stay.
- No changes to `prototype-kit/composites/*.tsx`. All three composites that use `size="sm"` (TitleBar, ComputerSidebar, ChatMessages) already import from `@xorkavi/arcade-gen` directly, so they are naturally carved out.
- No new PostToolUse hook. No new prompt rule in project CLAUDE.md. No KIT-MANIFEST edits.
- Do not hand-patch the existing `projects/skills/…/index.tsx` frame — next regeneration will use the narrowed surface and emit correct JSX.

## Design

### 1. New shim file: `studio/prototype-kit/arcade-components.tsx`

Thin re-export of `@xorkavi/arcade-gen` with `Button` and `IconButton` replaced by wrappers whose types and runtime both refuse `"sm"`.

```tsx
// studio/prototype-kit/arcade-components.tsx
//
// Generator-facing surface for `arcade` / `arcade/components`. Re-exports
// @xorkavi/arcade-gen verbatim, except Button and IconButton are narrowed
// to size "md" | "lg" — sm is intentionally unreachable from agent-authored
// frame code. Studio shell and prototype-kit composites import the real
// arcade-gen package directly and keep full access.

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

// Runtime coercion: if something bypasses the type narrowing (dynamic prop,
// JS caller, etc.), silently upgrade to md rather than rendering the 20px
// squished variant.
function coerce<T extends { size?: string }>(props: T): T {
  return props.size === "sm" ? { ...props, size: "md" } : props;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    return <RawButton ref={ref} {...(coerce(props) as RawButtonProps)} />;
  },
);

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    return <RawIconButton ref={ref} {...(coerce(props) as RawIconButtonProps)} />;
  },
);
```

Notes:
- Filename chosen to roughly mirror the alias specifier (`arcade/components` → `arcade-components.tsx`). It contains JSX, so the extension is `.tsx`.
- `export *` comes first; named `Button`/`IconButton` overrides win per ES module resolution.
- `forwardRef` preserves the parent component API for refs (composites may pass them).

### 2. Vite alias update: `studio/vite.config.ts`

Change lines 64-69 from:

```ts
alias: [
  { find: /^arcade\/components$/, replacement: "@xorkavi/arcade-gen" },
  { find: /^arcade$/, replacement: "@xorkavi/arcade-gen" },
  { find: "arcade-studio", replacement: path.resolve(__dirname, "src") },
  { find: "arcade-prototypes", replacement: path.resolve(__dirname, "prototype-kit") },
],
```

to:

```ts
alias: [
  { find: /^arcade\/components$/, replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
  { find: /^arcade$/,              replacement: path.resolve(__dirname, "prototype-kit/arcade-components.tsx") },
  { find: "arcade-studio",         replacement: path.resolve(__dirname, "src") },
  { find: "arcade-prototypes",     replacement: path.resolve(__dirname, "prototype-kit") },
],
```

Both `arcade` and `arcade/components` point at the shim. Project CLAUDE.md lists both as legal import roots ("R2. Closed-world imports"); narrowing only one leaves a trivial bypass.

### 3. Also update the Vercel bundler

`studio/server/vercel/bundler.ts` applies the same `arcade`/`arcade/components` → `@xorkavi/arcade-gen` remap for shared-to-Vercel builds. Repoint it to the shim too so that a generator frame shared via Vercel behaves identically to how it renders in the app.

Audit this path when implementing — the exact alias mechanism may be esbuild's `resolvePlugin` or a path alias; either way, the replacement target moves to the shim file.

## Carve-outs verified

| Caller | Import source | Effect of shim |
|---|---|---|
| `prototype-kit/composites/TitleBar.tsx` | `@xorkavi/arcade-gen` | Unaffected — keeps `sm` |
| `prototype-kit/composites/ComputerSidebar.tsx` | `@xorkavi/arcade-gen` | Unaffected — keeps `sm` |
| `prototype-kit/composites/ChatMessages.tsx` | `@xorkavi/arcade-gen` | Unaffected — keeps `sm` |
| `src/components/shell/AppSettingsModal.tsx` | `@xorkavi/arcade-gen` | Unaffected — keeps `sm` |
| `src/routes/ProjectList.tsx` | `@xorkavi/arcade-gen` | Unaffected — keeps `sm` |
| Generator-authored frames under `projects/*/frames/**/*.tsx` | `arcade` / `arcade/components` | **Narrowed — `sm` is unreachable** |

The generator writes `import … from "arcade/components"` per project CLAUDE.md rule R2. There is no other legal import root for primitives. The shim is therefore a hermetic bottleneck for agent-authored code.

## Testing

### New: `studio/__tests__/components/arcade-components-shim.test.tsx`

- Renders `<Button size="sm">Save</Button>` through the shim (imported from `../../prototype-kit/arcade-components`) and asserts the resulting `<button>` has `h-(--control-size-default)` (or equivalent — snapshot the className substring), **not** `h-(--control-size-small)`.
- Renders `<Button size="md">` and `<Button size="lg">` and asserts each preserves its corresponding control-size class.
- Same three cases for `<IconButton>`.
- Type-level test at file top using `// @ts-expect-error`:
  ```ts
  // @ts-expect-error — size="sm" is intentionally unreachable via the shim
  <Button size="sm">x</Button>;
  ```
- Confirms `forwardRef` is intact: pass a ref, assert it receives an `HTMLButtonElement`.

### Existing suites — must still pass

- `__tests__/prototype-kit-boundary.test.ts` — the kit's `arcade-gen/src → arcade-prototypes` boundary check. Shim lives under `studio/prototype-kit/`, not `arcade-gen/src/`, so the test's scan region is unchanged.
- `__tests__/components/*.test.tsx` — these already mock `@xorkavi/arcade-gen` (per studio/CLAUDE.md: "mock must export `Modal`, `Input`, `Button`, etc. that the component uses — keep up to date"). The shim only affects Vite-time resolution, not Vitest's module graph, so these mocks keep functioning.
- Full run: `pnpm run studio:test`.

### Manual verification

1. Regenerate the Skills frame (or prompt the agent to author a fresh frame that includes a `<Button>` or `<IconButton>`).
2. Confirm the emitted JSX either omits `size` or uses `md`/`lg`. If it still writes `size="sm"` (defying the TS types because agent doesn't always typecheck), the runtime coercion catches it — visual render is still 28px.
3. Browser-check the Skills frame in studio: title bar icon cluster should show 28px buttons with tertiary idle bg, not floating 20×20 icons. Header "Admin settings" / "Add skills" should be 28px tall with correct vertical padding.

## Deployment considerations

- Vite dev server needs a full restart after `vite.config.ts` edits (per studio/CLAUDE.md: "Vite middleware does NOT hot-reload"). Same restart rule applies to new alias targets.
- The DMG packaging path (`packaging/build.sh`) ships the full `studio/` tree; the shim file goes along automatically. No packaging-script changes required.
- Beta testers on an older DMG keep the current behavior until they take the next release — this is a non-breaking, studio-internal plumbing change, so it's safe to ship in the next point release without a feature flag.

## Rollback

Single-file revert: set the two Vite aliases back to `"@xorkavi/arcade-gen"` and delete the shim. No data migrations, no persisted settings to unwind, no other code depends on the shim existing.
