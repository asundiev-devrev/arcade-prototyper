# Prod-Code Handoff: Mapping arcade-gen → devrev-web

## Why this doc exists

Future agent: read this before you start work on this initiative. It captures a full day of discovery + the design decisions behind the chosen approach so you don't re-litigate them.

The product question: how do we make arcade-studio's generated frames useful to engineers, not just designers?

The rejected answer: "switch the studio's component library from `arcade-gen` to `devrev-web`'s production design system." We explored it thoroughly (see "Discovery" below) and chose a cheaper, better path: **keep rendering in arcade-gen, but emit prod code on demand via a mapping layer** — conceptually Figma's Code Connect, but for generated React frames.

## Target personas and what they need

1. **Designer / PM** — doesn't care what's under the hood as long as the preview looks exactly like the product. Concern: **visual fidelity**. Solved by improving arcade-gen + the agent's Figma-reading discipline. This doc doesn't address that problem; it is assumed the design-system side evolves independently.
2. **Engineer** — doesn't need the preview to *be* prod code, but must be able to lift-and-shift something useful. Concern: **code handoff**. Solved by the mapping layer below.

These are independent problems. Do not conflate them. Switching the runtime library would impose enormous port cost on (1) in service of (2) when (2) can be solved with a much cheaper transformation.

## Discovery: what's in devrev-web

Local clone: `/Users/andrey.sundiev/devrev-web/` (up to date as of 2026-04-22). The three paths the user pointed at:

### `libs/design-system/shared/raw-design-system`
- **Nx workspace library**, NOT an npm package. `project.json` only, no `package.json`. Not published anywhere.
- Consumed inside devrev-web via TS path alias `@devrev-web/design-system/shared/raw-design-system` declared in `tsconfig.base.json`.
- 76 components under `src/components/` (button, modal, drawer, tabs, menu, table, calendar, date-time-picker, agent-input, agent-lottie, agent-thought, bubble, floating-modal, cursor, and more).
- Barrel (`src/index.ts`) exports: `ThemeProvider`, `useThemeContext`, `createThemeConfig`, `useTheme`, `useIcons`, `slotDrid`, type definitions. **The components themselves re-export through `export * from './components'`.**
- Architecture: **headless primitives**. Every component calls `useTheme('componentName', themeConfig)` and renders unstyled JSX through `<Slot>`. **Without a ThemeProvider, components render unstyled.** You cannot use one component in isolation.
- Runtime deps pulled in: `@mui/base` (headless MUI), `clsx`. Button wraps `<ButtonUnstyled>` from `@mui/base`.

### `libs/design-system/shared/themes/arcade-theme`
### `libs/design-system/shared/themes/devrev-app-theme`
- Each theme is ~254 per-component theme-config objects (e.g. `buttonThemeConfig`, `modalThemeConfig`), combined into one `ThemeProviderProps` object the `<ThemeProvider>` consumes.
- Styling: `clsx` + **Tailwind utility strings** + **SCSS modules** for effects. arcade-theme has 17 `.module.scss` files (`button.module.scss` has `effect-plastic-button` and `ease-glide` keyframes).
- Tailwind classes used by theme configs reference tokens that don't exist in arcade-gen: `bg-interactive-tertiary-hovered`, `h-dynamic-base`, `shadow-interactive-focused`, `bg-primary/20`. These only resolve against devrev-web's Tailwind config.
- Tokens live in `arcade-theme/src/styles/arcade.css` + `pallete.css`. Those two files are consumable standalone.

### Why we rejected runtime-swap

To mount devrev-web components in arcade-studio you'd need:
1. Alias `@devrev-web/design-system/shared/*` to the local devrev-web clone (doable).
2. Install `@mui/base`, `clsx` in arcade-prototyper (doable).
3. Add SASS to arcade-studio's Vite config (doable).
4. Inherit devrev-web's entire Tailwind config into arcade-gen's Tailwind v4 config (**hard** — different versions, conflicting token namespaces, CSS-var vs utility mappings fight).
5. Port / re-author the prototype-kit composites (`AppShell`, `NavSidebar`, `SettingsPage`, etc.) on top of the new primitive shape.
6. Accept that every `git pull` inside devrev-web is a potential breakage vector for the studio.

