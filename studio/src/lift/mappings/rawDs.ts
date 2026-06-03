// studio/src/lift/mappings/rawDs.ts
//
// Builds the real import specifier for a raw-design-system component.
//
// devrev-web's raw-design-system is NOT a single barrel — it's the package
// `@devrev-web-internal/design-system-shared-raw-design-system` with one
// PER-COMPONENT subpath export per component, kebab-cased:
//   Button      → .../components/button
//   IconButton  → .../components/icon-button
//   TextInput   → .../components/text-input
//   SingleSelect→ .../components/single-select
// (verified against ~1100+ Button call sites, etc., 2026-06-03 live-lift
// re-test). Emitting the bare-barrel path `@devrev-web/design-system/shared/
// raw-design-system` — the old constant — produced imports that resolve
// nowhere; that was the single material defect dragging the lift to 8/10.
//
// The subpath derives from the PRODUCTION export name (e.g. Input maps to the
// production name TextInput → /components/text-input), not the Studio name.

const RAW_DS_PKG = "@devrev-web-internal/design-system-shared-raw-design-system";

/** PascalCase / acronym component name → kebab-case subpath segment. */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Full import specifier for a raw-design-system component by its export name. */
export function rawDs(productionName: string): string {
  return `${RAW_DS_PKG}/components/${kebab(productionName)}`;
}
