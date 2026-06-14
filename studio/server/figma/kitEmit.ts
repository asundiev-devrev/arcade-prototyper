/**
 * Deterministic Figma REST → Studio-frame emitter ("kit emit").
 *
 * Input: the raw figmanage get-nodes payload (document tree + components +
 * componentSets maps). Output: a complete frame index.tsx where
 *
 *  - geometry, fills, strokes, radii, shadows, and text styles are copied
 *    verbatim from Figma's own data (absolute positioning) — fidelity is by
 *    construction, no LLM;
 *  - every INSTANCE whose component-set identity matches the curated kit
 *    mapping (kitMappings.ts) renders as a REAL arcade-gen component
 *    (<Checkbox>, <Avatar>, <IconButton>, …) with variant props translated;
 *  - icon/vector subtrees with no kit equivalent reference exported SVG
 *    assets; IMAGE fills reference exported PNGs — all local files, so
 *    nothing expires;
 *  - everything else is faithful static markup (the spec: known → kit,
 *    unknown → hand-rolled).
 *
 * The module is pure: asset planning returns the node ids that need
 * exporting; the caller (kitEmitBranch.ts) performs the figmanage exports
 * and passes back the resolved asset map. Nodes Figma refuses to export
 * (null URL) are fed back via `brokenIds`, and analysis recurses past them.
 */
import { matchKit, avatarSizeForPx, VARIANT_VALUE_MAP, SIZE_VALUE_MAP, ICON_SET_NAME_TO_KIT } from "./kitMappings";
import { readColorVar } from "./resolveTokens";
import { resolveKitTokenVar, type ColorProperty } from "./kitTokens";

// ---------------------------------------------------------------------------
// Raw-node helpers

type RawNode = any;

const GRAPHIC_TYPES = new Set([
  "VECTOR", "BOOLEAN_OPERATION", "LINE", "STAR", "POLYGON", "REGULAR_POLYGON",
]);

export interface ComponentIdentity {
  setKey?: string;
  setName?: string;
}

/** Resolve an instance's componentId through the payload's components /
 *  componentSets maps to (published set key, set name). */
export function resolveIdentity(
  componentId: string | undefined,
  components: Record<string, any>,
  componentSets: Record<string, any>,
): ComponentIdentity {
  if (!componentId) return {};
  const c = components[componentId];
  if (!c) return {};
  const sid = c.componentSetId;
  if (sid && componentSets[sid]) {
    return { setKey: componentSets[sid].key, setName: componentSets[sid].name };
  }
  return { setKey: c.key, setName: c.name };
}

function hidden(n: RawNode): boolean {
  // isMask nodes are alpha channels, not visible paint.
  return n.visible === false || n.opacity === 0 || n.isMask === true;
}

function hasImageFill(n: RawNode): boolean {
  return (n.fills ?? []).some((f: any) => f?.type === "IMAGE" && f.visible !== false);
}

function instanceProps(n: RawNode): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [rawKey, entry] of Object.entries(n.componentProperties ?? {})) {
    out[rawKey.split("#")[0]] = (entry as any)?.value !== undefined ? (entry as any).value : entry;
  }
  return out;
}

function visibleTexts(n: RawNode, acc: string[] = []): string[] {
  if (hidden(n)) return acc;
  if (n.type === "TEXT") acc.push(n.characters ?? "");
  for (const c of n.children ?? []) visibleTexts(c, acc);
  return acc;
}

/** Descendant node carrying an avatar photo (IMAGE fill). */
function avatarImgId(n: RawNode): string | null {
  if (hidden(n)) return null;
  if (hasImageFill(n)) return n.id;
  for (const c of n.children ?? []) {
    const r = avatarImgId(c);
    if (r) return r;
  }
  return null;
}

/** Deepest mapped icon instance inside a kit component (e.g. the glyph an
 *  IconButton renders). Returns the arcade-gen icon name, or null. */
function innerIcon(
  n: RawNode,
  components: Record<string, any>,
  componentSets: Record<string, any>,
): string | null {
  if (hidden(n)) return null; // designers hide alt glyphs in a slot — ignore them
  if (n.type === "INSTANCE") {
    const { setName } = resolveIdentity(n.componentId, components, componentSets);
    if (setName && ICON_SET_NAME_TO_KIT[setName]) return ICON_SET_NAME_TO_KIT[setName];
  }
  for (const c of n.children ?? []) {
    const r = innerIcon(c, components, componentSets);
    if (r) return r;
  }
  return null;
}

/** Does this subtree contain any drawable vector content? */
function containsVector(n: RawNode): boolean {
  if (hidden(n)) return false;
  if (GRAPHIC_TYPES.has(n.type)) return true;
  return (n.children ?? []).some(containsVector);
}

/** Does this subtree contain a kit-mappable INSTANCE (icon or component)?
 *  Used to guarantee the generalized SVG-glyph fallback (D1) never collapses a
 *  subtree that holds a real kit component into one flat image. Hidden nodes are
 *  skipped — a hidden alt-glyph must not block flattening of its visible sibling. */
function containsKitMatch(n: RawNode, ctx: EmitContext): boolean {
  if (hidden(n)) return false;
  if (n.type === "INSTANCE") {
    const { setKey, setName } = resolveIdentity(n.componentId, ctx.components, ctx.componentSets);
    if (matchKit(setKey, setName)) return true;
  }
  return (n.children ?? []).some((c: RawNode) => containsKitMatch(c, ctx));
}