Estimated cost: 1-2 weeks, high risk, and the work has to be redone every time devrev-web does a major refactor.

## Button: the structural diff (concrete evidence)

Comparing `arcade-gen/src/components/ui/Button/Button.tsx` with `devrev-web/.../raw-design-system/src/components/button/button.tsx`:

### Props
| arcade-gen | devrev-web | Translation |
|---|---|---|
| `variant: primary \| secondary \| tertiary \| destructive \| expressive` | `variant: primary \| secondary \| tertiary \| destructive` | near-identical; drop `expressive` or leave a comment |
| `size: "sm" \| "md" \| "lg"` | `size: "S" \| "M" \| "L"` | case-change |
| `iconLeft`, `iconRight` | `start`, `end` | rename |
| `loading` | `isLoading` | rename |
| `disabled` | `disabled` | same |
| — | `active`, `dropdown`+`chevron`, `skeleton`, `smart`, `alignment`, `href`, `focusableWhenDisabled`, `drid` | devrev-web extras (ignore unless the agent emits them) |

### Architecture
| axis | arcade-gen | devrev-web |
|---|---|---|
| underlying element | native `<button>` | `<ButtonUnstyled>` from `@mui/base` |
| polymorphism | `<button>` only | `<T extends ElementType>`, can render as `<a>` |
| styling | `cva` inline + CSS-var Tailwind tokens | slot-based `useTheme()`, styles in separate theme config file |
| theme required | no | **yes** — unstyled without `<ThemeProvider>` |
| files per component | 1 (`Button.tsx`) | 4 in raw + 1 theme config in each theme = 6 |
| skeleton/dropdown/smart | none | first-class |

**Key insight:** prop shapes overlap ~70% and are trivially translatable. Internal structure is completely different but **doesn't have to match** if we only need to emit a code string at handoff time.

## The chosen approach: prop-level mapping ("Code Connect for studio")

Inspired by Figma's Code Connect. The preview keeps rendering in arcade-gen. Behind a new "Production code" toggle in the dev panel, we emit a devrev-web version of the same frame via AST transformation, using per-component mapping files.

### Conceptual flow
```
frames/01-agent-screen/index.tsx      ← arcade-gen source (renders in preview)
        │
        ▼  (on "copy prod code" click)
   AST transform using *.code-connect.ts mappings
        │
        ▼
frames/01-agent-screen/index.prod.tsx ← devrev-web code, shown in dev panel
```

### Benefits over runtime-swap
- No SCSS / MUI / Tailwind-config port.
- No dependency on devrev-web's build pipeline.
- Upstream devrev-web churn doesn't break the preview.
- Incremental: ship one mapping at a time, each one is immediate value.
- Designer experience is unchanged.

### Hard problems this approach still has (read before coding)

1. **Composites (`AppShell`, `NavSidebar`, `SettingsPage`, `SettingsRow`, `BreadcrumbBar`, `PageBody`, `SettingsCard`, `TitleBar`) have no 1:1 devrev-web equivalent.** They were invented in arcade-prototyper. Two valid strategies:
   - **Decompose**: expand each composite in the mapping file to its primitive tree of devrev-web parts. Correct but laborious.
   - **Stub**: emit the composite as-is and annotate `// arcade-prototypes scaffolding — re-assemble with your page shell`. Fast, honest, developer integrates it by hand.
   
   Recommendation: stub first, decompose later as usage demands.

2. **Tailwind class leaks.** When the agent writes `<div className="text-body-large p-gutter">`, those tokens are arcade-gen-specific. devrev-web's Tailwind config doesn't have `text-body-large` or `p-gutter`.
   - Options: (a) keep the classes and prepend a file-top comment noting the arcade-specific ones; (b) maintain a token → token translation table; (c) strip and lose intent.
   - Recommendation: **(a) keep and annotate.** Designers rarely hand-roll className soup once composites are strong; this is a long tail. Engineers can replace what matters.

