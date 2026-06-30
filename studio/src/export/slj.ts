// Studio Layout JSON (SLJ) v1 — the component-aware contract every Figma-export
// producer and consumer shares. See docs/superpowers/specs/2026-06-05-figma-export-design.md.

export const SLJ_VERSION = 1 as const;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Auto-layout for a container, or null when the container is "irregular"
 *  (absolute children / overlap / negative margins) and children carry
 *  absolute geometry for the fallback path. */
export interface Layout {
  mode: "horizontal" | "vertical";
  gap: number;
  /** [top, right, bottom, left] in px. */
  padding: [number, number, number, number];
  align: "start" | "center" | "end" | "stretch";
}

export interface ElementStyle {
  /** Token name(s) (e.g. "--bg-neutral-soft") when resolvable, else a raw "#rrggbb"/rgb() string. */
  fill?: string;
  cornerRadius?: number;
  stroke?: { color: string; width: number };
  // text-only:
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
}

export interface ComponentNode {
  kind: "component";
  component: string;
  source: "arcade/components" | "arcade-prototypes";
  props: Record<string, unknown>;
  box: Box;
  layout: Layout | null;
  children: SljNode[];
  /** arcade-gen icon name of the glyph inside this component (e.g. an
   *  IconButton's "ChevronLeftSmall"), captured at prune time. Absent for
   *  components with no recognized icon. */
  icon?: string;
}

export interface ElementNode {
  kind: "element";
  tag: string; // "div" | "text" | "img" | ...
  /** The host element's literal class attribute, for JSX emission (Customize).
   *  Absent on text nodes and the Figma-export path (which ignores it). */
  className?: string;
  box: Box;
  layout: Layout | null;
  style: ElementStyle;
  children: SljNode[];
}

export type SljNode = ComponentNode | ElementNode;

export interface SljDocument {
  slj: typeof SLJ_VERSION;
  frame: { slug: string; project: string; width: number; mode: "light" | "dark" };
  root: SljNode;
}

export function isComponentNode(n: SljNode): n is ComponentNode {
  return n.kind === "component";
}
export function isElementNode(n: SljNode): n is ElementNode {
  return n.kind === "element";
}
