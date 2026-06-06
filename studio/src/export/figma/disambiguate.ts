// studio/src/export/figma/disambiguate.ts
import type { ColorRole } from "./types";

// Match a CSS token to a role by the fg/bg/stroke SEGMENT anywhere in the name,
// not a leading prefix. The arcade-gen vocabulary is dominated by
// component-scoped tokens (--component-bubble-self-fg, --button-primary-bg-idle,
// --feedback-fg-alert, --object-issue-fg, --control-fg-primary-idle, …), so a
// leading-prefix match on just --fg-/--bg- would miss the majority namespace and
// fall back to the first candidate — re-introducing the Slice 0 "text resolved to
// a --bg- token" bug. Segment matching catches both the top-level semantic
// families (--fg-*, --bg-*, --stroke-*) and the component families (*-fg-*,
// *-bg-*, *-stroke-* / *-border-*).
const ROLE_SEGMENTS: Record<ColorRole, RegExp> = {
  // foreground: a -fg- / -fg$ segment, or a -text- segment (e.g. --code-inline-fg)
  text: /(^|-)(fg|text)(-|$)/,
  // background / surface fills
  fill: /(^|-)(bg|surface)(-|$)/,
  // strokes / borders / outlines / dividers
  stroke: /(^|-)(stroke|border|outline)(-|$)/,
};

/** A candidate is "semantic" if it looks like a CSS custom property (starts with --).
 *  Core library colors (e.g. "Husk/1200") do not and are preferred LAST. */
function isSemantic(name: string): boolean {
  return name.startsWith("--");
}

export function resolveTokenForRole(
  lookup: (value: string) => string[],
  resolvedValue: string,
  role: ColorRole,
): string {
  const candidates = lookup(resolvedValue);
  if (candidates.length === 0) return resolvedValue;

  // 1. Keep candidates whose name carries this role's segment.
  const seg = ROLE_SEGMENTS[role];
  const roleMatched = candidates.filter((c) => seg.test(c.toLowerCase()));
  const pool = roleMatched.length > 0 ? roleMatched : candidates;

  // 2. Prefer semantic CSS tokens over raw core colors within the pool.
  const semantic = pool.filter(isSemantic);
  const ranked = semantic.length > 0 ? semantic : pool;

  // 3. First survivor.
  return ranked[0];
}
