// studio/src/export/figma/disambiguate.ts
import type { ColorRole } from "./types";

const ROLE_PREFIXES: Record<ColorRole, string[]> = {
  text: ["--fg-", "--surface-fg", "--input-fg", "--control-fg"],
  fill: ["--bg-", "--surface-", "--control-bg", "--input-bg"],
  stroke: ["--stroke-", "--border-", "--outline-"],
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

  const prefixes = ROLE_PREFIXES[role];
  const roleMatched = candidates.filter((c) => prefixes.some((p) => c.startsWith(p)));
  const pool = roleMatched.length > 0 ? roleMatched : candidates;

  const semantic = pool.filter(isSemantic);
  const ranked = semantic.length > 0 ? semantic : pool;

  return ranked[0];
}
