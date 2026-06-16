// Composites/components we intentionally do NOT render a visual thumbnail for.
// They show as a name-only tile in the panel. Reasons: invisible/utility, or
// require heavy runtime context that isn't worth faking for a thumbnail.
export const EXAMPLE_OPT_OUT: string[] = [
  "Separator",      // a thin divider — nothing meaningful to preview
  "KeyboardShortcut", // tiny inline keycap, low value
  "FrameLink",      // invisible nav wrapper (display:contents, no visible affordance) — renders nothing to preview
];
