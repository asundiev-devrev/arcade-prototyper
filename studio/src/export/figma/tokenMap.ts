// studio/src/export/figma/tokenMap.ts
export type VariableSnapshotEntry = { name: string; key: string; type: string; collection: string };

/** CSS tokens whose name does NOT follow the FG/Neutral/Prominent <-> --fg-neutral-prominent
 *  rule. Maps the CSS token name -> the exact Figma variable NAME. Starts empty;
 *  real non-conformers are added during curation. */
export const OVERRIDES: Record<string, string> = {};

/** Normalize a token/variable name for comparison: lowercase, drop --, /, -, spaces. */
function norm(name: string): string {
  return name.replace(/^--/, "").replace(/[-/\s]/g, "").toLowerCase();
}

export function buildTokenMap(
  snapshot: VariableSnapshotEntry[],
  overrides: Record<string, string> = OVERRIDES,
) {
  const byNorm = new Map<string, string>();
  const byExactName = new Map<string, string>();
  for (const v of snapshot) {
    byExactName.set(v.name, v.key);
    const n = norm(v.name);
    if (!byNorm.has(n)) byNorm.set(n, v.key);
  }

  function tokenNameToVariableKey(cssTokenName: string): string | null {
    const overrideName = overrides[cssTokenName];
    if (overrideName) return byExactName.get(overrideName) ?? null;
    return byNorm.get(norm(cssTokenName)) ?? null;
  }

  return { tokenNameToVariableKey };
}
