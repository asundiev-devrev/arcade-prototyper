/**
 * Boundary test: arcade-gen/src/ (the production design system) must NOT import
 * anything from arcade-prototypes (the studio-only prototyping kit).
 *
 * Rationale: arcade-gen is now a published production package. The prototype-kit
 * stays behind with arcade-studio and is intentionally more opinionated than a
 * production library should be. A back-import would couple the production
 * library to a prototyping concern.
 *
 * Since the repo split, arcade-gen lives at $ARCADE_GEN_ROOT (default ~/arcade-gen).
 * The test is skipped if the clone isn't present so CI without it still passes.
 */
import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";

const ARCADE_GEN_ROOT = process.env.ARCADE_GEN_ROOT
  ?? path.resolve(process.env.HOME ?? "", "arcade-gen");
const SRC_DIR = path.join(ARCADE_GEN_ROOT, "src");
const CLONE_PRESENT = fsSync.existsSync(SRC_DIR);

const FORBIDDEN = [
  /from\s+["']arcade-prototypes["']/,
  /from\s+["']arcade-prototypes\//,
  /import\s*\(\s*["']arcade-prototypes["']/,
  /import\s*\(\s*["']arcade-prototypes\//,
  // Relative walks that land in studio/prototype-kit
  /from\s+["'][^"']*\/studio\/prototype-kit/,
];

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "__test__" || e.name === "__tests" || e.name.startsWith(".")) continue;
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe.skipIf(!CLONE_PRESENT)("arcade-gen/src boundary", () => {
  it("does not import from arcade-prototypes", async () => {
    const files = await walk(SRC_DIR);
    const offenders: Array<{ file: string; match: string }> = [];
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      for (const rx of FORBIDDEN) {
        const m = content.match(rx);
        if (m) offenders.push({ file: path.relative(SRC_DIR, file), match: m[0] });
      }
    }
    expect(
      offenders,
      offenders.length
        ? `arcade-gen/src/ must not import from arcade-prototypes. Violations:\n` +
            offenders.map((o) => `  ${o.file}: ${o.match}`).join("\n")
        : "",
    ).toEqual([]);
  });
});