/** Does this subtree carry visible TEXT with real content? Text must stay live
 *  (selectable, theme-able) markup — never be flattened into an exported SVG —
 *  so the generalized glyph fallback (D1) refuses to collapse any subtree that
 *  contains it. */
function containsText(n: RawNode): boolean {
  if (hidden(n)) return false;
  if (n.type === "TEXT" && (n.characters ?? "").trim()) return true;
  return (n.children ?? []).some(containsText);
}

/** Does this subtree carry an IMAGE fill anywhere (a photo/raster)? Such fills
 *  export as PNG on their own node; the generalized glyph fallback (D1) must not
 *  flatten a subtree containing one into a single SVG and lose the photo. */
function containsImageFill(n: RawNode): boolean {
  if (hidden(n)) return false;
  if (hasImageFill(n)) return true;
  return (n.children ?? []).some(containsImageFill);
}

/** Icon-scale cap for the generalized glyph fallback: matches isGraphic's and
 *  innerGraphicId's 48px ceiling so only genuine icon/glyph subtrees flatten —
 *  never a large layout frame that merely happens to contain a stray vector. */
const GLYPH_MAX_PX = 48;

/**
 * D1 — generalized SVG-glyph fallback. An UNMAPPED node is a pure icon/vector
 * subtree we should flatten to one exported SVG (rather than recurse into and
 * render its vector leaves as blank boxes) when it:
 *   - is not itself a kit match (caller checks) and not an ELLIPSE/IMAGE/TEXT,
 *   - is at icon scale (≤48px each side) so we never collapse a layout frame,
 *   - contains drawable vector content,
 *   - contains NO kit-mappable instance (else we'd swallow a real component),
 *   - contains NO IMAGE fill (else we'd lose a photo that PNG-exports on its own),
 *   - contains NO live text (else we'd rasterize selectable copy).
 * This is the IconButton/Button glyph rule, lifted to ANY context — no unmapped
 * glyph ever silently vanishes, regardless of mapping coverage.
 */
function isUnmappedGlyph(n: RawNode, ctx: EmitContext, broken: Set<string>): boolean {
  if (hidden(n)) return false;
  if (broken.has(n.id)) return false; // Figma refused to export it standalone — recurse instead
  if (n.type === "TEXT") return false;
  if (n.type === "ELLIPSE") return false; // ellipses round-trip as CSS, not SVG
  if (hasImageFill(n)) return false;
  const b = n.absoluteBoundingBox ?? {};
  if ((b.width ?? 0) > GLYPH_MAX_PX || (b.height ?? 0) > GLYPH_MAX_PX) return false;
  if (!containsVector(n)) return false;
  if (containsText(n)) return false;
  if (containsImageFill(n)) return false;
  if (containsKitMatch(n, ctx)) return false;
  return true;
}

/** Glyph subtree id to export when an IconButton/Button's glyph has no
 *  kit-icon match — we export the original SVG rather than render a blank
 *  button. Skips hidden/mask nodes and the focus-ring decoration, then
 *  returns the first icon-scale child that CONTAINS vector content. We test
 *  "contains a vector" rather than "is entirely graphic" because real icon
 *  instances carry stray fill-less hit-area rectangles that would otherwise
 *  fail an all-children-graphic check and leave the button blank. */
function innerGraphicId(n: RawNode, broken: Set<string>): string | null {
  for (const c of n.children ?? []) {
    if (hidden(c)) continue;
    if (typeof c.name === "string" && /focus ring/i.test(c.name)) continue;
    if (broken.has(c.id)) {
      const deeper = innerGraphicId(c, broken);
      if (deeper) return deeper;
      continue;
    }
    if (!containsVector(c)) continue;
    // Descend through pure wrapper containers (slots, "Icon"/"Slot"/"Container"
    // frames) so we export the tight glyph, not a loose slot bbox — exporting
    // a 20x32 slot then scaling to 16 would distort the icon.
    const isWrapper =
      c.type === "SLOT" ||
      (["FRAME", "GROUP", "INSTANCE"].includes(c.type) &&
        typeof c.name === "string" &&
        /^(icon|slot|container|wrapper)\b/i.test(c.name));
    if (isWrapper) {
      const deeper = innerGraphicId(c, broken);
      if (deeper) return deeper;
    }
    const b = c.absoluteBoundingBox ?? {};
    const iconScale = (b.width ?? 0) <= 48 && (b.height ?? 0) <= 48;
    if (iconScale && c.type !== "ELLIPSE") return c.id;
    const r = innerGraphicId(c, broken);
    if (r) return r;
  }
  return null;
}

/** Node id to export when flattening an unmapped glyph subtree (D1). Prefers
 *  the tight inner glyph (descending through wrapper slots so we don't export a
 *  loose, distorting bbox); falls back to the node itself when it has no
 *  exportable child but is itself an exportable graphic (a bare icon-scale
 *  group/vector). Never returns a broken id. */
function glyphExportId(n: RawNode, broken: Set<string>): string | null {
  const inner = innerGraphicId(n, broken);
  if (inner) return inner;
  if (broken.has(n.id)) return null;
  if (n.type === "ELLIPSE") return null;
  return n.id;
}

// ---------------------------------------------------------------------------
// CSS helpers

