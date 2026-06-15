import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const GEN_DIR = path.join(REPO_ROOT, "node_modules", "@xorkavi", "arcade-gen", "dist");

/**
 * Regression guard for the 0.34.0 incident: `react-day-picker` was removed
 * from the studio package.json because it had zero *direct* imports in our
 * source — but @xorkavi/arcade-gen's bundle `require()`s it (for DatePicker),
 * and arcade-gen does NOT declare it as a dependency. The packaged app then
 * white-screened on every frame load: "Failed to resolve import
 * react-day-picker".
 *
 * This asserts every bare module the arcade-gen bundle pulls in is actually
 * resolvable from the repo. A future "remove an unused dep" that breaks a
 * transitive/undeclared arcade-gen need fails here instead of in a tester's
 * installed app.
 */
function externalsFromArcadeGen(): string[] {
  const files = fs
    .readdirSync(GEN_DIR)
    .filter((f) => /\.(cjs|mjs|js)$/.test(f) && !f.endsWith(".map"));
  const specifiers = new Set<string>();
  const patterns = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /from\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(GEN_DIR, file), "utf-8");
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const spec = m[1];
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;
        // Normalize to the package root (scoped: keep @scope/name).
        const pkg = spec.startsWith("@")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
        specifiers.add(pkg);
      }
    }
  }
  return [...specifiers].sort();
}

describe("@xorkavi/arcade-gen runtime dependencies", () => {
  const installed = fs.existsSync(GEN_DIR);

  it.skipIf(!installed)("every module the bundle imports is resolvable from the repo", () => {
    const require = createRequire(path.join(REPO_ROOT, "package.json"));
    const externals = externalsFromArcadeGen();
    expect(externals.length).toBeGreaterThan(0);

    const unresolved: string[] = [];
    for (const spec of externals) {
      try {
        require.resolve(spec);
      } catch {
        unresolved.push(spec);
      }
    }
    expect(
      unresolved,
      `arcade-gen requires these modules but they don't resolve — a removed dependency? ${unresolved.join(", ")}`,
    ).toEqual([]);
  });

  it.skipIf(!installed)("react-day-picker specifically resolves (0.34.0 regression)", () => {
    const require = createRequire(path.join(REPO_ROOT, "package.json"));
    expect(() => require.resolve("react-day-picker")).not.toThrow();
  });
});
