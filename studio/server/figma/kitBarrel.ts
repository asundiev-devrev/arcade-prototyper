/**
 * Real @xorkavi/arcade-gen export surface, for mapping-hygiene validation (D2).
 *
 * The kit-emit mappings (kitMappings.ts) name arcade-gen components and icons
 * the emitter renders (`<Button>`, `<Bell />`, …). If a mapping ever points at a
 * component the kit does NOT export — a typo, a renamed/removed export after a
 * kit bump — the generated frame imports a non-existent name and fails to build
 * on a TESTER's machine. The mapping-hygiene test asserts every mapping value is
 * a REAL export so that breakage is caught in CI instead.
 *
 * We can't `import * as kit from "@xorkavi/arcade-gen"` here: the barrel pulls
 * in gridstack via Dashboard, whose extensionless subpath import Node ESM can't
 * resolve outside vite's optimizer (see studio/vitest.config.ts). So — mirroring
 * kitTokens.ts, which parses tokens.css rather than executing the barrel — we
 * parse the kit's own published type declaration (`dist/index.d.mts`), resolved
 * from the installed package (NOT a hardcoded copy), and read its exported VALUE
 * names. This tracks the real, version-current surface without running it.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

let cachedExportNames: Set<string> | null = null;

/**
 * Resolve the kit's published declaration file (`dist/index.d.mts`) from the
 * resolvable package, so a kit version bump can't desync the allow-list. The
 * package's `exports` map doesn't expose `./package.json`, so resolve the main
 * entry and take its directory (same approach as kitTokens.resolveTokensCssPath).
 */
function resolveBarrelDtsPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen");
    return path.join(path.dirname(mainEntry), "index.d.mts");
  } catch {
    return null;
  }
}

/**
 * Parse the VALUE export names from a barrel `.d.mts`. Handles the single
 * `export { A, B as C, type D, ... }` block tsdown emits: keeps runtime values,
 * drops `type X` (and `type X as Y`) re-exports, and resolves `X as Y` to the
 * exported alias `Y` (the name consumers import).
 */
export function parseBarrelExportNames(dts: string): Set<string> {
  const names = new Set<string>();
  const re = /export\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dts))) {
    for (let raw of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (raw.startsWith("type ")) continue; // type-only re-export
      const asIdx = raw.indexOf(" as ");
      if (asIdx !== -1) raw = raw.slice(asIdx + 4).trim();
      if (raw.startsWith("type ")) continue; // `X as type Y` shouldn't occur, but guard
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) names.add(raw);
    }
  }
  return names;
}

/**
 * The set of runtime VALUE names @xorkavi/arcade-gen exports, parsed once from
 * the installed package's declaration and cached for the process. Returns an
 * empty set if the package can't be resolved/read — the caller (a test) then
 * fails loudly rather than passing vacuously, but we never throw at import time.
 *
 * Exposed `inject`/`reset` purely for tests, mirroring kitTokens.ts.
 */
export function kitExportNames(): Set<string> {
  if (cachedExportNames) return cachedExportNames;
  const p = resolveBarrelDtsPath();
  if (!p) {
    cachedExportNames = new Set();
    return cachedExportNames;
  }
  try {
    cachedExportNames = parseBarrelExportNames(readFileSync(p, "utf-8"));
  } catch {
    cachedExportNames = new Set();
  }
  return cachedExportNames;
}

/** Test seam: inject a known export set so assertions don't depend on the kit. */
export function __setKitExportNamesForTest(names: Iterable<string>): void {
  cachedExportNames = new Set(names);
}

/** Test seam: clear the cache so the next call re-reads the declaration. */
export function __resetKitExportNamesForTest(): void {
  cachedExportNames = null;
}
