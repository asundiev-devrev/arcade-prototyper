/**
 * Extract composite identifiers from a code snippet so the live-cursor
 * skeleton can draw shape hints. Recognizes:
 *   - import { A, B as C } from "@xorkavi/arcade-gen"
 *   - import Foo from "@xorkavi/arcade-gen"
 *   - import Foo, { A, B } from "@xorkavi/arcade-gen"
 *   - import Foo from "<path>/composites/<Name>"
 *   - import { A, B } from "<path>/composites/<Name>"
 *   - import Foo, { A, B } from "<path>/composites/<Name>"
 *
 * Returns a deduped, insertion-ordered array. Returns [] for content
 * that doesn't match — callers fall back to a generic skeleton shape.
 */
export function extractComposites(content: string): string[] {
  const seen = new Map<string, number>(); // name → first position

  // Mixed default + named imports from @xorkavi/arcade-gen
  const reArcadeGenMixed = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"]@xorkavi\/arcade-gen['"]/g;
  for (const m of content.matchAll(reArcadeGenMixed)) {
    if (!seen.has(m[1])) seen.set(m[1], m.index!);
    for (const tok of m[2].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && !seen.has(name)) seen.set(name, m.index!);
    }
  }

  // Named imports from @xorkavi/arcade-gen
  const reArcadeGen = /import\s*\{([^}]+)\}\s*from\s*['"]@xorkavi\/arcade-gen['"]/g;
  for (const m of content.matchAll(reArcadeGen)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && !seen.has(name)) seen.set(name, m.index!);
    }
  }

  // Plain default import from @xorkavi/arcade-gen
  const reArcadeGenDefault = /import\s+(\w+)\s+from\s*['"]@xorkavi\/arcade-gen['"]/g;
  for (const m of content.matchAll(reArcadeGenDefault)) {
    if (!seen.has(m[1])) seen.set(m[1], m.index!);
  }

  // Mixed default + named imports from composites path
  const reCompositesMixed = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (const m of content.matchAll(reCompositesMixed)) {
    if (!seen.has(m[1])) seen.set(m[1], m.index!);
    for (const tok of m[2].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && !seen.has(name)) seen.set(name, m.index!);
    }
  }

  // Named imports from composites path
  const reCompositesNamed =
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (const m of content.matchAll(reCompositesNamed)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name && !seen.has(name)) seen.set(name, m.index!);
    }
  }

  // Default imports from composites path
  const reCompositesDefault =
    /import\s+(\w+)\s+from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (const m of content.matchAll(reCompositesDefault)) {
    if (!seen.has(m[1])) seen.set(m[1], m.index!);
  }

  // Sort by position, then extract names
  return Array.from(seen.entries())
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);
}