function rgba(c: any, o = 1): string {
  const a = (c.a ?? 1) * o;
  const ch = (v: number) => Math.round((v ?? 0) * 255);
  if (a >= 0.999) {
    const hex = (v: number) => ch(v).toString(16).padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return `rgba(${ch(c.r)},${ch(c.g)},${ch(c.b)},${Math.round(a * 1000) / 1000})`;
}

function paintCss(p: any): string | null {
  if (p?.visible === false) return null;
  const o = p.opacity ?? 1;
  if (p.type === "SOLID") return rgba(p.color, o);
  if (typeof p.type === "string" && p.type.startsWith("GRADIENT")) {
    const stops = (p.gradientStops ?? [])
      .map((s: any) => `${rgba(s.color, o)} ${(s.position * 100).toFixed(1)}%`)
      .join(",");
    return p.type === "GRADIENT_RADIAL"
      ? `radial-gradient(circle,${stops})`
      : `linear-gradient(180deg,${stops})`;
  }
  return null;
}

type Style = Record<string, string | number>;

/** Layout context threaded through emit(): does this node sit inside a flex
 *  parent (so it must FLOW, not absolute-position), and if so what is the
 *  parent's main-axis direction (so we can pick main vs cross axis for
 *  grow/stretch/hug). The root starts !inFlex (it is position:relative). (B2) */
interface FlexCtx {
  inFlex: boolean;
  parentMode: string;
}
const ABSOLUTE_CTX: FlexCtx = { inFlex: false, parentMode: "NONE" };

// ---------------------------------------------------------------------------
// Design-token resolution (B1)
//
// When a paint is bound to a Figma variable that maps to a real kit token (for
// the right CSS property), emit `var(--x)` instead of the baked hex — same
// rendered color, but theme-correct and lift-able. Hex stays the fallback for
// unbound paints and bound-but-unresolvable ones; the resolver counts misses so
// the caller can surface coverage. All of this is OPT-IN: with no variables
// payload the resolver is null and every color stays exactly today's hex.

export interface TokenResolver {
  /**
   * For a paint array + CSS property + the hex the emitter would otherwise
   * bake, return a kit `var(--x)` when the paint is bound to a resolvable token
   * for that property, else the hex unchanged. Increments coverage counters.
   */
  colorFor(paints: any[] | undefined, property: ColorProperty, hex: string): string;
  /** Count of paints bound to a kit token and emitted as var() (coverage). */
  tokenized: number;
  /** Count of colors left as hex (unbound, or bound but not kit-resolvable). */
  hexFallbacks: number;
}

function makeTokenResolver(variables: any | null): TokenResolver | null {
  const vars = variables?.variables;
  if (!vars || typeof vars !== "object") return null;
  const r: TokenResolver = {
    tokenized: 0,
    hexFallbacks: 0,
    colorFor(paints, property, hex) {
      const figmaName = paints ? readColorVar(paints, vars) : undefined;
      const tokenVar = resolveKitTokenVar(figmaName, property);
      if (tokenVar) {
        r.tokenized++;
        return tokenVar;
      }
      r.hexFallbacks++;
      return hex;
    },
  };
  return r;
}

/**
 * The PAINT half of a node's box: fills, stroke (as an inset shadow), drop
 * shadows, radius, overflow, opacity. Deliberately carries NO position/size —
 * the absolute path (boxStyle) prepends position + bbox geometry; the flex path
 * (flexChildStyle) prepends flex-child props instead. Splitting this out lets
 * both paths reuse the (subtle, already-debugged) paint logic without
 * duplicating it. (B2)
 */
function paintStyle(n: RawNode, tok?: TokenResolver | null): Style {
  const s: Style = {};
  if (typeof n.opacity === "number" && n.opacity < 1) s.opacity = Math.round(n.opacity * 1000) / 1000;
  if (n.type !== "TEXT") {
    for (const f of n.fills ?? []) {
      const v = paintCss(f);
      if (v) {
        // SOLID fills can map to a kit token; gradients can't (no single var).
        s.background = f.type === "SOLID" && tok ? tok.colorFor(n.fills, "background", v) : v;
        break;
      }
    }
  }
  const shadows: string[] = [];
  const sw = n.strokeWeight ?? 1;
  for (const st of n.strokes ?? []) {
    const v = paintCss(st);
    if (v && st.type === "SOLID") {
      const color = tok ? tok.colorFor(n.strokes, "stroke", v) : v;
      shadows.push(`inset 0 0 0 ${sw}px ${color}`);
      break;
    }
  }
  for (const e of n.effects ?? []) {
    if (e.type === "DROP_SHADOW" && e.visible !== false) {
      const off = e.offset ?? {};
      shadows.push(`${off.x ?? 0}px ${off.y ?? 0}px ${e.radius ?? 0}px ${e.spread ?? 0}px ${rgba(e.color)}`);
    }
  }
  if (shadows.length) s.boxShadow = shadows.join(", ");
  const rr = n.rectangleCornerRadii;
  if (rr) s.borderRadius = `${rr[0]}px ${rr[1]}px ${rr[2]}px ${rr[3]}px`;
  else if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) s.borderRadius = `${n.cornerRadius}px`;
  if (n.type === "ELLIPSE") s.borderRadius = "50%";
  if (n.clipsContent) s.overflow = "hidden";
  return s;
}

function boxStyle(n: RawNode, px: number, py: number, tok?: TokenResolver | null): Style {
  const b = n.absoluteBoundingBox ?? {};
  const s: Style = {
    position: "absolute",
    left: `${Math.round((b.x ?? 0) - px)}px`,
    top: `${Math.round((b.y ?? 0) - py)}px`,
    width: `${Math.round(b.width ?? 0)}px`,
    height: `${Math.round(b.height ?? 0)}px`,
  };
  return { ...s, ...paintStyle(n, tok) };
}

