import type { CompactNode, IngestResult } from "./types";

export function buildFigmaContextBlock(r: IngestResult): string {
  const lines: string[] = [];
  lines.push(`<figma_context url="${r.source.url}">`);

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

  lines.push("tree:");
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
  if (n.name) parts.push(`"${n.name}"`);
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
