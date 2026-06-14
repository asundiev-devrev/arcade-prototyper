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

function boxStyle(n: RawNode, px: number, py: number): Style {
  const b = n.absoluteBoundingBox ?? {};
  const s: Style = {
    position: "absolute",
    left: `${Math.round((b.x ?? 0) - px)}px`,
    top: `${Math.round((b.y ?? 0) - py)}px`,
    width: `${Math.round(b.width ?? 0)}px`,
    height: `${Math.round(b.height ?? 0)}px`,
  };
  if (typeof n.opacity === "number" && n.opacity < 1) s.opacity = Math.round(n.opacity * 1000) / 1000;
  if (n.type !== "TEXT") {
    for (const f of n.fills ?? []) {
      const v = paintCss(f);
      if (v) { s.background = v; break; }
    }
  }
  const shadows: string[] = [];
  const sw = n.strokeWeight ?? 1;
  for (const st of n.strokes ?? []) {
    const v = paintCss(st);
    if (v && st.type === "SOLID") { shadows.push(`inset 0 0 0 ${sw}px ${v}`); break; }
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

function textStyle(n: RawNode): Style {
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
    if (f.type === "SOLID" && f.visible !== false) { s.color = rgba(f.color, f.opacity ?? 1); break; }
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

function centerBox(n: RawNode, px: number, py: number): Style {
  const s = boxStyle(n, px, py);
  delete s.background;
  delete s.boxShadow;
  s.display = "flex"; s.alignItems = "center"; s.justifyContent = "center";
  return s;
}

/** First visible solid fill/stroke on a vector descendant → icon color (kit
 *  icons inherit currentColor). */
function vectorColor(n: RawNode): string | null {
  if (hidden(n)) return null;
  if (GRAPHIC_TYPES.has(n.type)) {
    for (const f of n.fills ?? []) {
      if (f.type === "SOLID" && f.visible !== false) return rgba(f.color, f.opacity ?? 1);
    }
    for (const st of n.strokes ?? []) {
      if (st.type === "SOLID" && st.visible !== false) return rgba(st.color, st.opacity ?? 1);
    }
  }
  for (const c of n.children ?? []) {
    const r = vectorColor(c);
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
          const g = innerGraphicId(n, broken);
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
}

export interface EmitOptions extends EmitContext {
  /** Maps an exported node id to its on-disk asset filename, e.g.
   *  "10-3577.svg". Anything planAssets listed must be present here (assets
   *  that failed to download should be omitted — the node degrades to a
   *  plain box). */
  assetFiles: Map<string, string>;
  componentName?: string;
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

  const assetRef = (nodeId: string): string | null => {
    const file = opts.assetFiles.get(nodeId);
    if (!file) return null;
    const v = safeVar(nodeId);
    assetImports.set(v, `./assets/${file}`);
    return v;
  };

  function emitAvatar(n: RawNode, px: number, py: number, pad: string, opts2: { type?: string } = {}): void {
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
    lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><Avatar ${attrs} /></div>`);
  }

  /** The glyph a kit IconButton/Button should render: a kit icon if the
   *  inner instance maps, else the original glyph exported as an SVG (so the
   *  button is never blank), else a spacer. Returns { jsx, kit } where kit is
   *  the kit-icon name to import (if any). */
  function buttonGlyph(n: RawNode, size = 16): { jsx: string; kit: string | null } {
    const icon = innerIcon(n, ctx.components, ctx.componentSets);
    if (icon) return { jsx: `<${icon} size={${size}} />`, kit: icon };
    const gid = innerGraphicId(n, broken);
    const v = gid ? assetRef(gid) : null;
    if (v) return { jsx: `<img src={${v}} width={${size}} height={${size}} alt="" />`, kit: null };
    return { jsx: "<span />", kit: null };
  }

  function emit(n: RawNode, px: number, py: number, ind: number): void {
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
        const s = centerBox(n, px, py);
        const col = vectorColor(n);
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
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
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
            lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><IconButton variant="${v}" size="${szv}" aria-label="action">${g.jsx}</IconButton></div>`);
            return;
          }
          usedKit.add("Button");
          kitInstanceCount++;
          if (icon) usedKit.add(icon);
          const lead = icon ? ` iconLeft={<${icon} size={16} />}` : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><Button variant="${v}" size="${szv}"${lead}>${escText(String(label))}</Button></div>`);
          return;
        }
        case "Checkbox": {
          usedKit.add("Checkbox");
          kitInstanceCount++;
          const checked = p.Checked === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><Checkbox size="sm"${checked} /></div>`);
          return;
        }
        case "Switch": {
          usedKit.add("Switch");
          kitInstanceCount++;
          const checked = p.Toggle === "True" ? " defaultChecked" : "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><Switch${checked} /></div>`);
          return;
        }
        case "Tabs": {
          usedKit.add("Tabs");
          kitInstanceCount++;
          const labels = visibleTexts(n).filter((t) => t.trim());
          const tabs = labels.length ? labels : ["Tab"];
          const trig = tabs.map((t) => `<Tabs.Trigger value=${JSON.stringify(t)}>${escText(t)}</Tabs.Trigger>`).join("");
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><Tabs.Root defaultValue=${JSON.stringify(tabs[0])}><Tabs.List>${trig}</Tabs.List></Tabs.Root></div>`);
          return;
        }
        case "Badge":
        case "Tag": {
          usedKit.add(k.kit);
          kitInstanceCount++;
          const texts = visibleTexts(n).filter((t) => t.trim());
          const label = texts[0] ?? "";
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><${k.kit}>${escText(label)}</${k.kit}></div>`);
          return;
        }
        case "Avatar":
          emitAvatar(n, px, py, pad);
          return;
        case "AccountAvatar":
          emitAvatar(n, px, py, pad, { type: "account" });
          return;
        case "ImageAvatar":
          emitAvatar(n, px, py, pad);
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
          lines.push(`${pad}<div style=${sx(centerBox(n, px, py))}><AvatarGroup size="md">${inner.join("")}${cnt}</AvatarGroup></div>`);
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
        const s = boxStyle(n, px, py);
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
        const s = boxStyle(n, px, py);
        delete s.background;
        s.objectFit = "cover";
        lines.push(`${pad}<img src={${v}} style=${sx(s)} alt="" />`);
        return;
      }
    }

    if (n.type === "TEXT") {
      const s = { ...boxStyle(n, px, py), ...textStyle(n) };
      lines.push(`${pad}<div style=${sx(s)}>${escText(n.characters ?? "")}</div>`);
      return;
    }

    const kids = (n.children ?? []).filter((c: RawNode) => !hidden(c));
    const s = boxStyle(n, px, py);
    if (!kids.length) {
      lines.push(`${pad}<div style=${sx(s)} />`);
      return;
    }
    lines.push(`${pad}<div style=${sx(s)}>`);
    for (const c of kids) emit(c, b.x ?? px, b.y ?? py, ind + 1);
    lines.push(`${pad}</div>`);
  }

  const rb = doc.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };
  for (const c of doc.children ?? []) emit(c, rb.x, rb.y, 2);

  const kitImports = [...usedKit].sort();
  const importLines: string[] = [];
  if (kitImports.length) {
    importLines.push(`import { ${kitImports.join(", ")} } from "arcade/components";`);
  }
  for (const [v, p] of assetImports) importLines.push(`import ${v} from "${p}";`);

  const name = opts.componentName ?? "FigmaImport";
  const source = `import * as React from "react";
${importLines.join("\n")}

export default function ${name}() {
  return (
    <div style={{ position: "relative", width: ${Math.round(rb.width)}, height: ${Math.round(rb.height)}, background: "#fff", overflow: "hidden" }}>
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
  };
}
