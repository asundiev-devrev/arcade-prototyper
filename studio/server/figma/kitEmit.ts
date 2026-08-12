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
import {
  matchKit,
  avatarSizeForPx,
  VARIANT_VALUE_MAP,
  SIZE_VALUE_MAP,
  BADGE_VARIANT_MAP,
  TAG_INTENT_MAP,
  TAG_APPEARANCE_MAP,
  ICON_SET_NAME_TO_KIT,
  NON_RENDERABLE_KIT_EXPORTS,
  FILE_ATTACHMENT_DOC_TYPES,
  FIGMA_DOCUMENT_TO_DOC_TYPE,
} from "./kitMappings";
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
    // Same guard as matchKit: never return a compound layout object as an icon
    // glyph (it would emit `<Sidebar size=…/>` inside a button and crash). A
    // null return lets the caller fall back to the exported SVG glyph.
    if (setName && ICON_SET_NAME_TO_KIT[setName]) {
      const kit = ICON_SET_NAME_TO_KIT[setName];
      if (!NON_RENDERABLE_KIT_EXPORTS.has(kit)) return kit;
    }
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
/**
 * Stroke → inset box-shadow(s), honoring per-side weights.
 *
 * Figma lets a node carry a different weight on each edge
 * (`individualStrokeWeights: {top,right,bottom,left}`) — a "bottom-only divider"
 * is `{top:0, right:0, bottom:1, left:0}`. The old code read only the uniform
 * `strokeWeight` and painted `inset 0 0 0 Npx` (all four sides), so every
 * bottom-ruled table row rendered as a fully boxed cell. When per-side weights
 * differ, emit one inset shadow per non-zero edge instead:
 *   top    → inset 0  Npx 0 0
 *   bottom → inset 0 -Npx 0 0
 *   left   → inset  Npx 0 0 0
 *   right  → inset -Npx 0 0 0
 * When all sides are equal (or no per-side weights are given), fall back to the
 * single uniform 4-side inset — unchanged behavior for bordered boxes.
 */
function strokeShadows(n: RawNode, color: string): string[] {
  const isw = n.individualStrokeWeights;
  const uniform = n.strokeWeight ?? 1;
  if (isw && typeof isw === "object") {
    const top = isw.top ?? 0;
    const right = isw.right ?? 0;
    const bottom = isw.bottom ?? 0;
    const left = isw.left ?? 0;
    const allEqual = top === right && right === bottom && bottom === left;
    if (!allEqual) {
      const out: string[] = [];
      if (top > 0) out.push(`inset 0 ${top}px 0 0 ${color}`);
      if (bottom > 0) out.push(`inset 0 -${bottom}px 0 0 ${color}`);
      if (left > 0) out.push(`inset ${left}px 0 0 0 ${color}`);
      if (right > 0) out.push(`inset -${right}px 0 0 0 ${color}`);
      return out;
    }
    // allEqual → uniform border at that weight. A weight of 0 is an INVISIBLE
    // stroke in Figma even when a stroke paint is present — so paint nothing.
    // Do NOT "fix" this by defaulting to a 1px line: that invents a border the
    // design doesn't have (the adv-2 all-zero-stroke finding — kept by design).
    return top > 0 ? [`inset 0 0 0 ${top}px ${color}`] : [];
  }
  // Same rule on the uniform path: a 0 weight paints nothing (an `inset … 0px`
  // shadow is invisible anyway — just don't emit it). Only default to 1px when
  // the weight is truly UNSPECIFIED (nullish), which reads as "hairline stroke".
  return uniform > 0 ? [`inset 0 0 0 ${uniform}px ${color}`] : [];
}

/**
 * A "hairline" is a stroked graphic node (a `LINE`/`VECTOR` divider) with one
 * bounding-box dimension effectively zero — a Figma rule/separator has height 0
 * and its paint lives entirely in the stroke. Exporting it as an SVG produces a
 * 0-px `<img>` that renders as nothing, which is exactly the "missing bottom
 * divider under table rows" bug. We instead render it as a thin CSS box painted
 * with the stroke color (see the hairline branch in emit). Requires a visible
 * solid stroke so we never turn a genuinely empty node into a stray line. */
function isHairline(n: RawNode): boolean {
  if (hidden(n)) return false;
  if (!GRAPHIC_TYPES.has(n.type)) return false;
  const b = n.absoluteBoundingBox ?? {};
  const w = b.width ?? 0;
  const h = b.height ?? 0;
  const thin = Math.min(w, h) < 1 && Math.max(w, h) > 0;
  if (!thin) return false;
  return (n.strokes ?? []).some(
    (st: any) => st?.type === "SOLID" && st.visible !== false && paintCss(st),
  );
}

/** First visible solid stroke on a node → its resolved color (kit token or hex),
 *  or null when the node has no solid stroke. Shared by the border and hairline
 *  paths so both resolve the stroke identically. */
function strokeColor(n: RawNode, tok?: TokenResolver | null): string | null {
  for (const st of n.strokes ?? []) {
    const v = paintCss(st);
    if (v && st.type === "SOLID") return tok ? tok.colorFor(n.strokes, "stroke", v) : v;
  }
  return null;
}

/**
 * Figma blur effects → CSS. LAYER_BLUR blurs the node's own pixels (`filter`);
 * BACKGROUND_BLUR blurs what shows THROUGH it (`backdrop-filter`) — the frosted-
 * glass effect, which needs a translucent fill to be visible at all.
 *
 * The radius→CSS conversion is `radius / 2`, taken from Figma's OWN SVG exporter
 * rather than guessed: exporting the real blurred nodes emitted
 * `feGaussianBlur stdDeviation="22"` for `radius: 44` and `stdDeviation="87"` for
 * `radius: 174` (verified live 2026-08-06 against Onboarding 3.0 node 5678:118876).
 * CSS `blur(<n>px)` is defined as a Gaussian with standard deviation n, so
 * stdDeviation maps to it directly.
 *
 * Every blur effect was previously DROPPED — only DROP_SHADOW was read. That is
 * why a designer's soft background glow imported as a hard-edged purple blob: the
 * blur lives on a parent GROUP, and the child's exported SVG is the sharp shape.
 *
 * Multiple blurs of one kind compose (CSS allows a filter list). `visible: false`
 * effects are skipped, matching the DROP_SHADOW path above.
 */
