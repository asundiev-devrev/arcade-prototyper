/**
 * Extract composite identifiers from a code snippet so the live-cursor
 * skeleton can draw shape hints. Recognizes:
 *   - import { A, B as C } from "@xorkavi/arcade-gen"
 *   - import Foo from "<path>/composites/<Name>"
 *   - import { A, B } from "<path>/composites/<Name>"
 *
 * Returns a deduped, insertion-ordered array. Returns [] for content
 * that doesn't match — callers fall back to a generic skeleton shape.
 */
export function extractComposites(content: string): string[] {
  const out = new Set<string>();

  const reArcadeGen = /import\s*\{([^}]+)\}\s*from\s*['"]@xorkavi\/arcade-gen['"]/g;
  for (let m = reArcadeGen.exec(content); m; m = reArcadeGen.exec(content)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }

  const reCompositesNamed =
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (let m = reCompositesNamed.exec(content); m; m = reCompositesNamed.exec(content)) {
    for (const tok of m[1].split(",")) {
      const name = tok.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) out.add(name);
    }
  }

  const reCompositesDefault =
    /import\s+(\w+)\s+from\s*['"][^'"]*\/composites\/[^'"]+['"]/g;
  for (let m = reCompositesDefault.exec(content); m; m = reCompositesDefault.exec(content)) {
    out.add(m[1]);
  }

  return Array.from(out);
}
