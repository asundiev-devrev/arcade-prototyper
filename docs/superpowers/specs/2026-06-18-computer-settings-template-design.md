# Computer: Settings — Multi-Page Template Design Spec

**Date:** 2026-06-18
**Status:** Approved design, ready for implementation plan
**Branch:** `feat/homepage-templates` (continues the homepage-templates work)
**Figma:** `41Jsf6MLsvu1TfSeftIq8M`, page "Computer: Settings" (node `116:1613`)

## Goal

Turn today's single-page "Computer: Skills settings" template into a full **"Computer: Settings"** template: one interactive frame with a 240px Computer-Settings sidebar where clicking any nav item swaps the body to that settings page. Ten pages total, matching the Figma 1:1 in structure and DevRev fidelity.

This replaces the current `settings-page` template (a single Skills page). On the homepage, the card renames from "Computer: Skills settings" to **"Computer: Settings"**; the old Skills page becomes one of the ten pages inside.

## Core mechanic — one interactive frame, in-frame nav

Picking the template seeds a **single frame** (`frames/01-computer-settings/index.tsx` + supporting files). The frame holds React state for the active page:

```
const [active, setActive] = useState<PageId>("my-computer");
```

The sidebar rows call `setActive(id)`; the body renders the matching page via a `switch`. No multi-frame prototype, no `FrameLink`, no generation turn, no chat. The whole thing is one self-contained, clickable React frame — exactly like `ComputerScene`'s built-in session switching, scaled to 10 pages.

Default page on open: **My Computer**.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Manifestation | One interactive frame; sidebar click → `useState` swaps the body |
| Page set | All 10 sidebar items, full fidelity |
| Brand logos (Connectors) | Inline-SVG brand logos hand-embedded in the seed |
| User avatars | arcade-gen `Avatar` initials (no photos) |
| Charts (Usage, Plans KPIs) | Simple CSS bars / KPI tiles — no chart library |
| Build order | In waves: shell + sidebar + 3–4 representative pages first (verify nav end-to-end), then the rest |
| Seed mechanic | Seed becomes a **directory**; `seedTemplateFrame` copies the tree |

## The ten pages + layout archetypes

The sidebar (verbatim from Figma), in three groups:

- **(top, no header):** Profile, Preferences
- **Customization:** My Computer, Workflows & Tools, Skills, Connectors
- **Account:** Organization, Users, Plans & Billing, Usage

The ten pages reduce to **five reusable body archetypes**, so we author five patterns, not ten bespoke layouts:

| Page | id | Archetype | Key content |
|---|---|---|---|
| Profile | `profile` | settings-form | avatar + name/email fields; "Delete account" danger row |
| Preferences | `preferences` | settings-form | appearance/language `Select`s, notification `Switch`es |
| My Computer | `my-computer` | settings-form + sub-tabs (General / Desktop app) | Run on start-up, File Directory, Quick-access shortcut, Menu bar — all `SettingsRow` + `Switch` |
| Workflows & Tools | `workflows-tools` | card-grid | tool cards (`SkillCard`-style) |
| Skills | `skills` | card-grid | the existing Skills content, lifted from today's `settings-page.tsx` seed |
| Connectors | `connectors` | connector-grid | 2-col brand tiles + "Connected" `Tag`; **inline-SVG logos**; "Add custom connector" button |
| Organization | `organization` | settings-form | org name/logo fields; danger zone |
| Users | `users` | table | tabs (Users 234 / Invitations 4), filter pills, Name/Role table with `Avatar` initials + row menu; "Invite users" button |
| Plans & Billing | `plans-billing` | settings-form + KPI tiles | plan summary card, 3 metric tiles (one with a progress bar), billing-details `SettingsCard` |
| Usage | `usage` | metrics | KPI tiles + simple CSS bars |

## Architecture — seed directory

The seed is too large for one file and frames natively support sibling imports (real frames already do `import ... from "./Overlay.tsx"`; the esbuild/Vite bundler bundles the whole tree from `index.tsx`). So the seed is a directory:

