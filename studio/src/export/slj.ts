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

/** One rendered border edge: a color + a width in px. */
export interface BorderSide {
  color: string;
  width: number;
}

export interface ElementStyle {
  /** Token name(s) (e.g. "--bg-neutral-soft") when resolvable, else a raw "#rrggbb"/rgb() string. */
  fill?: string;
  /** Uniform corner radius (all four corners equal). */
  cornerRadius?: number;
  /** Per-corner radii, present only when the four corners differ. */
  corners?: { tl: number; tr: number; br: number; bl: number };
  /** Legacy uniform stroke. Retained for back-compat; new code uses `borders`. */
  stroke?: { color: string; width: number };
  /** Per-side borders, keyed by edge. Only sides with width>0 and a visible
   *  style are present (e.g. a divider is `{ bottom: … }`). */
  borders?: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
  /** Clockwise rotation in degrees from a CSS `transform: rotate(...)`. Absent
   *  when there is no rotation. box.width/height are the UN-rotated size. */
  rotation?: number;
  /** True when computed overflow/overflow-x/overflow-y is hidden/clip/auto/scroll. */
  clip?: true;
  /** First box-shadow parsed from computed style. */
  shadow?: { color: string; x: number; y: number; blur: number; spread: number };
  /** Opacity < 1 from computed style. Absent means fully opaque. */
  opacity?: number;
  // text-only:
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
  // svg-only:
  /** SVG markup string for vector icons. Figma parses this natively via createNodeFromSvg. */
  svg?: string;
  // image-only:
  /** Base64-encoded PNG pixel data (no data: prefix). Present on img elements. */
  imageData?: string;
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
  /** PIXEL FLOOR for mapped components. The component's OWN visual style (fill,
   *  border, radius, shadow — NOT its internal subtree, which is pruned) so that
   *  when the real Figma instance can't be created (the cold-import wall), the
   *  runtime still paints a faithful box instead of drawing nothing. Absent when
   *  the primitive had no visual style of its own. */
  fallbackStyle?: ElementStyle;
  /** Serialized SVG of the glyph inside this component, for the same pixel floor
   *  (icons render via createNodeFromSvg). The `icon` name is for DS icon-swap on
   *  a successful instance; this markup is for the fallback render. Absent when
   *  no icon or markup too large. */
  iconSvg?: { markup: string; box: Box };
}

export interface ElementNode {
  kind: "element";
  tag: string; // "div" | "text" | "img" | ...
  /** The host element's literal class attribute, for JSX emission (Customize).
   *  Absent on text nodes and the Figma-export path (which ignores it). */
  className?: string;
  /** Layer name for the Figma export: component name for composite/unknown
   *  components, semantic tag name (h1-h6, nav, etc.), or derived from layout
   *  (row/column). Absent for generic div/span/text. */
  name?: string;
  box: Box;
  layout: Layout | null;
  style: ElementStyle;
  children: SljNode[];
}

export type SljNode = ComponentNode | ElementNode;

export interface SljDocument {
  slj: typeof SLJ_VERSION;
  frame: { slug: string; project: string; width: number; mode: "light" | "dark" };
  /** Token name → its resolved raw color value (e.g. "--stroke-neutral-subtle"
   *  → "rgb(230, 230, 230)"), captured once from :root. Lets the plan always
   *  emit a paintable RAW fallback color alongside any Figma-variable key, so a
   *  token whose variable can't be imported (Variables API is Enterprise-only)
   *  still renders its true color instead of black/invisible. Absent on legacy
   *  SLJs (the plan then falls back to width-only-skip, never black). */
  tokens?: Record<string, string>;
  root: SljNode;
}

export function isComponentNode(n: SljNode): n is ComponentNode {
  return n.kind === "component";
}
export function isElementNode(n: SljNode): n is ElementNode {
  return n.kind === "element";
}