export function blurStyle(n: RawNode): { filter?: string; backdropFilter?: string } {
  const layer: string[] = [];
  const background: string[] = [];
  for (const e of n.effects ?? []) {
    if (e.visible === false) continue;
    const radius = typeof e.radius === "number" ? e.radius : 0;
    if (radius <= 0) continue;
    // Round to 2dp: Figma radii are floats and a 14-decimal CSS value is noise.
    const px = Math.round((radius / 2) * 100) / 100;
    if (e.type === "LAYER_BLUR") layer.push(`blur(${px}px)`);
    else if (e.type === "BACKGROUND_BLUR") background.push(`blur(${px}px)`);
  }
  const out: { filter?: string; backdropFilter?: string } = {};
  if (layer.length) out.filter = layer.join(" ");
  if (background.length) out.backdropFilter = background.join(" ");
  return out;
}

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
  for (const st of n.strokes ?? []) {
    const v = paintCss(st);
    if (v && st.type === "SOLID") {
      const color = tok ? tok.colorFor(n.strokes, "stroke", v) : v;
      shadows.push(...strokeShadows(n, color));
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
  const blur = blurStyle(n);
  if (blur.filter) s.filter = blur.filter;
  if (blur.backdropFilter) s.backdropFilter = blur.backdropFilter;
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
  // B2 (auto-layout → flexbox) is DISABLED. A live visual check showed it
  // drifted fidelity well past "small px-drift": 120 content-sized flex
  // containers whose intrinsic size diverged a few px from Figma's fixed box,
  // cascading to siblings (mean diff 4.2→7.7 vs the Figma, 3.6% structurally
  // wrong pixels, sidebar 8× worse). The owner chose to keep pixel-exact
  // absolute positioning. The flex machinery (flexContainerStyle/flexChildStyle/
  // FlexCtx plumbing) is retained but inert behind this gate, so a future
  // iteration that pins explicit width/height on flex containers (to stop the
  // intrinsic-size drift) can re-enable it by restoring the gate below without
  // re-threading every call site.
  return false;
  // Original confident gate (re-enable with explicit child sizing):
  // if (!isFlexFrame(n)) return false;
  // const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
  // if (!kids.length) return false;
  // if (kids.some(isAbsoluteChild)) return false;
  // if (isGraphic(n, broken) || hasImageFill(n)) return false;
  // if (isUnmappedGlyph(n, ctx, broken)) return false;
  // return kids.some((c) => !isGraphic(c, broken) && !isUnmappedGlyph(c, ctx, broken));
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

/**
 * Map a Figma font-family name to the kit's font utility class. Emitting the
 * font as a CLASS (`font-display`) instead of an inline `fontFamily: "'Chip
 * Display Variable', …"` string removes the single most fragile thing in an
 * imported frame: a quoted family name. When a follow-up edit forced the LLM to
 * rewrite a title element, it "smart-quoted" the family (`'`→`’`), CSS found no
 * family named `’Chip Display Variable’`, and the heading silently fell back to
 * the system font. A class has no quotes to corrupt. Returns null for an
 * unknown family so the caller can fall back to an inline family for fidelity.
 */
function fontClassFor(family: string | undefined): string | null {
  switch (family) {
    case "Chip Display Variable":
      return "font-display";
    case "Chip Text Variable":
      return "font-text";
    case "Chip Mono":
      return "font-mono";
    default:
      return null;
  }
}

function textStyle(n: RawNode, tok?: TokenResolver | null): Style {
  const st = n.style ?? {};
  const s: Style = {};
  // Only bake an inline fontFamily when the family is NOT a known kit font —
  // kit fonts are emitted as a `font-*` class by the TEXT renderer (no quoted
  // string to corrupt on a later edit). See fontClassFor.
  if (!fontClassFor(st.fontFamily)) {
    s.fontFamily = `'${st.fontFamily ?? "Inter"}', -apple-system, sans-serif`;
  }
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

/**
 * Escape a text segment for JSX AND preserve hard line breaks. A literal `\n`
 * written into JSX source is collapsed to a single space by JSX's whitespace
 * rules, so a Figma text layer carrying "Let's prepare\nfor your next meeting."
 * imported as one unbroken line even though the node has `white-space:pre-wrap`.
 * Emitting each newline as a `{"\n"}` expression keeps it in the DOM, where
 * pre-wrap renders it as the intended break.
 */
function escTextWithBreaks(t: string): string {
  return t.split("\n").map(escText).join('{"\\n"}');
}

/**
 * Resolve a per-character override's text color the same way textStyle resolves
 * the base color: first visible SOLID fill → kit token (when bound + tok
 * present) else literal hex. Returns null when the override carries no fill.
 */
function overrideColor(ov: any, tok?: TokenResolver | null): string | null {
  for (const f of ov?.fills ?? []) {
    if (f.type === "SOLID" && f.visible !== false) {
      const hex = rgba(f.color, f.opacity ?? 1);
      return tok ? tok.colorFor(ov.fills, "color", hex) : hex;
    }
  }
  return null;
}

/**
 * Build the inner JSX of a TEXT node, honoring Figma's per-character style runs
 * (`characterStyleOverrides` aligned per codepoint to `characters`, indexing
 * into `styleOverrideTable`). A run whose color or weight differs from the base
 * is wrapped in a `<span>` carrying ONLY the differing props; base runs stay as
 * plain escaped text.
 *
 * Why this exists: a single Figma text layer routinely paints part of its
 * string a different color — e.g. the OAuth title "Let's prepare for your next
 * meeting." has "next meeting." in red while the rest is purple. The old
 * emitter read only the FIRST fill of the whole node, so every accent run
 * collapsed to the base color and silently vanished. Designers then had to ask
 * for the accent in prose, which a downstream LLM pass guessed wrong (it
 * recolored only "meeting."). Emitting the real runs makes the accent import
 * exactly, with no prose and no LLM involvement.
 */
function textRuns(n: RawNode, tok: TokenResolver | null | undefined, baseColor?: string): string {
  const chars: string = n.characters ?? "";
  const overrides = n.characterStyleOverrides;
  const table = n.styleOverrideTable;
  if (!Array.isArray(overrides) || overrides.length === 0 || !table || typeof table !== "object") {
    return escTextWithBreaks(chars);
  }
  const baseWeight = n.style?.fontWeight;
  // characterStyleOverrides is aligned per Unicode codepoint to `characters`;
  // Array.from splits on codepoints (so a curly apostrophe / emoji counts as
  // one), matching Figma's indexing.
  const cps = Array.from(chars);
  const out: string[] = [];
  let i = 0;
  while (i < cps.length) {
    const id = overrides[i] ?? 0;
    let j = i + 1;
    while (j < cps.length && (overrides[j] ?? 0) === id) j++;
    const text = cps.slice(i, j).join("");
    i = j;
    const ov = id ? (table[String(id)] ?? table[id]) : null;
    const span: Style = {};
    if (ov) {
      const c = overrideColor(ov, tok);
      if (c && c !== baseColor) span.color = c;
      if (ov.fontWeight && ov.fontWeight !== baseWeight) span.fontWeight = ov.fontWeight;
      if (ov.italic || ov.fontStyle === "Italic") span.fontStyle = "italic";
    }
    const inner = escTextWithBreaks(text);
    out.push(Object.keys(span).length ? `<span style=${sx(span)}>${inner}</span>` : inner);
  }
  return out.join("");
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
 *  never swallowed into a flat image.
 *
 *  Guarded by containsKitMatch (same as isUnmappedGlyph): a small all-vector
 *  subtree that nonetheless HOLDS a kit-mappable instance must NOT flatten —
 *  the walk has to descend to that instance. This is what a CHECKED checkbox
 *  looks like: its glyph is an `Icons/Checkmark.Filled` VECTOR, so the whole
 *  16×16 Checkbox subtree reads as "all vector" and used to rasterize to a
 *  static SVG before the mappable `Checkbox` INSTANCE inside was ever reached
 *  (an UNCHECKED box has a plain RECTANGLE stroke, so it dodged this path). */
function isGraphic(n: RawNode, broken: Set<string>, ctx?: EmitContext): boolean {
  if (hidden(n)) return false;
  if (broken.has(n.id)) return false;
  if (GRAPHIC_TYPES.has(n.type)) return true;
  if (n.type === "TEXT") return false;
  if (hasImageFill(n)) return false;
  if (ctx && containsKitMatch(n, ctx)) return false;
  const kids = n.children ?? [];
  if (["GROUP", "INSTANCE", "FRAME", "COMPONENT"].includes(n.type) && kids.length) {
    const b = n.absoluteBoundingBox ?? {};
    if ((b.width ?? 0) > 48 || (b.height ?? 0) > 48) return false;
    return kids.every((k: RawNode) => isGraphic(k, broken, ctx) || hidden(k));
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
    // A zero-dimension stroked rule (LINE/VECTOR divider) is painted as a thin
    // CSS box in emit, NOT exported — a 0-px SVG <img> renders as nothing (the
    // "missing table divider" bug). Stop here so it isn't listed for export.
    if (isHairline(n)) return;
    if (isGraphic(n, broken, ctx) && n.type !== "ELLIPSE") {
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
  // --- C3: per-import coverage telemetry -----------------------------------
  /** Total visible INSTANCE nodes encountered (the denominator for kit %). An
   *  instance ABSORBED by a kit component — e.g. an icon inside an IconButton —
   *  is not double-counted; the walk stops at the matched ancestor. */
  totalInstances: number;
  /** Visible instances whose component-set identity matched the curated kit
   *  table (the numerator). Equals the number of kit COMPONENT instances; kit
   *  icons are counted here too. May differ from kitInstanceCount, which also
   *  includes derived sub-instances (e.g. AvatarCount). */
  matchedInstances: number;
  /** Set NAME → count for instances that did NOT match any kit mapping. The
   *  curation backlog: the highest-count names are the best next mappings. */
  unmatchedSets: Record<string, number>;
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
  // C3 — coverage telemetry. Counted in emit() (the single place every visible
  // instance is classified) so the numbers track exactly what shipped.
  let totalInstances = 0;
  let matchedInstances = 0;
  const unmatchedSets: Record<string, number> = {};
  const tok = makeTokenResolver(opts.variables ?? null);

  const assetRef = (nodeId: string): string | null => {
    const file = opts.assetFiles.get(nodeId);
    if (!file) return null;
    const v = safeVar(nodeId);
    assetImports.set(v, `./assets/${file}`);
    return v;
  };

  /** Inert traceability attribute — the source Figma node id, for round-trip/
   *  incremental re-import. Never affects rendering. */
  const figmaIdAttr = (n: RawNode): string => {
    return n.id ? ` data-figma-id=${JSON.stringify(n.id)}` : "";
  };

  /** A node's box style for its current layout context: flowing (no position,
   *  flex-child props + size) when its parent is a flex container, else the
   *  classic absolute box. Both share paintStyle, so a node never loses its
   *  fills/radius/shadow regardless of which path it takes (RISK 1: every
   *  return path in emit goes through this). */
  const nodeBox = (n: RawNode, px: number, py: number, flex: FlexCtx): Style =>
    flex.inFlex ? flexChildStyle(n, flex.parentMode, tok) : boxStyle(n, px, py, tok);

  // ---- C4: the Computer sidebar -------------------------------------------
  //
  // `Sidebar` is the one mapped component whose VALUE is its structure, so it
  // can't be a one-line emit like Button. arcade-gen's Sidebar is a compound
  // (Root / Header / Footer / Section / Item), and a Figma sidebar carries the
  // matching shape: a Header, some `Group` blocks each holding a "Group label"
  // and an "Items" slot of rows, and a Footer.
  //
  // Why the inner pieces are matched by NAME here, when kitMappings refuses
  // generic names globally: `Group`, `Header` and `Footer` are LOCAL components
  // in the designer's file (no published key to match), and names that generic
  // would be reckless in the global table. Inside an instance we have already
  // identified BY KEY as the Arcade sidebar, they are unambiguous.
  //
  // Anything unrecognised falls through to `emit`, so a piece we don't model
  // (traffic lights, gradient blur) still renders faithfully — the pixel floor
  // holds. And if the subtree doesn't look like a structured sidebar at all, the
  // caller abandons this path entirely rather than emit a wrong skeleton.

  /** The visible text a "Group label" instance carries — the Section heading. */
  function sidebarSectionTitle(group: RawNode): string {
    const label = (group.children ?? []).find((c: RawNode) => {
      if (hidden(c)) return false;
      const { setName } = resolveIdentity(c.componentId, ctx.components, ctx.componentSets);
      return /group label/i.test(String(setName ?? "")) || /group label/i.test(String(c.name ?? ""));
    });
    const texts = visibleTexts(label ?? group).filter((t) => t.trim() && t.trim() !== "Slot");
    return texts[0] ?? "";
  }

  /**
   * Does this subtree actually look like the Arcade sidebar we model? Requires a
   * real row or group inside. A Figma "Sidebar" instance that has been gutted or
   * heavily overridden is better served by faithful pixels than by a
   * <Sidebar.Root> whose sections we guessed.
   */
  function looksLikeStructuredSidebar(n: RawNode): boolean {
    let hit = false;
    (function scan(node: RawNode) {
      if (hit || hidden(node)) return;
      // Reuse the same resolution the emitter uses, so "is this a row?" can never
      // drift from what the row case actually matches on.
      if (kitForNode(node, ctx)?.kit === "SidebarItem") { hit = true; return; }
      const { setName } = resolveIdentity(node.componentId, ctx.components, ctx.componentSets);
      if (/^group$/i.test(String(setName ?? node.name ?? ""))) { hit = true; return; }
      for (const c of node.children ?? []) scan(c);
    })(n);
    return hit;
  }

  /** Children of a kit compound FLOW — the component owns its own layout, so a
   *  Figma-absolute box would fight it. */
  const SIDEBAR_FLOW: FlexCtx = { inFlex: true, parentMode: "VERTICAL" };

  /** Purely decorative sidebar layers with no component meaning. Emitting them
   *  inside Sidebar.Root would stack a full-height overlay over the content. */
  const SIDEBAR_DECOR = /gradient blur|progressive shadow|_focus ring/i;

  /** A sidebar `Group` block — by layer name OR resolved set name. Both are
   *  checked because a designer's wrapper frame may be auto-named ("Frame
   *  2147223869") while the instance inside still resolves to the Group set. */
  function isSidebarGroup(c: RawNode): boolean {
    const { setName } = resolveIdentity(c.componentId, ctx.components, ctx.componentSets);
    return /^group$/i.test(String(c.name ?? "")) || /^group$/i.test(String(setName ?? ""));
  }

  /**
   * `chrome` guards against DOUBLE-WRAPPING. A designer's sidebar commonly has a
   * "Footer" FRAME whose only child is a "Footer" INSTANCE, and matching both
   * produced nested <Sidebar.Footer> elements. Once we are inside a chrome
   * wrapper, deeper same-named nodes are just content.
   */
  function emitSidebarChild(c: RawNode, ind: number, chrome = false): void {
    if (hidden(c)) return;
    const pad = "  ".repeat(ind);
    const name = String(c.name ?? "");
    const { setName } = resolveIdentity(c.componentId, ctx.components, ctx.componentSets);
    const set = String(setName ?? "");
    const b = c.absoluteBoundingBox ?? {};
    const kids = (c.children ?? []).filter((x: RawNode) => !hidden(x));

    if (SIDEBAR_DECOR.test(name)) return;

    if (!chrome && (/^header$/i.test(name) || /^header$/i.test(set))) {
      lines.push(`${pad}<Sidebar.Header>`);
      for (const x of kids) emit(x, b.x ?? 0, b.y ?? 0, ind + 1, SIDEBAR_FLOW);
      lines.push(`${pad}</Sidebar.Header>`);
      return;
    }
    if (!chrome && (/^footer$/i.test(name) || /^footer$/i.test(set))) {
      lines.push(`${pad}<Sidebar.Footer>`);
      for (const x of kids) emitSidebarChild(x, ind + 1, true);
      lines.push(`${pad}</Sidebar.Footer>`);
      return;
    }
    if (isSidebarGroup(c)) {
      const title = sidebarSectionTitle(c);
      // `title` is REQUIRED on Sidebar.Section. With no heading text there is
      // nothing honest to put there, so keep the block as faithful markup.
      if (!title) { emit(c, b.x ?? 0, b.y ?? 0, ind, SIDEBAR_FLOW); return; }
      // Only the rows go inside — the label became the title, and re-emitting it
      // would print the heading twice.
      const items = kids.filter((x: RawNode) => !/group label/i.test(String(x.name ?? "")));
      lines.push(`${pad}<Sidebar.Section title=${JSON.stringify(title)}>`);
      for (const x of items) {
        for (const row of (x.children ?? []).filter((r: RawNode) => !hidden(r))) {
          emit(row, (x.absoluteBoundingBox ?? {}).x ?? 0, (x.absoluteBoundingBox ?? {}).y ?? 0, ind + 1, SIDEBAR_FLOW);
        }
      }
      lines.push(`${pad}</Sidebar.Section>`);
      return;
    }
    // A plain wrapper frame (e.g. "Sessions & messages") — pass through so its
    // Group children still become Sections rather than being buried in a div.
    if (c.type === "FRAME" && kids.length && kids.some(isSidebarGroup)) {
      for (const x of kids) emitSidebarChild(x, ind, chrome);
      return;
    }
    emit(c, b.x ?? 0, b.y ?? 0, ind, SIDEBAR_FLOW);
  }

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
    lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Avatar ${attrs} /></div>`);
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

    // C3 — classify every visible instance for coverage telemetry. We only
    // count an instance as "matched" when it ACTUALLY emits as a kit component
    // (or icon), NOT merely when matchKit() returns a name. A mapped name with
    // no emit case falls through the switch `default` to static markup — and
    // would otherwise inflate the coverage metric while silently failing the
    // "real kit components" bar. So tally totals + the unmatched backlog here,
    // but defer the matched++ to the emit paths via markKitEmitted().
    if (n.type === "INSTANCE") {
      totalInstances++;
      if (!k) {
        const { setName } = resolveIdentity(n.componentId, ctx.components, ctx.componentSets);
        const name = setName ?? "(unknown)";
        // FIX 2: Exclude icon instances from the unmatched notice — an unmapped
        // Arcade icon is still a real ADS component, and icons render fine as
        // faithful SVG. Only non-icon unmatched instances are "static pixels that
        // won't transfer". An icon set name is one that WOULD match ICON_SET_NAME_TO_KIT
        // if it were mapped.
        const isIconSet = name && (
          ICON_SET_NAME_TO_KIT[name] !== undefined ||
          /^Icons[/\s]/.test(name) ||
          /\bIcon\b/.test(name)
        );
        if (!isIconSet) {
          unmatchedSets[name] = (unmatchedSets[name] ?? 0) + 1;
        }
      }
    }

    if (k) {
      const p = instanceProps(n);
      const w = b.width ?? 16;
      // Provisionally count this instance as kit-matched; the `default` branch
      // (mapped name, no emit case → static markup) backs it out so the metric
      // only credits instances that actually render as a kit component.
      if (n.type === "INSTANCE") matchedInstances++;

      if (k.kind === "icon") {
        usedKit.add(k.kit);
        kitInstanceCount++;
        const s = centerBox(n, px, py, flex);
        const col = vectorColor(n, tok);
        if (col) s.color = col;
        lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(s)}><${k.kit} size={${Math.round(Math.min(w, b.height ?? 16))}} /></div>`);
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
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
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
            lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
            return;
          }
          usedKit.add("Button");
          kitInstanceCount++;
          if (icon) usedKit.add(icon);
          const lead = icon ? ` iconLeft={<${icon} size={16} />}` : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Button variant="${v}" size="${szv}"${lead}>${escText(String(label))}</Button></div>`);
          return;
        }
        case "Checkbox": {
          usedKit.add("Checkbox");
          kitInstanceCount++;
          const checked = p.Checked === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Checkbox size="sm"${checked} /></div>`);
          return;
        }
        case "Switch": {
          usedKit.add("Switch");
          kitInstanceCount++;
          const checked = p.Toggle === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Switch${checked} /></div>`);
          return;
        }
        case "Tabs": {
          usedKit.add("Tabs");
          kitInstanceCount++;
          const labels = visibleTexts(n).filter((t) => t.trim());
          const tabs = labels.length ? labels : ["Tab"];
          const trig = tabs.map((t) => `<Tabs.Trigger value=${JSON.stringify(t)}>${escText(t)}</Tabs.Trigger>`).join("");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Tabs.Root defaultValue=${JSON.stringify(tabs[0])}><Tabs.List>${trig}</Tabs.List></Tabs.Root></div>`);
          return;
        }
        case "Input": {
          // C1 — single forwardRef component, no portal: safe to emit standalone.
          // The field's own text content is its value/placeholder; State=Error /
          // Disabled drive the matching props (C2). Label/helper TEXT usually
          // live OUTSIDE the field box as siblings, so we only absorb the text
          // inside the instance — the kit renders its own field chrome.
          usedKit.add("Input");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const value = texts[0];
          const state = String(p.State ?? "");
          const attrs = [
            value ? `defaultValue=${JSON.stringify(value)}` : `placeholder=${JSON.stringify(value ?? "")}`,
            state === "Error" ? `error="Invalid"` : "",
            state === "Disabled" ? "disabled" : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Input ${attrs} /></div>`);
          return;
        }
        case "Select": {
          // C1 — closed-state instance = the trigger only. We emit Root+Trigger+
          // Value (a plain button, NO Content portal) so there's no open-context
          // requirement and nothing portals into nothing. The trigger text is the
          // placeholder/value. Radix Select forbids value="" (studio/CLAUDE.md),
          // so we only ever pass a non-empty placeholder, never a value prop.
          usedKit.add("Select");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const placeholder = texts[0] ?? "Select…";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Select.Root><Select.Trigger><Select.Value placeholder=${JSON.stringify(placeholder)} /></Select.Trigger></Select.Root></div>`);
          return;
        }
        case "Breadcrumb": {
          // C1 — plain HTML compound (NOT Radix, no portal): safe standalone.
          // Collect the visible crumb labels in order; the last is `current`.
          // Separators self-render the chevron, so we interleave one between
          // items. Links need an href; we use "#" (a prototype anchor).
          usedKit.add("Breadcrumb");
          kitInstanceCount++;
          const crumbs = visibleTexts(n).filter((t) => t.trim());
          const items = crumbs.length ? crumbs : ["Home"];
          const parts: string[] = [];
          items.forEach((t, i) => {
            const last = i === items.length - 1;
            if (last) {
              parts.push(`<Breadcrumb.Item current>${escText(t)}</Breadcrumb.Item>`);
            } else {
              parts.push(`<Breadcrumb.Item><Breadcrumb.Link href="#">${escText(t)}</Breadcrumb.Link></Breadcrumb.Item>`);
              parts.push(`<Breadcrumb.Separator />`);
            }
          });
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Breadcrumb.Root>${parts.join("")}</Breadcrumb.Root></div>`);
          return;
        }
        case "Banner": {
          // REAL API (verified against index.d.mts:2092): `children: ReactNode` is
          // REQUIRED; `title` is ONLY used for layout="section" (default is
          // "inline", and the ADS set we map is literally "Inline Banner"). So ALL
          // text goes into children — putting the primary text in `title` renders
          // an EMPTY inline banner. `intent` ∈ BannerIntent; reuse the Tag intent
          // map (neutral/alert/success/warning/info/intelligence) if present.
          usedKit.add("Banner");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const body = texts.join(" ");
          const intent = TAG_INTENT_MAP[p.Type ?? p.Intent ?? ""];
          const ia = intent ? ` intent="${intent}"` : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Banner${ia}>${escText(body)}</Banner></div>`);
          return;
        }
        case "TextArea": {
          usedKit.add("TextArea");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const value = texts[0];
          const attrs = value
            ? `defaultValue=${JSON.stringify(value)}`
            : `placeholder=${JSON.stringify("")}`;
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><TextArea ${attrs} /></div>`);
          return;
        }
        // ---- C4: the Computer sidebar ----
        case "Sidebar": {
          // COMPOUND — must enter through `Sidebar.Root`. Rendering the bare
          // namespace object throws "Element type is invalid" and white-screens
          // the frame. (Deliberately not writing that shape out even in a
          // comment: kit-mapping-hygiene.test.ts text-greps this file for it,
          // and a safety net that a comment can defeat is not a safety net.)
          if (!looksLikeStructuredSidebar(n)) break; // → faithful markup
          usedKit.add("Sidebar");
          kitInstanceCount++;
          const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
          // Keep the Figma box so the rail stays where and how big it was; the
          // Root then owns everything inside it.
          const s = nodeBox(n, px, py, flex);
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(s)}>`);
          lines.push(`${pad}  <Sidebar.Root>`);
          for (const c of kids) emitSidebarChild(c, ind + 2);
          lines.push(`${pad}  </Sidebar.Root>`);
          lines.push(`${pad}</div>`);
          return;
        }
        case "SidebarItem": {
          // One conversation/session row. `Sidebar.Item` takes the label as
          // children plus an optional leading icon; the row's own text is the
          // label. usedKit registers `Sidebar` — Item is a sub-part, not an export.
          usedKit.add("Sidebar");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = texts[0] ?? "";
          if (!label) break; // nothing to name the row with → faithful markup
          const glyph = innerIcon(n, ctx.components, ctx.componentSets);
          if (glyph) usedKit.add(glyph);
          const attrs = glyph ? ` icon={<${glyph} size={16} />}` : "";
          lines.push(`${pad}<Sidebar.Item${attrs}>${escText(label)}</Sidebar.Item>`);
          return;
        }
        case "Separator": {
          // 0.3 "Separator/Progressive" → the kit's progressive variant. The
          // orientation comes from the box: a wide, short node is horizontal.
          usedKit.add("Separator");
          kitInstanceCount++;
          const w = b.width ?? 0, h = b.height ?? 0;
          const orientation = h > w ? "vertical" : "horizontal";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(nodeBox(n, px, py, flex))}><Separator orientation="${orientation}" variant="progressive" /></div>`);
          return;
        }
        case "AttachmentGroup": {
          // A strip of attachment chips. Its children are the individual
          // attachments, several of which map on their own (File attachment →
          // FileAttachment), so recurse rather than absorb them.
          usedKit.add("AttachmentGroup");
          kitInstanceCount++;
          const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
          if (!kids.length) break; // an empty group renders nothing useful
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(nodeBox(n, px, py, flex))}>`);
          lines.push(`${pad}  <AttachmentGroup aria-label="Attachments">`);
          for (const c of kids) emit(c, b.x ?? px, b.y ?? py, ind + 2, { inFlex: true, parentMode: "HORIZONTAL" });
          lines.push(`${pad}  </AttachmentGroup>`);
          lines.push(`${pad}</div>`);
          return;
        }
        // ---- C3: arcade-gen 2.0 additions ----
        // Same admission test as C1: a single forwardRef component with no Radix
        // portal and no open-state requirement, whose REQUIRED props are all
        // derivable from the instance's own text. Anything needing an exported
        // image (ImageAttachment), a real Date (Timestamp) or a live open panel
        // stays unmapped so the node keeps its faithful markup.
        case "SearchInput": {
          usedKit.add("SearchInput");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          // 0.3 "Search Input" carries a `Placeholder` variant (True/False), so
          // the tree tells us whether the visible text is the placeholder or a
          // typed value — we don't have to guess. Placeholder=False means a real
          // query is in the field, which also shows the clear button.
          const text = texts[0] ?? "Search";
          const isValue = String(p.Placeholder ?? "True") === "False";
          const attr = isValue
            ? `defaultValue=${JSON.stringify(text)}`
            : `placeholder=${JSON.stringify(text)}`;
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><SearchInput ${attr} /></div>`);
          return;
        }
        case "NumberField": {
          usedKit.add("NumberField");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          // 0.3 `Type` = Floating label | Default | Small. Floating label is the
          // set's DEFAULT and the kit ignores `size` in that mode (fixed 56px
          // field), so passing a size there would be a lie. Static-label modes
          // map Small → kit "md" (28px) and Default → kit "lg" (40px).
          const type = String(p.Type ?? "Floating label");
          const staticSize = type === "Small" ? "md" : type === "Default" ? "lg" : "";
          const num = texts.map((t) => Number(t.replace(/[, ]/g, ""))).find((v) => Number.isFinite(v));
          // `value`/`defaultValue` are number | null in the kit — a string would
          // break the steppers, so a non-numeric text becomes the label instead.
          const label = texts.find((t) => !Number.isFinite(Number(t.replace(/[, ]/g, ""))));
          const state = String(p.State ?? "");
          const attrs = [
            staticSize ? `size="${staticSize}" labelStyle="static"` : "",
            label ? `label=${JSON.stringify(label)}` : "",
            num !== undefined ? `defaultValue={${num}}` : "",
            state === "Disabled" ? "disabled" : "",
            state === "Read only" ? "readOnly" : "",
            state === "Alert" ? `error="Invalid"` : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><NumberField ${attrs} /></div>`);
          return;
        }
        case "ChipButton": {
          usedKit.add("ChipButton");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = texts[0] ?? "Action";
          const szv = SIZE_VALUE_MAP[p.Size ?? ""];
          // The pressed look is its OWN axis, `Active / Pressed` (False|True) —
          // NOT `State`, whose options are only Idle | "Hover / Press".
          const attrs = [
            szv ? `size="${szv}"` : "",
            String(p["Active / Pressed"] ?? "") === "True" ? "active" : "",
            String(p.Loading ?? "") === "True" ? "loading" : "",
            String(p.Disabled ?? "") === "True" ? "disabled" : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><ChipButton${attrs ? ` ${attrs}` : ""}>${escText(label)}</ChipButton></div>`);
          return;
        }
        case "FilterButton": {
          usedKit.add("FilterButton");
          kitInstanceCount++;
          // Figma "Filter Button" reads `Label` then `Value` in tree order.
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const attrs = [
            texts[0] ? `label=${JSON.stringify(texts[0])}` : "",
            texts[1] ? `value=${JSON.stringify(texts[1])}` : "",
            // Same axis naming as Chip Button: `Active / Pressed`, not `State`.
            String(p["Active / Pressed"] ?? "") === "True" ? "active" : "",
            String(p.Disabled ?? "") === "True" ? "disabled" : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><FilterButton ${attrs} /></div>`);
          return;
        }
        case "AttributeItem": {
          // `label` is REQUIRED; value is optional. Tree order is label then value.
          // Register the import only AFTER the guard below — breaking out after
          // usedKit.add() would emit an import for a component that never renders.
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = texts[0] ?? "";
          if (!label) break; // no text to carry — fall through to faithful markup
          usedKit.add("AttributeItem");
          kitInstanceCount++;
          const attrs = [
            `label=${JSON.stringify(label)}`,
            texts[1] ? `value=${JSON.stringify(texts[1])}` : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><AttributeItem ${attrs} /></div>`);
          return;
        }
        case "FileAttachment": {
          // `name` is REQUIRED and the kit picks the glyph from `docType`.
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const name = texts[0];
          if (!name) break; // no filename — faithful markup beats an empty chip
          usedKit.add("FileAttachment");
          kitInstanceCount++;
          // 0.3 "File attachment" states the type outright on its `Document` axis
          // (PDF | PPT | TXT | Markdown | HTML | DOC | CSV | Fallback | Failed),
          // so prefer that over guessing from the filename. `Failed` is the error
          // state, not a file type — it maps to the `failed` prop instead.
          const docVariant = String(p.Document ?? "");
          const failed = docVariant === "Failed";
          const ext = (name.split(".").pop() ?? "").toLowerCase();
          const docType =
            (!failed && FIGMA_DOCUMENT_TO_DOC_TYPE[docVariant]) ||
            FILE_ATTACHMENT_DOC_TYPES[ext] ||
            "";
          const attrs = [
            `name=${JSON.stringify(name)}`,
            docType ? `docType="${docType}"` : "",
            texts[1] ? `meta=${JSON.stringify(texts[1])}` : "",
            failed ? "failed" : "",
          ].filter(Boolean).join(" ");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><FileAttachment ${attrs} /></div>`);
          return;
        }
        case "KeyboardShortcut": {
          // REAL API (verified against index.d.mts:2253): `keys: string[]` is
          // REQUIRED and the body calls keys.map(); CHILDREN ARE IGNORED. Passing
          // text as children (with no `keys`) → keys.map on undefined → runtime
          // TypeError → WHITE-SCREEN (esbuild frames aren't type-checked). So we
          // MUST split the combo into a keys array and pass it as a prop.
          usedKit.add("KeyboardShortcut");
          kitInstanceCount++;
          // FIX 4: Strip "Slot" placeholder to match Banner/TextArea/SplitButton.
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const combo = texts[0] ?? "⌘K";
          // Split on common separators (⌘K, "Cmd K", "Ctrl+Shift+P") into labels.
          const keys = combo.split(/[\s+]+/).flatMap((seg) =>
            // keep multi-char words whole; split bare glyph runs like "⌘K" into ⌘,K
            /^[\w-]+$/.test(seg) ? [seg] : Array.from(seg),
          ).filter(Boolean);
          const keysArr = keys.length ? keys : [combo];
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><KeyboardShortcut keys={${JSON.stringify(keysArr)}} /></div>`);
          return;
        }
        case "SplitButton": {
          usedKit.add("SplitButton");
          usedKit.add("SplitButtonItem");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim() && t.trim() !== "Slot");
          const label = texts[0] ?? "Action";
          // SplitButton composes SplitButtonItem children; emit the primary item.
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><SplitButton><SplitButtonItem>${escText(label)}</SplitButtonItem></SplitButton></div>`);
          return;
        }
        case "Badge": {
          usedKit.add("Badge");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const label = texts[0] ?? "";
          // C2 — Badge `Variant` axis (Counter: Emphasis/Neutral) → kit variant.
          const variant = BADGE_VARIANT_MAP[p.Variant ?? ""];
          const va = variant ? ` variant="${variant}"` : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Badge${va}>${escText(label)}</Badge></div>`);
          return;
        }
        case "Tag": {
          usedKit.add("Tag");
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const label = texts[0] ?? "";
          // C2 — Tag `Type` (intent) + `Appearance` axes → kit props. Unmapped
          // Figma values fall through to the component's own defaults.
          const intent = TAG_INTENT_MAP[p.Type ?? ""];
          const appearance = TAG_APPEARANCE_MAP[p.Appearance ?? ""];
          const attrs =
            (intent ? ` intent="${intent}"` : "") +
            (appearance ? ` appearance="${appearance}"` : "");
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><Tag${attrs}>${escText(label)}</Tag></div>`);
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
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><AvatarGroup size="md">${inner.join("")}${cnt}</AvatarGroup></div>`);
          return;
        }
        case "ChatBubble": {
          // 0.3 "Bubble". variant from Figma Type (Sender/Receiver); the bubble
          // text is the instance's visible text; timestamp if a time-ish text is
          // present. Children must be real text, so keep the message content.
          usedKit.add("ChatBubble");
          kitInstanceCount++;
          const variant = /sender/i.test(String(p.Type ?? p.Variant ?? "")) ? "sender" : "receiver";
          const texts = visibleTexts(n).filter((t) => t.trim());
          const body = texts.length ? texts.join(" ") : "";
          lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(centerBox(n, px, py, flex))}><ChatBubble variant="${variant}">${escText(body)}</ChatBubble></div>`);
          return;
        }
        default:
          // Mapped name without an emit case (future row) — fall through to
          // faithful static markup rather than fail. Back out the provisional
          // matched++ so coverage telemetry doesn't credit a non-kit render.
          if (n.type === "INSTANCE") matchedInstances--;
          break;
      }
    }

    // A zero-dimension stroked rule (a divider LINE/VECTOR whose bbox is e.g.
    // 648×0) can't be an SVG <img> — that renders as a 0-px, invisible element.
    // Paint it as a thin CSS box in the stroke color instead, so the divider is
    // actually visible. The thin dimension floors at 1px; the other keeps its
    // Figma length. (Runs BEFORE the graphic/img path, which would export it.)
    if (isHairline(n)) {
      const color = strokeColor(n, tok);
      if (color) {
        const s = nodeBox(n, px, py, flex);
        delete s.boxShadow;
        const b = n.absoluteBoundingBox ?? {};
        if ((b.width ?? 0) >= (b.height ?? 0)) s.height = "1px";
        else s.width = "1px";
        s.background = color;
        lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(s)} />`);
        return;
      }
    }

    if (isGraphic(n, broken, ctx) && n.type !== "ELLIPSE") {
      const v = assetRef(n.id);
      if (v) {
        const s = nodeBox(n, px, py, flex);
        delete s.background;
        delete s.boxShadow;
        // Figma BAKES a node's own blur into its export (an SVG export of a
        // blurred node carries an feGaussianBlur filter; a PNG export carries the
        // blurred pixels and a bbox expanded to fit them). Re-applying CSS blur
        // here would blur it TWICE. Verified live 2026-08-06. The blur is only
        // lost when it sits on an ANCESTOR of the exported node — that ancestor
        // is a container and keeps its CSS blur via paintStyle.
        delete s.filter;
        delete s.backdropFilter;
        lines.push(`${pad}<img${figmaIdAttr(n)} src={${v}} style=${sx(s)} alt="" />`);
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
        // Same baked-blur reasoning as the graphic path above.
        delete s.filter;
        delete s.backdropFilter;
        lines.push(`${pad}<img${figmaIdAttr(n)} src={${v}} style=${sx(s)} alt="" />`);
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
        // Same baked-blur reasoning as the graphic path above. Note the asset may
        // be a DESCENDANT (glyphExportId), so this node's own blur is baked only
        // when the export came from this node — but a glyph subtree's blur is
        // inside that export either way, so stripping is correct in both cases.
        delete s.filter;
        delete s.backdropFilter;
        lines.push(`${pad}<img${figmaIdAttr(n)} src={${v}} style=${sx(s)} alt="" />`);
        return;
      }
      // Export missing — fall through to the container/box path below.
    }

    if (n.type === "TEXT") {
      const s = { ...nodeBox(n, px, py, flex), ...textStyle(n, tok) };
      // Kit fonts ride on a `font-*` class, not an inline family string, so a
      // later targeted edit can't corrupt the quoted family name (see
      // fontClassFor). Non-kit families keep their inline fontFamily via
      // textStyle and get no class.
      const fontClass = fontClassFor(n.style?.fontFamily);
      const cls = fontClass ? ` className="${fontClass}"` : "";
      // Honor per-character style runs (accent colors, bold spans) and hard
      // line breaks — both were silently dropped by the old single-color,
      // single-run renderer. See textRuns / escTextWithBreaks.
      const inner = textRuns(n, tok, typeof s.color === "string" ? s.color : undefined);
      lines.push(`${pad}<div${figmaIdAttr(n)}${cls} style=${sx(s)}>${inner}</div>`);
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
      lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(s)} />`);
      return;
    }
    const childCtx: FlexCtx = flexHere
      ? { inFlex: true, parentMode: n.layoutMode }
      : ABSOLUTE_CTX;
    lines.push(`${pad}<div${figmaIdAttr(n)} style=${sx(s)}>`);
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
    totalInstances,
    matchedInstances,
    unmatchedSets,
  };
}
