import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { buildManifestEntries } from "./kitManifest";

const require = createRequire(import.meta.url);

export interface AssetItem {
  /** Component export name, e.g. "FormModal". */
  name: string;
  /** One-line human description. */
  doc: string;
  /** Relative thumbnail path under prototype-kit/, or null if none. */
  thumb: string | null;
}

export interface IconItem {
  name: string;
  category: string;
  tags: string[];
  /** Inline SVG markup. */
  svg: string;
}

export interface AssetSection {
  kind: "composite" | "component" | "icon";
  items: AssetItem[] | IconItem[];
}

/** Doc text up to the first sentence break, collapsed to one line. */
function firstLine(doc: string): string {
  const collapsed = doc.replace(/\s+/g, " ").trim();
  const dot = collapsed.indexOf(". ");
  return dot === -1 ? collapsed : collapsed.slice(0, dot + 1);
}

export async function buildCompositeSection(kitRoot: string): Promise<AssetSection> {
  const entries = await buildManifestEntries(kitRoot);
  const items: AssetItem[] = entries.map((e) => ({
    name: e.name,
    doc: firstLine(e.doc),
    thumb: `assets-thumbs/${e.name}.png`,
  }));
  return { kind: "composite", items };
}

interface RawIcon {
  componentName: string;
  category: string;
  tags?: string[];
  svgContent: string;
}

/** Wrap arcade-gen's inner svg markup into a standalone, renderable <svg>. */
function wrapSvg(inner: string): string {
  // arcade-gen icons are authored on a 32x32 grid (every icon component ships
  // viewBox="0 0 32 32"); match it so thumbnails aren't clipped.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="currentColor">${inner}</svg>`;
}

// Arcade-gen clone root. The published @xorkavi/arcade-gen package ships only
// `dist` bundles (the icon manifest is NOT in it), so the icon manifest is only
// reachable in the dev SOURCE tree. Studio already standardises on ARCADE_GEN_ROOT
// (defaults to ~/arcade-gen) for the same reason — see claudeCode.ts / projects.ts
// / validateArcadeImports.mjs, which read $ARCADE_GEN_ROOT/src/components/icons/.
const ARCADE_GEN_ROOT =
  process.env.ARCADE_GEN_ROOT ??
  (process.env.HOME ? path.resolve(process.env.HOME, "arcade-gen") : "/__arcade_gen_unconfigured");

export async function buildIconSection(): Promise<AssetSection> {
  const candidates: string[] = [];
  // Prefer a manifest bundled into the installed package, in case a future
  // package version starts shipping one (forward-compatible; not present today).
  try {
    const pkgEntry = require.resolve("@xorkavi/arcade-gen");
    const pkgRoot = path.resolve(path.dirname(pkgEntry), "..");
    candidates.push(
      path.join(pkgRoot, "dist", "icons", "manifest.json"),
      path.join(pkgRoot, "src", "components", "icons", "manifest.json"),
    );
  } catch {
    /* package not resolvable; fall through to the source-tree clone */
  }
  // The real source today: the arcade-gen dev clone (ARCADE_GEN_ROOT).
  candidates.push(path.join(ARCADE_GEN_ROOT, "src", "components", "icons", "manifest.json"));
  let raw: string | null = null;
  for (const c of candidates) {
    try {
      raw = await fs.readFile(c, "utf-8");
      break;
    } catch {
      /* try next */
    }
  }
  if (raw === null) {
    throw new Error(
      `arcade-gen icon manifest not found (looked in: ${candidates.join(", ")})`,
    );
  }
  const parsed = JSON.parse(raw) as RawIcon[] | { icons: RawIcon[] };
  const list: RawIcon[] = Array.isArray(parsed) ? parsed : parsed.icons;
  const items: IconItem[] = list.map((i) => ({
    name: i.componentName,
    category: i.category,
    tags: i.tags ?? [],
    svg: wrapSvg(i.svgContent),
  }));
  return { kind: "icon", items };
}