// ---------------------------------------------------------------------------
// Auto-layout → flexbox (B2)
//
// When a frame node carries Figma auto-layout (layoutMode HORIZONTAL/VERTICAL),
// we emit a flex container and let its children FLOW, instead of absolute-
// positioning each child at its Figma x/y. This makes the output responsive,
// robust to longer text, and editable by a designer — at the cost of a few px of
// drift vs the exact absolute copy. Absolute stays the fallback for non-auto-
// layout (free-form) frames. Owner decision (2026-06-14): flex where confident,
// absolute fallback; favor staying absolute when unsure.

const FLEX_JUSTIFY: Record<string, string> = {
  MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between",
};
const FLEX_ALIGN: Record<string, string> = {
  MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline",
};

/** Is this node an auto-layout frame with a real flex direction? The gate that
 *  decides flex vs absolute for the node's OWN children. */
function isFlexFrame(n: RawNode): boolean {
  return n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL";
}

/** A child opted out of its parent's auto-layout to float absolutely (Figma's
 *  "absolute position" escape hatch — badges, close buttons). */
function isAbsoluteChild(c: RawNode): boolean {
  return c.layoutPositioning === "ABSOLUTE";
}

/**
 * Confident-flex gate. Emit this frame's children as flex flow only when:
 *   - it is an auto-layout frame with a real direction,
 *   - it has at least one visible child that is NOT a flattened graphic/image
 *     (a flex frame full of vectors that collapse to one <img> gains nothing),
 *   - no visible child uses the absolute-position escape hatch (simplest safe
 *     v1: if any does, fall the whole frame back to absolute — RISK 5).
 * Otherwise the absolute path is used (the safe default, favoring fidelity).
 */
function shouldFlex(n: RawNode, ctx: EmitContext, broken: Set<string>): boolean {
  if (!isFlexFrame(n)) return false;
  const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
  if (!kids.length) return false;
  if (kids.some(isAbsoluteChild)) return false;
  // The node itself must not be one we flatten to a single graphic/image.
  if (isGraphic(n, broken) || hasImageFill(n)) return false;
  if (isUnmappedGlyph(n, ctx, broken)) return false;
  // At least one child must survive as flowing markup (not absorbed into an
  // exported asset). A frame whose every child flattens to a graphic gains
  // nothing from flex.
  const flowing = kids.some((c: RawNode) =>
    !isGraphic(c, broken) && !isUnmappedGlyph(c, ctx, broken));
  return flowing;
}

/** Container-side flex style for an auto-layout frame: display:flex plus
 *  direction / gap / padding / justify / align mapped from the Figma enums.
 *  box-sizing:border-box because Figma auto-layout padding sits INSIDE the
 *  border (RISK 7). */
function flexContainerStyle(n: RawNode): Style {
  const s: Style = {
    display: "flex",
    flexDirection: n.layoutMode === "VERTICAL" ? "column" : "row",
    boxSizing: "border-box",
  };
  const justify = FLEX_JUSTIFY[n.primaryAxisAlignItems];
  if (justify) s.justifyContent = justify;
  const align = FLEX_ALIGN[n.counterAxisAlignItems];
  if (align) s.alignItems = align;
  // SPACE_BETWEEN already distributes; a fixed gap fights it and Figma ignores
  // itemSpacing in that mode (RISK 4) — drop the gap there.
  if (typeof n.itemSpacing === "number" && n.itemSpacing > 0 && justify !== "space-between") {
    s.gap = `${Math.round(n.itemSpacing)}px`;
  }
  const pt = Math.round(n.paddingTop ?? 0);
  const pr = Math.round(n.paddingRight ?? 0);
  const pb = Math.round(n.paddingBottom ?? 0);
  const pl = Math.round(n.paddingLeft ?? 0);
  if (pt || pr || pb || pl) s.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
  return s;
}

/**
 * Box style for a node that sits INSIDE a flex parent: paint + size, but NO
 * position/left/top — it flows in the parent's layout. Sizing posture (RISK 3,
 * scout step 3): keep the Figma px as the safe default so text reflows like the
 * design, and only relax it where Figma explicitly says FILL / HUG / grow:
 *   - main axis: layoutGrow===1 or layoutSizing FILL → flexGrow:1, drop fixed
 *     size on that axis;
 *   - cross axis: layoutAlign STRETCH or layoutSizing FILL → alignSelf:stretch,
 *     drop fixed size on that axis;
 *   - HUG on an axis → drop the fixed size so the node hugs its content.
 * The parent's direction tells us which axis is main vs cross.
 */
function flexChildStyle(n: RawNode, parentMode: string, tok?: TokenResolver | null): Style {
  const b = n.absoluteBoundingBox ?? {};
  const horizontal = parentMode === "HORIZONTAL";
  let setW = true;
  let setH = true;
  const s: Style = { boxSizing: "border-box" };

  const hSizing = n.layoutSizingHorizontal;
  const vSizing = n.layoutSizingVertical;
  const grow = n.layoutGrow === 1;
  const stretch = n.layoutAlign === "STRETCH";

  // Main axis (the parent's primary axis): grow / FILL → flexGrow:1 + drop size.
  if (horizontal) {
    if (grow || hSizing === "FILL") { s.flexGrow = 1; setW = false; }
    if (hSizing === "HUG") setW = false;
    if (stretch || vSizing === "FILL") { s.alignSelf = "stretch"; setH = false; }
    if (vSizing === "HUG") setH = false;
  } else {
    if (grow || vSizing === "FILL") { s.flexGrow = 1; setH = false; }
    if (vSizing === "HUG") setH = false;
    if (stretch || hSizing === "FILL") { s.alignSelf = "stretch"; setW = false; }
    if (hSizing === "HUG") setW = false;
  }

  if (setW) s.width = `${Math.round(b.width ?? 0)}px`;
  if (setH) s.height = `${Math.round(b.height ?? 0)}px`;
  return { ...s, ...paintStyle(n, tok) };
}