3. **Mapping format.** A flat prop-rename table can't express "wrap children in `<Slot>`" or "decompose composite to tree". Each mapping needs to be code, not config. Code-Connect-style colocated files:
   ```
   src/components/ui/Button/Button.code-connect.ts
   studio/prototype-kit/composites/AppShell.code-connect.ts
   ```
   Each exports `{ target: "@devrev-web/...", render: (props, children) => ast }` — the render is arbitrary JSX, not a prop table.

4. **AST transformation — not regex.** Walk the frame's imports and JSX elements with `@babel/parser` + `@babel/traverse` or `ts-morph`. For each JSX element whose name resolves to a known arcade component, look up the mapping, swap the node, rewrite the import. Emit with `@babel/generator` or `prettier`.

## MVP scope (3-5 days)

1. **Schema** — define the mapping interface and directory convention (~0.5 day).
2. **7 primitive mappings** covering 80% of what the agent emits: `Button`, `IconButton`, `Input`, `Avatar`, `Modal`, `Tabs`, `Badge` (~1 day).
3. **2 composite expansions** for the two that appear in nearly every frame: `AppShell`, `SettingsPage` (decompose approach) (~1 day).
4. **AST transform** — Vite plugin or on-demand `/api/prod-code/:slug` endpoint that reads the frame, applies mappings, returns a string (~1-1.5 days).
5. **UI** — a "Production code" toggle next to the existing `<>` toggle in the dev panel; shows the transformed file; copy button (~0.5 day).

### What "done" looks like

A designer generates a Settings frame. The preview renders via arcade-gen (unchanged). They hand it to an engineer who clicks "Production code" → "Copy" → pastes into `devrev-web/libs/.../some-feature/src/SomeFeature.tsx`. The code imports from `@devrev-web/design-system/shared/raw-design-system`, uses real `<Button variant="primary" size="M">`, and compiles inside devrev-web with minor tweaks (className soup, decomposed composites to re-wire). That's lift-and-shift for this product.

### Out of scope for MVP

- Mapping every component. The long tail is fine to add incrementally.
- Resolving Tailwind class conflicts. Ship the annotated-comment path.
- Decomposing every composite. Stub the rare ones.
- Visual-parity work between arcade-gen and prod. **Separate initiative.** That's a design-system maturity problem, not a handoff problem.

## Files that matter

- `/Users/andrey.sundiev/arcade-gen/src/components/` — arcade-gen primitive source. Mapping files should colocate here as `*.code-connect.ts`.
- `/Users/andrey.sundiev/arcade-gen/studio/prototype-kit/` — composite source. Mapping files colocate here.
- `/Users/andrey.sundiev/arcade-gen/studio/templates/CLAUDE.md.tpl` — the agent's system prompt. If mappings reveal a naming inconsistency, fix it here too.
- `/Users/andrey.sundiev/devrev-web/libs/design-system/shared/raw-design-system/src/components/<name>/<name>.tsx` — the target component for each mapping. Read the types file to get the real prop surface.
- `/Users/andrey.sundiev/devrev-web/libs/design-system/shared/themes/arcade-theme/src/index.ts` — confirms which components have theme configs (so you know what's mappable).

## Known history that affects this work

- The studio (`studio/server/claudeCode.ts`) spawns a `claude` CLI in Bedrock mode with an 8-minute turn timeout. Transforming at read time is cheap; transforming at agent time is not — keep the transform server-side and cache.
- The studio hot-reloads `CLAUDE.md` for every project on boot via `refreshStaleClaudeMd()` in `server/projects.ts`. No template change is needed for this initiative — mappings are compile-time, invisible to the agent.
- arcade-gen uses Tailwind v4 + `@source` scanning + `globals.css`. devrev-web uses Tailwind v3 (verify before writing any translation logic). See `/Users/andrey.sundiev/.claude/projects/-Users-andrey-sundiev-arcade-prototyper/memory/tailwind-v4-source-scanning.md`.

## Starting point for the next agent

If the user says "let's ship this," begin by drafting the mapping schema interface and dropping it at `studio/src/lib/codeConnect/types.ts`. Then hand-write `Button.code-connect.ts` colocated with `arcade-gen/src/components/ui/Button/` as the reference implementation. Everything else follows from having one example that compiles.

Do NOT start by building the AST transform — start by getting ONE mapping right. The AST transform is the easy part once the schema is sound.
