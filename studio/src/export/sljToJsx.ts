import { type SljNode, isComponentNode } from "./slj";

/** JSX text: escape the two characters that aren't literal in JSX text — { and }. */
function escapeJsxText(s: string): string {
  return s.replace(/[{}]/g, (c) => `{"${c}"}`);
}

/** A double-quoted attribute string value, with embedded double-quotes escaped. */
function attrString(v: string): string {
  return `"${v.replace(/"/g, "&quot;")}"`;
}

/** Render one scalar prop to a JSX attribute, or "" to skip. */
function propAttr(key: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return `${key}=${attrString(value)}`;
  if (typeof value === "boolean") return value ? key : "";       // `disabled` / omit when false
  if (typeof value === "number") return `${key}={${value}}`;
  return ""; // non-scalar: conservatively drop
}

function propsToAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    const a = propAttr(k, v);
    if (a) parts.push(a);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/** Pure: SLJ node → JSX source string (single line per element; callers may prettify). */
export function sljToJsx(node: SljNode): string {
  // text leaf
  if (!isComponentNode(node) && node.tag === "text") {
    return escapeJsxText(node.style.characters ?? "");
  }

  const children = node.children.map(sljToJsx).join("");

  if (isComponentNode(node)) {
    const attrs = propsToAttrs(node.props);
    return node.children.length === 0
      ? `<${node.component}${attrs} />`
      : `<${node.component}${attrs}>${children}</${node.component}>`;
  }

  const cls = node.className ? ` className=${attrString(node.className)}` : "";
  return node.children.length === 0
    ? `<${node.tag}${cls} />`
    : `<${node.tag}${cls}>${children}</${node.tag}>`;
}

/** Distinct kit component names referenced anywhere in the tree (for import reconciliation). */
export function collectKitComponents(node: SljNode): string[] {
  const set = new Set<string>();
  const visit = (n: SljNode) => {
    if (isComponentNode(n)) set.add(n.component);
    n.children.forEach(visit);
  };
  visit(node);
  return [...set];
}
