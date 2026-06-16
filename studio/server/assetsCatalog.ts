import { buildManifestEntries } from "./kitManifest";

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

/** First sentence of a multi-line doc, collapsed to one line. */
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
