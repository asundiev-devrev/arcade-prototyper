// studio/src/lift/detectShape.ts
//
// Map a frame's arcade-prototypes imports to a shape name. Switch-statement
// heuristic, not a model call. Ordering matters: check the most specific
// markers (templates) before the general ones (composites).

import type { FrameImport, FrameShape } from "./types";

export function detectShape(imports: FrameImport[]): FrameShape {
  const proto = imports.find((i) => i.source === "arcade-prototypes");
  const names = new Set(proto?.names ?? []);

  if (names.has("VistaPage")) return "list-view";
  if (names.has("SettingsPage")) return "settings-form";

  // Detail-page heuristic: a frame that assembles its own page chrome
  // (TitleBar + BreadcrumbBar + PageBody) is acting like a detail view —
  // even without an explicit template.
  if (names.has("TitleBar") && names.has("BreadcrumbBar") && names.has("PageBody")) {
    return "detail";
  }

  return "ad-hoc";
}
