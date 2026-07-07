import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PKG_PATH = path.join(REPO_ROOT, "package.json");

/**
 * Regression guard for the 0.42.0 incident: `studio/server/codeWriter/*.ts`
 * `import ts from "typescript"` at module top-level. Those modules are
 * statically imported by live middleware (visualEdit, kitProps), which
 * `studio/vite.config.ts` imports at config-load time. So merely LOADING the
 * Vite config eagerly requires `typescript` — but `typescript` was a
 * devDependency, so electron-builder pruned it from the packaged .app and Vite
 * died at config load: the app never served :5556 and the window stayed blank.
 *
 * A package imported at runtime by shipped server code MUST live in
 * `dependencies`, never `devDependencies` — electron-builder bundles the former
 * and strips the latter. This test statically scans the runtime server tree
 * for bare (non-relative, non-node:) imports and fails if any resolves to a
 * devDependency.
 *
 * NOTE: this is the cheap config-shape guard (Layer 1). It proves *intent* —
 * that the dep is declared in the right section. It does NOT prove the packaged
 * .app actually bundled it; that is the release-gate bundle check (Layer 2),
 * which greps the built app. See
 * docs/superpowers/specs/2026-07-07-update-experience-and-hotfix-design.md.
 */

// Directories whose code runs at runtime in the packaged app (server + the
// Vite config that imports it). We deliberately exclude __tests__, scripts, and
// the React client (studio/src) — those either don't ship or are bundled by
// Vite differently. The crash path is server code reachable from vite.config.ts.
const RUNTIME_DIRS = [
  path.join(REPO_ROOT, "studio", "server"),
  path.join(REPO_ROOT, "studio", "vite.config.ts"),
];

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

function collectTsFiles(target: string, out: string[]): void {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (/\.(ts|tsx|mts|cts)$/.test(target) && !/\.d\.ts$/.test(target)) out.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    collectTsFiles(path.join(target, entry), out);
  }
}

/** Bare package specifiers imported anywhere in the runtime server tree,
 *  normalized to their package root (scoped packages keep @scope/name). */
function runtimeBareImports(): string[] {
  const files: string[] = [];
  for (const dir of RUNTIME_DIRS) {
    if (fs.existsSync(dir)) collectTsFiles(dir, files);
  }
  const specifiers = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf-8");
    for (const re of IMPORT_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const spec = m[1];
        if (spec.startsWith(".") || spec.startsWith("node:")) continue;
        const pkg = spec.startsWith("@")
          ? spec.split("/").slice(0, 2).join("/")
          : spec.split("/")[0];
        specifiers.add(pkg);
      }
    }
  }
  return [...specifiers].sort();
}

describe("packaged runtime dependencies", () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  const devDeps = new Set(Object.keys(pkg.devDependencies ?? {}));

  it("every package imported by runtime server code is in dependencies, not devDependencies", () => {
    const imported = runtimeBareImports();
    expect(imported.length).toBeGreaterThan(0);

    // A specifier is a problem only if it's a real npm package we ship AND it's
    // misclassified as a devDependency (or missing entirely). Path aliases and
    // builtins never reach here (filtered above); anything neither declared nor
    // a devDep is an alias/virtual (e.g. "arcade", "virtual:…") and is ignored.
    const misclassified = imported.filter((spec) => devDeps.has(spec) && !deps.has(spec));

    expect(
      misclassified,
      `these packages are imported at runtime by server code but declared as ` +
        `devDependencies — electron-builder will strip them from the packaged ` +
        `.app and it won't boot (the 0.42.0 bug). Move them to "dependencies": ` +
        misclassified.join(", "),
    ).toEqual([]);
  });

  it("typescript specifically is a runtime dependency (0.42.0 regression)", () => {
    // codeWriter imports it eagerly via the visual-edit middleware chain.
    expect(deps.has("typescript")).toBe(true);
    expect(devDeps.has("typescript")).toBe(false);
  });
});
