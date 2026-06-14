import type { CompactNode, IngestResult } from "./types";

export function buildFigmaContextBlock(r: IngestResult): string {
  const lines: string[] = [];
  lines.push(`<figma_context url="${r.source.url}">`);

  // Reference PNG dimensions: tell the model exactly how big the attached
  // image is and how big the source node is, so it can scale spacing/sizes
  // read off the picture back to design px instead of guessing.
  if (r.png && r.png.widthPx > 0 && r.png.heightPx > 0) {
    const root = r.tree?.bbox;
    const srcNote = root ? ` (source node ${root[2]}×${root[3]}px)` : "";
    lines.push(`reference_png: ${r.png.widthPx}×${r.png.heightPx}px${srcNote} — the attached image. Geometry below is in design px.`);
    lines.push("");
  }

  // Loud token-failure notice: when variable resolution failed the tree below
  // carries raw off-palette hex. Silently shipping that is the #1 cause of
  // off-brand colors — tell the model to map each hex to the nearest token.
  const tokenFailed = r.diagnostics?.warnings?.some((w) => /variables unavailable/i.test(w));
  if (tokenFailed) {
    lines.push("token_resolution_failed: Figma variables did not resolve, so colors below are RAW HEX, not tokens.");
    lines.push("  Do NOT emit raw hex or Tailwind brackets. Map each hex to the nearest design token yourself.");
    lines.push("");
  }

  const hasTokens = Object.keys(r.tokens.colors).length
    || Object.keys(r.tokens.typography).length
    || Object.keys(r.tokens.spacing).length;
  if (hasTokens) {
    lines.push("resolved_tokens:");
    if (Object.keys(r.tokens.colors).length) {
      lines.push(`  colors: ${yamlInlineMap(r.tokens.colors)}`);
    }
    if (Object.keys(r.tokens.typography).length) {
      lines.push(`  typography: ${yamlInlineMap(r.tokens.typography)}`);
    }
    if (Object.keys(r.tokens.spacing).length) {
      lines.push(`  spacing: ${yamlInlineMap(r.tokens.spacing)}`);
    }
    lines.push("");
  }

  if (r.composites.length) {
    lines.push("suggested_composites:");
    for (const c of r.composites) {
      lines.push(`  - ${padRight(c.composite, 16)} (${c.confidence}) at ${c.path} — ${c.reason}`);
    }
    lines.push("");
  }

  lines.push("tree: (each node: type \"name\" {variant props} @[x,y,w,h in design px] fill= layout=…)");
  writeTree(r.tree, 1, lines);

  lines.push("</figma_context>");
  return lines.join("\n");
}

function writeTree(node: CompactNode, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth);
  const label = describeNode(node);
  out.push(`${indent}- ${label}`);
  for (const c of node.children ?? []) writeTree(c, depth + 1, out);
}

function describeNode(n: CompactNode): string {
  const parts: string[] = [n.type];
  // Component identity (instances) is load-bearing: it tells the model which
  // kit component this region maps to. Render it before a plain name.
  if (n.component) {
    parts.push(`"${n.component.name}"`);
    if (n.component.props) {
      const propStr = Object.entries(n.component.props)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (propStr) parts.push(`{${propStr}}`);
    }
  } else if (n.name) {
    parts.push(`"${n.name}"`);
  }
  if (n.bbox) parts.push(`@[${n.bbox.join(",")}]`);
  if (n.style?.fill) parts.push(`fill=${n.style.fill}`);
  if (n.layout) {
    parts.push(`layout=${n.layout.direction}`);
    if (n.layout.width !== undefined) parts.push(`width=${n.layout.width}`);
    if (n.layout.height !== undefined) parts.push(`height=${n.layout.height}`);
    if (n.layout.gap !== undefined) parts.push(`gap=${n.layout.gap}`);
    if (n.layout.padding) parts.push(`padding=[${n.layout.padding.join(",")}]`);
  }
  if (n.text?.content) parts.push(`text="${n.text.content.slice(0, 60)}"`);
  if (n.text?.style) parts.push(`style=${n.text.style}`);
  return parts.join(" ");
}

function yamlInlineMap(obj: Record<string, string | number>): string {
  const pairs = Object.entries(obj).map(([k, v]) =>
    typeof v === "number" ? `${k}: ${v}` : `${k}: "${v}"`);
  return `{ ${pairs.join(", ")} }`;
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