function textStyle(n: RawNode, tok?: TokenResolver | null): Style {
  const st = n.style ?? {};
  const s: Style = {
    fontFamily: `'${st.fontFamily ?? "Inter"}', -apple-system, sans-serif`,
  };
  if (st.fontSize) s.fontSize = `${st.fontSize}px`;
  if (st.fontWeight) s.fontWeight = st.fontWeight;
  if (st.lineHeightPx) s.lineHeight = `${st.lineHeightPx}px`;
  if (st.letterSpacing) s.letterSpacing = `${st.letterSpacing.toFixed(2)}px`;
  s.textAlign = ({ LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" } as any)[st.textAlignHorizontal] ?? "left";
  for (const f of n.fills ?? []) {
    if (f.type === "SOLID" && f.visible !== false) {
      const hex = rgba(f.color, f.opacity ?? 1);
      s.color = tok ? tok.colorFor(n.fills, "color", hex) : hex;
      break;
    }
  }
  if (st.textTruncation === "ENDING") {
    s.whiteSpace = "nowrap"; s.overflow = "hidden"; s.textOverflow = "ellipsis";
  } else {
    s.whiteSpace = "pre-wrap";
  }
  const va = st.textAlignVertical;
  if (va === "CENTER" || va === "BOTTOM") {
    s.display = "flex";
    s.alignItems = va === "CENTER" ? "center" : "flex-end";
    if (s.textAlign === "center") s.justifyContent = "center";
    if (s.textAlign === "right") s.justifyContent = "flex-end";
  }
  if (st.textCase === "UPPER") s.textTransform = "uppercase";
  return s;
}

/**
 * Centering wrapper for a kit component. By default it is an absolutely-
 * positioned box (its Figma geometry). When its PARENT is a flex container
 * (inFlex), it must instead FLOW: drop position/left/top and become an inline
 * centering box that participates in the parent's layout, keeping width/height
 * so the component reserves the right footprint (B2). Its OWN internal
 * display:flex/center is unchanged — that centers the component inside the box
 * and is orthogonal to its role as a flex child (RISK 2).
 */
function centerBox(n: RawNode, px: number, py: number, ctx?: { inFlex?: boolean; parentMode?: string }): Style {
  const s = ctx?.inFlex
    ? flexChildStyle(n, ctx.parentMode ?? "HORIZONTAL")
    : boxStyle(n, px, py);
  delete s.background;
  delete s.boxShadow;
  s.display = "flex"; s.alignItems = "center"; s.justifyContent = "center";
  return s;
}

/** First visible solid fill/stroke on a vector descendant → icon color (kit
 *  icons inherit currentColor). When the paint is bound to a kit `--fg-*`
 *  token, emit the token (icon color is foreground); else the literal hex. */
function vectorColor(n: RawNode, tok?: TokenResolver | null): string | null {
  if (hidden(n)) return null;
  if (GRAPHIC_TYPES.has(n.type)) {
    for (const f of n.fills ?? []) {
      if (f.type === "SOLID" && f.visible !== false) {
        const hex = rgba(f.color, f.opacity ?? 1);
        return tok ? tok.colorFor(n.fills, "color", hex) : hex;
      }
    }
    for (const st of n.strokes ?? []) {
      if (st.type === "SOLID" && st.visible !== false) {
        const hex = rgba(st.color, st.opacity ?? 1);
        return tok ? tok.colorFor(n.strokes, "color", hex) : hex;
      }
    }
  }
  for (const c of n.children ?? []) {
    const r = vectorColor(c, tok);
    if (r) return r;
  }
  return null;
}

/** Render a Style as a JSX style-object literal. */
function sx(s: Style): string {
  const parts = Object.entries(s).map(([k, v]) =>
    `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`,
  );
  return `{{${parts.join(", ")}}}`;
}

function escText(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Asset planning

export interface AssetPlan {
  /** Node ids to export as SVG (icon/vector subtrees with no kit match). */
  svgIds: string[];
  /** Node ids to export as PNG (IMAGE fills, avatar photos). */
  pngIds: string[];
}

export interface EmitContext {
  components: Record<string, any>;
  componentSets: Record<string, any>;
  /** Node ids figmanage returned a null export URL for — analysis recurses
   *  past these into their children. */
  brokenIds?: Set<string>;
}

/** A subtree that is pure vector content at icon scale collapses into one
 *  exported SVG. Bigger containers recurse so mappable instances inside are
 *  never swallowed into a flat image. */
function isGraphic(n: RawNode, broken: Set<string>): boolean {
  if (hidden(n)) return false;
  if (broken.has(n.id)) return false;
  if (GRAPHIC_TYPES.has(n.type)) return true;
  if (n.type === "TEXT") return false;
  if (hasImageFill(n)) return false;
  const kids = n.children ?? [];
  if (["GROUP", "INSTANCE", "FRAME", "COMPONENT"].includes(n.type) && kids.length) {
    const b = n.absoluteBoundingBox ?? {};
    if ((b.width ?? 0) > 48 || (b.height ?? 0) > 48) return false;
    return kids.every((k: RawNode) => isGraphic(k, broken) || hidden(k));
  }
  if (n.type === "ELLIPSE") {
    return (n.fills ?? []).some((f: any) => f.type !== "SOLID");
  }
  return false;
}

function kitForNode(n: RawNode, ctx: EmitContext) {
  if (n.type !== "INSTANCE") return null;
  const { setKey, setName } = resolveIdentity(n.componentId, ctx.components, ctx.componentSets);
  return matchKit(setKey, setName);
}

/** Walk the tree and collect which node ids must be exported as SVG/PNG. */
export function planAssets(doc: RawNode, ctx: EmitContext): AssetPlan {
  const broken = ctx.brokenIds ?? new Set<string>();
  const svgIds: string[] = [];
  const pngIds: string[] = [];

  function walk(n: RawNode): void {
    if (hidden(n)) return;
    const k = kitForNode(n, ctx);
    if (k) {
      if (k.kind === "component" && (k.kit === "ImageAvatar" || k.kit === "Avatar")) {
        const img = avatarImgId(n);
        if (img) pngIds.push(img);
        return;
      }
      if (k.kind === "component" && k.kit === "AvatarGroup") {
        for (const c of n.children ?? []) walk(c);
        return;
      }
      // IconButton / icon-only Button whose glyph has no kit-icon match:
      // export the original glyph as an SVG so the button isn't blank.
      if (k.kind === "component" && (k.kit === "IconButton" || k.kit === "Button")) {
        if (!innerIcon(n, ctx.components, ctx.componentSets)) {
          const g = glyphExportId(n, broken);
          if (g) svgIds.push(g);
        }
      }
      return; // kit component absorbs its subtree
    }
    if (isGraphic(n, broken) && n.type !== "ELLIPSE") {
      svgIds.push(n.id);
      return;
    }
    if (hasImageFill(n)) {
      pngIds.push(n.id);
      return;
    }
    // D1 — generalized SVG-glyph fallback. An unmapped icon/vector subtree that
    // holds no kit component and no live text flattens to one exported SVG, so
    // its vector leaves never render as blank boxes. Gated by isUnmappedGlyph so
    // we never swallow a mappable instance or rasterize selectable text.
    if (isUnmappedGlyph(n, ctx, broken)) {
      const g = glyphExportId(n, broken);
      if (g) {
        svgIds.push(g);
        return;
      }
    }
    for (const c of n.children ?? []) walk(c);
  }

  walk(doc);
  return { svgIds: [...new Set(svgIds)], pngIds: [...new Set(pngIds)] };
}

// ---------------------------------------------------------------------------
// Emission

export interface EmitResult {
  source: string;
  /** arcade-gen components imported (kit coverage metric). */
  kitImports: string[];
  /** Count of kit component/icon instances emitted. */
  kitInstanceCount: number;
  /** Asset files referenced (relative paths under the frame dir). */
  assetRefs: string[];
  /** Colors emitted as a kit design token (B1 coverage). */
  tokenizedColors: number;
  /** Colors emitted as literal hex (unbound, or bound but not kit-resolvable). */
  hexColors: number;
}

export interface EmitOptions extends EmitContext {
  /** Maps an exported node id to its on-disk asset filename, e.g.
   *  "10-3577.svg". Anything planAssets listed must be present here (assets
   *  that failed to download should be omitted — the node degrades to a
   *  plain box). */
  assetFiles: Map<string, string>;
  componentName?: string;
  /**
   * The figmanage get-variables payload (B1). When present, color paints bound
   * to a Figma variable that maps to a real kit token emit `var(--x)` instead
   * of baked hex. Absent / null → every color stays literal hex (today's
   * behavior); never a wrong color either way.
   */
  variables?: any | null;
}

function safeVar(id: string): string {
  return "a_" + id.replace(/[^A-Za-z0-9]/g, "_");
}

export function emitKitFrame(doc: RawNode, opts: EmitOptions): EmitResult {
  const ctx: EmitContext = opts;
  const broken = opts.brokenIds ?? new Set<string>();
  const usedKit = new Set<string>();
  const assetImports = new Map<string, string>(); // var -> rel path
  const lines: string[] = [];
  let kitInstanceCount = 0;
  const tok = makeTokenResolver(opts.variables ?? null);

  const assetRef = (nodeId: string): string | null => {
    const file = opts.assetFiles.get(nodeId);
    if (!file) return null;
    const v = safeVar(nodeId);
    assetImports.set(v, `./assets/${file}`);
    return v;
  };

  /** A node's box style for its current layout context: flowing (no position,
   *  flex-child props + size) when its parent is a flex container, else the
   *  classic absolute box. Both share paintStyle, so a node never loses its
   *  fills/radius/shadow regardless of which path it takes (RISK 1: every
   *  return path in emit goes through this). */
  const nodeBox = (n: RawNode, px: number, py: number, flex: FlexCtx): Style =>
    flex.inFlex ? flexChildStyle(n, flex.parentMode, tok) : boxStyle(n, px, py, tok);

  function emitAvatar(n: RawNode, px: number, py: number, pad: string, flex: FlexCtx, opts2: { type?: string } = {}): void {
    usedKit.add("Avatar");
    kitInstanceCount++;
    const b = n.absoluteBoundingBox ?? {};
    const p = instanceProps(n);
    const img = avatarImgId(n);
    const v = img ? assetRef(img) : null;
    const init = p["↪️ Avatar Initials"] ?? p["Avatar Initials"] ?? p["Account Initial"] ?? "";
    const name = typeof init === "string" && init && init !== "False" ? init : "User";
    const attrs = [
      v ? `src={${v}}` : "",
      `name=${JSON.stringify(String(name))}`,
      opts2.type ? `type="${opts2.type}" shape="square"` : "",
      `size="${avatarSizeForPx(b.width ?? 24)}"`,
    ].filter(Boolean).join(" ");
    lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Avatar ${attrs} /></div>`);
  }

  /** The glyph a kit IconButton/Button should render: a kit icon if the
   *  inner instance maps, else the original glyph exported as an SVG (so the
   *  button is never blank), else a spacer. Returns { jsx, kit } where kit is
   *  the kit-icon name to import (if any). */
  function buttonGlyph(n: RawNode, size = 16): { jsx: string; kit: string | null } {
    const icon = innerIcon(n, ctx.components, ctx.componentSets);
    if (icon) return { jsx: `<${icon} size={${size}} />`, kit: icon };
    const gid = glyphExportId(n, broken);
    const v = gid ? assetRef(gid) : null;
    if (v) return { jsx: `<img src={${v}} width={${size}} height={${size}} alt="" />`, kit: null };
    return { jsx: "<span />", kit: null };
  }

  function emit(n: RawNode, px: number, py: number, ind: number, flex: FlexCtx): void {
    if (hidden(n)) return;
    const pad = "  ".repeat(ind);
    const b = n.absoluteBoundingBox ?? {};
    const k = kitForNode(n, ctx);

    if (k) {
      const p = instanceProps(n);
      const w = b.width ?? 16;

      if (k.kind === "icon") {
        usedKit.add(k.kit);
        kitInstanceCount++;
        const s = centerBox(n, px, py, flex);
        const col = vectorColor(n, tok);
        if (col) s.color = col;
        lines.push(`${pad}<div style=${sx(s)}><${k.kit} size={${Math.round(Math.min(w, b.height ?? 16))}} /></div>`);
        return;
      }

      switch (k.kit) {
        case "IconButton": {
          usedKit.add("IconButton");
          kitInstanceCount++;
          const v = VARIANT_VALUE_MAP[p.Variant ?? p.Varient ?? ""] ?? "tertiary";
          const szv = SIZE_VALUE_MAP[p.Size ?? ""] ?? "md";
          const g = buttonGlyph(n);
          if (g.kit) usedKit.add(g.kit);
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
          return;
        }
        case "Button": {
          const v = VARIANT_VALUE_MAP[p.Variant ?? p.Varient ?? ""] ?? "primary";
          const szv = SIZE_VALUE_MAP[p.Size ?? ""] ?? "md";
          const icon = innerIcon(n, ctx.components, ctx.componentSets);
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = p["✏️ Content"] ?? (texts.length ? texts[0] : null);
          if (p.Label === false || !label) {
            usedKit.add("IconButton");
            kitInstanceCount++;
            const g = buttonGlyph(n);
            if (g.kit) usedKit.add(g.kit);
            lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
            return;
          }
          usedKit.add("Button");
          kitInstanceCount++;
          if (icon) usedKit.add(icon);
          const lead = icon ? ` iconLeft={<${icon} size={16} />}` : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Button variant="${v}" size="${szv}"${lead}>${escText(String(label))}</Button></div>`);
          return;
        }
        case "Checkbox": {
          usedKit.add("Checkbox");
          kitInstanceCount++;
          const checked = p.Checked === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Checkbox size="sm"${checked} /></div>`);
          return;
        }
        case "Switch": {
          usedKit.add("Switch");
          kitInstanceCount++;
          const checked = p.Toggle === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Switch${checked} /></div>`);
          return;
        }
        case "Tabs": {
          usedKit.add("Tabs");
          kitInstanceCount++;
          const labels = visibleTexts(n).filter((t) => t.trim());
          const tabs = labels.length ? labels : ["Tab"];
          const trig = tabs.map((t) => `<Tabs.Trigger value=${JSON.stringify(t)}>${escText(t)}</Tabs.Trigger>`).join("");
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><Tabs.Root defaultValue=${JSON.stringify(tabs[0])}><Tabs.List>${trig}</Tabs.List></Tabs.Root></div>`);
          return;
        }
        case "Badge":
        case "Tag": {
          usedKit.add(k.kit);
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const label = texts[0] ?? "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><${k.kit}>${escText(label)}</${k.kit}></div>`);
          return;
        }
        case "Avatar":
          emitAvatar(n, px, py, pad, flex);
          return;
        case "AccountAvatar":
          emitAvatar(n, px, py, pad, flex, { type: "account" });
          return;
        case "ImageAvatar":
          emitAvatar(n, px, py, pad, flex);
          return;
        case "AvatarGroup": {
          usedKit.add("AvatarGroup");
          usedKit.add("Avatar");
          kitInstanceCount++;
          const inner: string[] = [];
          const collect = (m: RawNode): void => {
            if (hidden(m)) return;
            const kk = kitForNode(m, ctx);
            if (kk && kk.kind === "component" && (kk.kit === "ImageAvatar" || kk.kit === "Avatar")) {
              const img = avatarImgId(m);
              const mszv = avatarSizeForPx(m.absoluteBoundingBox?.width ?? 24);
              const v = img ? assetRef(img) : null;
              if (v) inner.push(`<Avatar src={${v}} name="U" size="${mszv}" />`);
              else {
                const pp = instanceProps(m);
                const ii = pp["↪️ Avatar Initials"] ?? "U";
                inner.push(`<Avatar name=${JSON.stringify(String(ii))} size="${mszv}" />`);
              }
              return;
            }
            for (const c of m.children ?? []) collect(c);
          };
          for (const c of n.children ?? []) collect(c);
          const content = String(p["✏️ Content"] ?? "");
          const cm = content.match(/\+(\d+)/);
          let cnt = "";
          if (cm) {
            usedKit.add("AvatarCount");
            cnt = `<AvatarCount count={${cm[1]}} size="md" />`;
          }
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py, flex))}><AvatarGroup size="md">${inner.join("")}${cnt}</AvatarGroup></div>`);
          return;
        }
        default:
          // Mapped name without an emitter (future row) — fall through to
          // static markup rather than fail.
          break;
      }
    }

    if (isGraphic(n, broken) && n.type !== "ELLIPSE") {
      const v = assetRef(n.id);
      if (v) {
        const s = nodeBox(n, px, py, flex);
        delete s.background;
        delete s.boxShadow;
        lines.push(`${pad}<img src={${v}} style=${sx(s)} alt="" />`);
        return;
      }
      // Asset missing (export failed) — degrade to a plain box below.
    }

    if (hasImageFill(n)) {
      const v = assetRef(n.id);
      if (v) {
        const s = nodeBox(n, px, py, flex);
        delete s.background;
        s.objectFit = "cover";
        lines.push(`${pad}<img src={${v}} style=${sx(s)} alt="" />`);
        return;
      }
    }

    // D1 — generalized SVG-glyph fallback (mirrors planAssets). An unmapped
    // icon/vector subtree with no kit component and no live text renders as the
    // exported SVG, positioned at the node's own box, so its vector content is
    // never lost to a blank container. The asset is keyed by the tight glyph id
    // (glyphExportId), which may be a descendant; we still size the <img> to the
    // node's box. Falls through to the container path if the export is missing.
    if (isUnmappedGlyph(n, ctx, broken)) {
      const gid = glyphExportId(n, broken);
      const v = gid ? assetRef(gid) : null;
      if (v) {
        const s = nodeBox(n, px, py, flex);
        delete s.background;
        delete s.boxShadow;
        lines.push(`${pad}<img src={${v}} style=${sx(s)} alt="" />`);
        return;
      }
      // Export missing — fall through to the container/box path below.
    }

    if (n.type === "TEXT") {
      const s = { ...nodeBox(n, px, py, flex), ...textStyle(n, tok) };
      lines.push(`${pad}<div style=${sx(s)}>${escText(n.characters ?? "")}</div>`);
      return;
    }

    const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
    // B2 — auto-layout → flexbox. If THIS node is a confident auto-layout frame,
    // its OWN box stays in its parent's flow (nodeBox honors `flex`) but it
    // becomes a flex container and its children FLOW (childCtx.inFlex=true) — no
    // absolute positioning, no parent-origin subtraction. Otherwise it (and its
    // children) keep the absolute path (childCtx = ABSOLUTE_CTX), unchanged.
    const flexHere = shouldFlex(n, ctx, broken);
    const s = flexHere
      ? { ...nodeBox(n, px, py, flex), ...flexContainerStyle(n) }
      : nodeBox(n, px, py, flex);
    if (!kids.length) {
      lines.push(`${pad}<div style=${sx(s)} />`);
      return;
    }
    const childCtx: FlexCtx = flexHere
      ? { inFlex: true, parentMode: n.layoutMode }
      : ABSOLUTE_CTX;
    lines.push(`${pad}<div style=${sx(s)}>`);
    for (const c of kids) emit(c, b.x ?? px, b.y ?? py, ind + 1, childCtx);
    lines.push(`${pad}</div>`);
  }

  const rb = doc.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };
  // B2 — the root document node may itself be auto-layout. If so, make the outer
  // wrapper a flex container and start its children in flow; otherwise the root
  // stays position:relative and children are absolute (today's behavior). The
  // gate is the same shouldFlex confidence check.
  const rootFlex = shouldFlex(doc, ctx, broken);
  const rootChildCtx: FlexCtx = rootFlex
    ? { inFlex: true, parentMode: doc.layoutMode }
    : ABSOLUTE_CTX;
  const rootFlexStyle = rootFlex ? flexContainerStyle(doc) : {};
  for (const c of doc.children ?? []) emit(c, rb.x, rb.y, 2, rootChildCtx);

  const kitImports = [...usedKit].sort();
  const importLines: string[] = [];
  if (kitImports.length) {
    importLines.push(`import { ${kitImports.join(", ")} } from "arcade/components";`);
  }
  for (const [v, p] of assetImports) importLines.push(`import ${v} from "${p}";`);

  const name = opts.componentName ?? "FigmaImport";
  // The outer wrapper is always position:relative + fixed frame size (so a
  // non-flex root's absolute children anchor to it). When the root document is
  // itself a confident auto-layout frame, its flex container props (direction /
  // gap / padding / justify / align) merge in so its children flow. (B2)
  const rootStyle: Style = {
    position: "relative",
    width: Math.round(rb.width),
    height: Math.round(rb.height),
    background: "#fff",
    overflow: "hidden",
    ...rootFlexStyle,
  };
  const source = `import * as React from "react";
${importLines.join("\n")}

export default function ${name}() {
  return (
    <div style=${sx(rootStyle)}>
${lines.join("\n")}
    </div>
  );
}
`;

  return {
    source,
    kitImports,
    kitInstanceCount,
    assetRefs: [...assetImports.values()],
    tokenizedColors: tok?.tokenized ?? 0,
    hexColors: tok?.hexFallbacks ?? 0,
  };
}