```
prototype-kit/template-seeds/
  computer-settings/
    index.tsx                      ← default export: stateful shell (sidebar + active body switch)
    ComputerSettingsSidebar.tsx    ← 240px nav: window chrome, "‹ Settings" back row, 3 groups, active state
    types.ts                       ← PageId union + the nav-item config array (id, label, icon, group)
    brandLogos.tsx                 ← inline-SVG connector logos keyed by brand
    pages/
      Profile.tsx
      Preferences.tsx
      MyComputer.tsx
      WorkflowsTools.tsx
      Skills.tsx
      Connectors.tsx
      Organization.tsx
      Users.tsx
      PlansBilling.tsx
      Usage.tsx
```

`ComputerSettingsSidebar` and the page files live **inside the seed dir**, not in the shared kit — they are template-specific chrome, not reusable composites. They import shared primitives from `arcade-prototypes` / `arcade/components`.

### Shared chrome

- **`ComputerSettingsSidebar`** — 240px fixed column: window traffic-lights + collapse icon (chrome), a "‹ Settings" back row, then the three nav groups. Each row is an icon + label; clicking calls `onSelect(id)`; the `active` row is highlighted (matches the Figma's grey active pill). Sidebar icons (all confirmed present in arcade-gen): Profile `HumanSilhouette`, Preferences `ArrowsLeftAndRight`, My Computer `Computer`, Workflows & Tools `ThreeBarsHorizontal`, Skills `LightingBolt`, Connectors `Mcp`, Organization `Buildings`, Users `TwoHumanSilhouettes`, Plans & Billing `CreditCard`, Usage `Dashboard`.
- **Shell body** — for the active page: a scrollable column with a breadcrumb ("Settings › <Page>"), an `h1` title, a subtitle, then the page component. The breadcrumb/title/subtitle live in the shell so the page files only own their unique body content.

### Page-body archetypes (built once, reused)

- **settings-form** — `SettingsCard` + `SettingsRow` + `Switch`/`Input`/`Select` (the existing `settings-form` fixture is the reference shape).
- **card-grid** — responsive grid of `SkillCard`-style tiles (Skills lifts today's seed content).
- **connector-grid** — 2-column grid of bordered tiles: inline-SVG logo + name + optional "Connected" `Tag`.
- **table** — `Table` (or row composite) with `Avatar` initials, role text, `ThreeDotsHorizontal` menu; tabs + filter pills above.
- **metrics** — KPI tiles (label + big number) and simple CSS progress bars (`<div>` track + filled `<div>` width %, using `--purple`/accent tokens).

## Seed mechanic change

`seedTemplateFrame` today reads one `.tsx` and writes it to `frames/01-<id>/index.tsx`. Change it to handle **either**:

- a **single `.tsx` file** seed (Computer, Builder) → copy as today, and
- a **directory** seed (Computer: Settings) → recursively copy the whole tree into `frames/01-<id>/`.

Detection: `fs.stat` the seed path; if it's a directory, recursive copy; else read+write the file. `readTemplateSeed` stays for the file case; a new `copyTemplateSeed(id, destDir)` (or an internal branch) handles the directory case. The thumbnail script (`buildTemplateThumbs`) must do the same — it currently `readTemplateSeed`s one file; for a directory seed it packs the dir's `index.tsx` after making the sibling files reachable (pack from the dir, not a lone string).

`TemplateDef.seedFile` becomes "the seed entry" — for a directory template it's the directory name (`computer-settings`), and the resolver checks dir-vs-file.

## Manifest + homepage

- The `settings-page` template entry is **replaced** by `computer-settings`:
  `{ id: "computer-settings", name: "Computer: Settings", description: "Full Computer settings", seedFile: "computer-settings", thumb: "computer-settings.png" }`.
- `TemplateId` union: `"computer" | "computer-settings" | "builder-page"`.
- HomePage name map: `"computer-settings": "Computer: Settings"` (replacing the `settings-page` entry).
- The old `settings-page.tsx` single-file seed + `settings-page.png` thumb are removed (its Skills content moves into `pages/Skills.tsx`).

## Thumbnail

`buildTemplateThumbs` renders each template's `index.tsx` to a wide PNG. The current path is `packFromSource({ tsx })`, which writes ONLY a single `index.tsx` string into a temp `frames/01-frame/` dir then bundles from it — so sibling imports (`./ComputerSettingsSidebar`, `./pages/*`) would be missing for a directory seed.

Fix: add a sibling helper `packFromDir(seedDir, { theme, mode })` in `server/sidecar/` that recursively copies the seed directory into the temp `frames/01-frame/` dir (preserving `index.tsx` + all siblings) and then calls `buildFrameBundle` with that `framePath` (the bundler bundles from `<framePath>/index.tsx` and resolves relative imports). `buildTemplateThumbs` chooses `packFromDir` when the seed resolves to a directory, else `packFromSource` as today. The rendered shell shows its default page (My Computer) inside the sidebar — one PNG, committed as `computer-settings.png`. Confirm the PNG is a real render (not blank/error) before committing.

## Error handling

- Any page component that throws must not blank the whole frame — but per kit convention frames don't ship error boundaries; instead each page is authored to render with its own static data (no external fetch), so there is nothing to fail at runtime.
- Unknown `active` id falls through the `switch` to the default page (My Computer).
- Inline-SVG logos that are missing fall back to a neutral letter tile (same pattern as the homepage thumbnail's `onError`, but here it's a build-time authoring guarantee — every connector listed has an SVG).

## Testing

- **Seed mechanic (directory copy):** `seedTemplateFrame` with `computer-settings` writes `frames/01-computer-settings/index.tsx` AND the sibling files (`ComputerSettingsSidebar.tsx`, `pages/*.tsx`) into the project; single-file templates (computer, builder-page) still copy as before.
- **Manifest:** id set is `["builder-page", "computer", "computer-settings"]`; freshness guard (every manifest entry has a committed thumb) still passes for 3 templates.
- **Shell nav (focused render test):** render the seed's shell, assert the default page (My Computer) body is visible; simulate selecting another nav id and assert the body swaps. (Component test mocks `@xorkavi/arcade-gen` — must include every primitive the shell + visible page use: `Switch`, `Table`, `Tag`, `Avatar`, `Select`, `Input`, `Checkbox`, `Button`, `IconButton`, plus `NavSidebar`/`SettingsCard`/`SettingsRow`/`SkillCard` from `arcade-prototypes`.)
- **Renders without crash:** the existing `templatesMiddleware` freshness test + a render smoke check via the thumbnail build (build fails loudly if the seed doesn't compile).
- **HomePage name map:** picking `computer-settings` creates a project named "Computer: Settings".
- Run the FULL suite before committing; the only pre-existing-acceptable state is a green suite (the stale hero test was fixed earlier).

## Build waves (per the locked decision)

1. **Wave 1 — shell mechanic + skeleton:** directory-seed copy in `seedTemplateFrame` + thumbnail packing; `index.tsx` shell + `ComputerSettingsSidebar` + `types.ts`; 3–4 representative pages covering distinct archetypes (My Computer = settings-form, Skills = card-grid, Connectors = connector-grid, Users = table). Manifest/HomePage/tests updated. Verify nav switches bodies live, thumbnail renders.
2. **Wave 2 — remaining pages:** Profile, Preferences, Workflows & Tools, Organization, Plans & Billing, Usage. Each is "add one `pages/*.tsx` + wire it into the switch + the sidebar already lists it." Re-render thumbnail if the default page changed (it won't).

Each wave ends green + visually verified in the running app.

## Out of scope (YAGNI)

- Multi-frame / FrameLink navigation (explicitly rejected — one interactive frame).
- Real chart library for Usage (simple CSS bars only).
- Real avatar photos (Avatar initials).
- Making `ComputerSettingsSidebar` a reusable shared kit composite (it's template-specific; lives in the seed dir).
- Functional form state beyond what reads naturally (toggles can be visually on/off with local state; no persistence).
- Adding pages beyond the Figma's ten.
