// studio/src/lift/parseImports.ts
//
// Extract named imports from a frame's source text, restricted to the three
// specifier roots generated frames are allowed to use ("arcade",
// "arcade/components", "arcade-prototypes"). Other imports (react, anything
// else) are ignored — they aren't relevant to the lift mapping.
//
// Regex-based: Studio frames are small, and a TypeScript AST parse would
// pull in a heavy dependency we don't need. The grammar is constrained
// because the generator produces a narrow import style.

import type { FrameImport } from "./types";

const ARCADE_SOURCES = new Set(["arcade", "arcade/components", "arcade-prototypes"]);

// Matches: import { A, B as C, D } from "arcade";
// Captures the named-imports clause and the module specifier.
const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g;

/**
 * Generated frames may import primitives from either `"arcade"` or
 * `"arcade/components"` — both resolve to the same `prototype-kit/
 * arcade-components.tsx` barrel at build time. The lift mapping table
 * is keyed on `"arcade"`, so we collapse the two forms here. Without
 * this normalization, a frame that imports from `"arcade/components"`
 * (which is what the generator's prompt template instructs) ends up
 * in the manifest's `unmapped` list even though the table knows the
 * symbol.
 */
function normalizeSource(specifier: string): string {
  return specifier === "arcade/components" ? "arcade" : specifier;
}

export function parseImports(source: string): FrameImport[] {
  const bySource = new Map<string, Set<string>>();
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    const clause = m[1];
    const specifier = m[2];
    if (!ARCADE_SOURCES.has(specifier)) continue;
    const normalized = normalizeSource(specifier);

    const names = clause
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        // "Button as Btn" → "Button". We track the original, not the alias —
        // the mapping table is keyed on the original export.
        const asIdx = part.indexOf(" as ");
        return asIdx === -1 ? part : part.slice(0, asIdx).trim();
      });

    const set = bySource.get(normalized) ?? new Set<string>();
    for (const n of names) set.add(n);
    bySource.set(normalized, set);
  }

  return Array.from(bySource.entries()).map(([source, names]) => ({
    source,
    names: Array.from(names).sort(),
  }));
}
