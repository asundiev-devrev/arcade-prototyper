// @vitest-environment node
//
// The prototype-kit must stand on its own. It is aliased by BOTH hosts — Studio
// (via studio/vite.config.ts) and Arcade Headless (which is now the primary
// tool) — so anything it reaches for that only Studio provides is broken in
// headless, and the failure is invisible: the component mounts, it just looks
// wrong.
//
// That is not hypothetical. Until 2026-08-12 the kit's Tailwind theme and type
// ramp were declared in `studio/src/styles/tailwind.css` — Studio APP code. The
// kit was satisfied by accident of being a subdirectory of Studio. In headless,
// `rounded-square-x2`, `h-control-*`, the elevations and most of the type ramp
// all resolved to nothing, so every composite rendered with the wrong type and
// geometry.
//
// Two guards here:
//   1. the kit imports nothing from studio/src (the direction that broke);
//   2. the kit's style contract is complete — it declares every custom utility
//      its own components use.
//
// The sibling prototype-kit-boundary.test.ts guards the OPPOSITE direction
// (arcade-gen must not import the kit). Neither covered this one.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KIT = path.join(STUDIO, "prototype-kit");
const KIT_CSS = path.join(KIT, "styles.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Kit source, excluding its own build scripts + examples (dev-only, not shipped). */
function kitSourceFiles(): string[] {
  return walk(KIT).filter((f) => !/\/(scripts|examples)\//.test(f));
}

describe("prototype-kit is self-contained", () => {
  it("imports nothing from studio/src", () => {
    // A kit component importing Studio app code (a hook, a store, a stylesheet)
    // resolves in Studio and fails or silently degrades in every other host.
    const forbidden = [
      /from\s+["'][^"']*studio\/src\//,
      /import\s*\(\s*["'][^"']*studio\/src\//,
      /from\s+["'](?:\.\.\/)+src\//,
      /import\s+["'][^"']*studio\/src\//,
    ];
    const offenders: string[] = [];
    for (const f of kitSourceFiles()) {
      const text = fs.readFileSync(f, "utf-8");
      for (const rx of forbidden) {
        const m = text.match(rx);
        if (m) offenders.push(`${path.relative(KIT, f)}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `prototype-kit must not import Studio app code — it is aliased by Arcade Headless too:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("ships the stylesheet that carries its style contract", () => {
    expect(fs.existsSync(KIT_CSS), "prototype-kit/styles.css is missing").toBe(true);
    const css = fs.readFileSync(KIT_CSS, "utf-8");
    expect(css).toContain("@theme");
    expect(css).toMatch(/@utility\s+text-body\b/);
  });

  it("is exported from the kit package so a host can import it", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(KIT, "package.json"), "utf-8"));
    expect(pkg.exports["./styles.css"]).toBe("./styles.css");
  });

  it("declares every custom utility its own components use", () => {
    // The real defect class: a composite referencing a class no stylesheet
    // declares. It renders as if the class weren't there — silently. SkillCard
    // shipped `text-body-medium-bold` (not in the DevRev ramp) for months, so
    // its title rendered at the inherited size.
    const css = fs.readFileSync(KIT_CSS, "utf-8");
    const declaredUtilities = new Set(
      [...css.matchAll(/@utility\s+([a-z0-9-]+)/g)].map((m) => m[1]),
    );
    // `@theme` keys become utilities by Tailwind's namespace rules:
    // --height-* → h-*, --radius-* → rounded-*, --spacing-* → p*/m*/gap-*, etc.
    const themeSuffixes = new Map<string, string[]>([
      ["--height-", ["h-"]],
      ["--width-", ["w-"]],
      ["--radius-", ["rounded-"]],
      ["--shadow-", ["shadow-"]],
      ["--spacing-", ["p-", "px-", "py-", "pt-", "pb-", "pl-", "pr-", "m-", "mx-", "my-", "gap-", "gap-x-", "gap-y-", "size-", "w-", "h-"]],
      ["--font-", ["font-"]],
    ]);
    const themeClasses = new Set<string>();
    // Digits matter: `--radius-square-x2`, `--radius-circle-x2`.
    for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):/gm)) {
      const key = m[1];
      for (const [prefix, classPrefixes] of themeSuffixes) {
        if (key.startsWith(prefix)) {
          const name = key.slice(prefix.length);
          for (const cp of classPrefixes) themeClasses.add(cp + name);
        }
      }
    }

    // Only audit the class families the kit itself defines — standard Tailwind
    // utilities (flex, gap-2, text-sm) and arbitrary values are not our problem.
    const OURS = /^(text-(?:display|title|body|system|callout|caption|numerical|code)(?:-|$)|px-page-gutter$|p[xy]?-gutter|h-control-|w-control-|rounded-(?:square|circle|bubble)|shadow-elevation-|gap-control-)/;

    const missing = new Map<string, string[]>();
    for (const f of kitSourceFiles()) {
      const text = fs.readFileSync(f, "utf-8");
      const classes = new Set<string>();
      for (const m of text.matchAll(/className=(?:"([^"]+)"|\{`([^`]*)`\})/g)) {
        for (const c of (m[1] ?? m[2] ?? "").split(/\s+/)) {
          // strip variant prefixes (hover:, md:) and leading !
          const bare = c.replace(/^!/, "").split(":").pop() ?? "";
          if (bare) classes.add(bare);
        }
      }
      for (const c of classes) {
        if (!OURS.test(c)) continue;
        if (declaredUtilities.has(c) || themeClasses.has(c)) continue;
        const key = c;
        if (!missing.has(key)) missing.set(key, []);
        missing.get(key)!.push(path.relative(KIT, f));
      }
    }
    const report = [...missing.entries()].map(([c, files]) => `${c}  (${files.join(", ")})`);
    expect(
      report,
      `these classes are used by the kit but declared nowhere, so they render as nothing:\n  ${report.join("\n  ")}`,
    ).toEqual([]);
  });
});
