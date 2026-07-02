/**
 * Eject a kit composite/template's real source into a frame folder so the
 * agent can EDIT it directly, instead of being stuck with the sealed barrel
 * export (whose props expose only a handful of overrides). Copies the .tsx and
 * rewrites its imports to the frame-legal specifiers ("arcade-prototypes",
 * "arcade/components") the frame aliases resolve.
 *
 * Why the agent can't do this itself: CLAUDE.md.tpl forbids reading composite
 * source, and the relative `./X.js` imports inside the kit source don't resolve
 * from a frame folder. The rewrite is the bridge.
 *
 * See spec 2026-07-02-figma-fidelity-eject-and-directive-design.md §2.2.
 */
import fs from "node:fs/promises";
import path from "node:path";

const STUDIO_DIR = path.resolve(__dirname, "..", "..");
const KIT_DIR = path.join(STUDIO_DIR, "prototype-kit");

/**
 * Rewrite a single composite's import lines to frame-legal specifiers.
 * Per-specifier (preserves `as` aliases + `type` qualifiers); does NOT touch
 * `react` or already-barrel imports. Pure.
 */
export function rewriteCompositeSource(src: string): string {
  return src.replace(
    /^(import\s+(?:type\s+)?(?:\{[^}]*\}|[^;'"]+?)\s+from\s+)["']([^"']+)["'](\s*;?)$/gm,
    (full, head: string, spec: string, tail: string) => {
      let next: string | null = null;
      if (spec === "@xorkavi/arcade-gen") next = "arcade/components";
      else if (/^\.\.?\//.test(spec)) next = "arcade-prototypes"; // any relative → barrel
      if (next === null) return full;
      return `${head}"${next}"${tail}`;
    },
  );
}

/**
 * Copy `<name>.tsx` from the kit (composites first, then templates) into
 * `destDir`, with imports rewritten. Returns the written file path. Throws if
 * the composite isn't found in either location.
 */
export async function ejectComposite(name: string, destDir: string): Promise<string> {
  const candidates = [
    path.join(KIT_DIR, "composites", `${name}.tsx`),
    path.join(KIT_DIR, "templates", `${name}.tsx`),
  ];
  let srcPath: string | null = null;
  for (const c of candidates) {
    try { await fs.access(c); srcPath = c; break; } catch { /* try next */ }
  }
  if (!srcPath) throw new Error(`ejectComposite: no kit source for "${name}" in composites/ or templates/`);

  const src = await fs.readFile(srcPath, "utf8");
  const rewritten = rewriteCompositeSource(src);
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, `${name}.tsx`);
  await fs.writeFile(dest, rewritten);
  return dest;
}
