// studio/src/lift/detectShape.ts
//
// Map a frame's imports to a shape name. Switch-statement heuristic, not a
// model call. Ordering matters: check the most specific markers (templates)
// before the general ones (composites).

import type { FrameImport, FrameShape } from "./types";

/**
 * Arcade primitives that signal a frame is authoring form state — text
 * entry, choices, toggles. Used to split SettingsPage-based frames into
 * `settings-form` (authors state) and `settings-list` (displays state).
 *
 * Switch is intentionally excluded: a skills-gallery row with an
 * enable/disable toggle per item is a list, not a form. A genuine form
 * would also pull in Input/TextArea/Select/Checkbox.
 */
const FORM_INPUT_PRIMITIVES = new Set<string>([
  "Input",
  "TextArea",
  "Select",
  "Checkbox",
  "NumberInput",
  "DatePicker",
  "PhoneNumber",
  "RadioGroup",
]);

export function detectShape(imports: FrameImport[]): FrameShape {
  const proto = imports.find((i) => i.source === "arcade-prototypes");
  const protoNames = new Set(proto?.names ?? []);

  if (protoNames.has("VistaPage")) return "list-view";

  if (protoNames.has("SettingsPage")) {
    // Split settings frames by whether the frame actually authors form
    // state. A gallery/list inside a SettingsPage needs list-query
    // scaffolding; a profile form needs mutation + form-hook scaffolding.
    // Both live under the same page template — the import list is the
    // signal.
    const arcade = imports.find(
      (i) => i.source === "arcade" || i.source === "arcade/components",
    );
    const arcadeNames = new Set(arcade?.names ?? []);
    const hasFormInput = [...FORM_INPUT_PRIMITIVES].some((n) => arcadeNames.has(n));
    return hasFormInput ? "settings-form" : "settings-list";
  }

  // Detail-page heuristic: a frame that assembles its own page chrome
  // (TitleBar + BreadcrumbBar + PageBody) is acting like a detail view —
  // even without an explicit template.
  if (
    protoNames.has("TitleBar") &&
    protoNames.has("BreadcrumbBar") &&
    protoNames.has("PageBody")
  ) {
    return "detail";
  }

  return "ad-hoc";
}
