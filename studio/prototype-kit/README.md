# Arcade Prototype Kit

**Prototyping-only.** These composites and templates are built for arcade-studio's
frame generator. They encode DevRev page-level conventions (title bar + sidebar
+ breadcrumb bar + settings rows + centered content column, etc.) that are
intentionally too opinionated for the production `arcade` design system.

## Layout

- `composites/` — opinionated multi-part building blocks (AppShell, TitleBar,
  NavSidebar, BreadcrumbBar, PageBody, SettingsCard, SettingsRow, VistaHeader,
  VistaToolbar, VistaGroupRail, …). Each wraps one named compound frame in the
  DevRev Figma library.
- `templates/` — full-page slot-based templates (SettingsPage, ChatPage,
  VistaPage, …). Each maps to one page type that appears repeatedly in DevRev
  Figma frames.
- `index.ts` — barrel. Consumers import from `arcade-prototypes`.

## Rules

1. **`arcade-gen/src/` must not import from here.** A test enforces this. If you
   feel tempted to use a prototype-kit composite inside the production library,
   that composite probably needs to be graduated (stripped down, variants added,
   stories written) and moved to `arcade-gen/src/components/`.
2. **Compose production `arcade` components.** Never re-implement a Button,
   Switch, Separator, Breadcrumb, IconButton, etc. here — import them from
   `arcade/components` and compose.
3. **Opinion over flexibility.** Each composite bakes in the DevRev defaults
   (padding, radius, typography, gutters). Avoid `variant` props. If a designer
   needs a different shape, that's a new composite or a new template.
4. **No theme forks.** Use the same `--fg-*`, `--stroke-*`, `--surface-*`,
   `--bg-*` tokens the production library uses. Never hardcode hex/rgb.

## Why separate?

arcade-gen will eventually graduate to a published production library. When
that happens, this directory stays with arcade-studio — it is the studio tool's
template kit, not part of the public design system. The `arcade-prototypes`
alias (deliberately *not* `arcade/prototypes`) signals that separation to
anyone reading a generated frame.
