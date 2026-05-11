export interface PaintStyle { id: string; name: string; hex: string }
export interface TextStyle {
  id: string; name: string;
  family: string; size: number; weight: number;
  lineHeight?: number; letterSpacing?: number;
}
export interface EffectStyle { id: string; name: string; css: string }

export interface ColorVariable { name: string; hex: string; collection: string }
export interface NumberVariable { name: string; value: number; collection: string }

export interface ComponentRef { id: string; name: string; isComponentSet: boolean }

export interface SampleFrame {
  nodeId: string; name: string; pngPath: string;
  widthPx: number; heightPx: number;
}

export interface SystemSources {
  fileName?: string;
  styles: { paint: PaintStyle[]; text: TextStyle[]; effect: EffectStyle[] };
  variables: { color: ColorVariable[]; number: NumberVariable[] };
  components: ComponentRef[];
  sampleFrames: SampleFrame[];
  warnings: string[];
}

export interface SourcesDeps {
  getStyles(fileKey: string): Promise<any | null>;
  getVariables(fileKey: string): Promise<any | null>;
  getComponents(fileKey: string): Promise<any | null>;
  getFile(fileKey: string): Promise<any | null>;
  exportPng(fileKey: string, nodeId: string): Promise<{ path: string; widthPx: number; heightPx: number } | null>;
}

const MIN_FRAME_SIDE = 400;
const MAX_SAMPLE_FRAMES = 8;

export async function fetchSystemSources(fileKey: string, deps: SourcesDeps): Promise<SystemSources> {
  const warnings: string[] = [];
  const [stylesRaw, varsRaw, componentsRaw, fileRaw] = await Promise.all([
    deps.getStyles(fileKey).catch(() => null),
    deps.getVariables(fileKey).catch(() => null),
    deps.getComponents(fileKey).catch(() => null),
    deps.getFile(fileKey).catch(() => null),
  ]);

  const styles = parseStyles(stylesRaw, warnings);
  const variables = parseVariables(varsRaw, warnings);
  const components = parseComponents(componentsRaw, warnings);

  let sampleFrames: SampleFrame[] = [];
  let fileName: string | undefined;
  if (!fileRaw) {
    warnings.push("file payload unavailable — no sample frames");
  } else {
    fileName = fileRaw.name;
    const picks = pickSampleFrames(fileRaw.document);
    for (const p of picks) {
      const png = await deps.exportPng(fileKey, p.nodeId).catch(() => null);
      if (!png) { warnings.push(`png export failed for ${p.nodeId}`); continue; }
      sampleFrames.push({
        nodeId: p.nodeId, name: p.name, pngPath: png.path,
        widthPx: p.widthPx, heightPx: p.heightPx,
      });
    }
  }

  return { fileName, styles, variables, components, sampleFrames, warnings };
}

export interface SampleFramePick {
  nodeId: string; name: string; widthPx: number; heightPx: number; area: number;
}

export function pickSampleFrames(document: any): SampleFramePick[] {
  const candidates: SampleFramePick[] = [];
  const canvases = (document?.children ?? []).filter((c: any) => c?.type === "CANVAS");
  for (const canvas of canvases) {
    for (const frame of canvas.children ?? []) {
      if (frame?.type !== "FRAME") continue;
      const box = frame.absoluteBoundingBox;
      if (!box || box.width < MIN_FRAME_SIDE || box.height < MIN_FRAME_SIDE) continue;
      candidates.push({
        nodeId: frame.id, name: frame.name ?? "",
        widthPx: box.width, heightPx: box.height,
        area: box.width * box.height,
      });
    }
  }
  candidates.sort((a, b) => b.area - a.area);
  return candidates.slice(0, MAX_SAMPLE_FRAMES);
}

function parseStyles(raw: any, warnings: string[]): SystemSources["styles"] {
  const paint: PaintStyle[] = [];
  const text: TextStyle[] = [];
  const effect: EffectStyle[] = [];
  if (!raw?.styles || !Array.isArray(raw.styles)) {
    warnings.push("styles payload missing or malformed");
    return { paint, text, effect };
  }
  for (const s of raw.styles) {
    const id = String(s.node_id ?? s.id ?? "");
    const name = String(s.name ?? "");
    const type = String(s.style_type ?? s.styleType ?? "");
    if (type === "FILL" && typeof s.hex === "string") paint.push({ id, name, hex: s.hex });
    else if (type === "FILL") paint.push({ id, name, hex: "" });
    else if (type === "TEXT") text.push({
      id, name,
      family: String(s.font_family ?? s.fontFamily ?? ""),
      size: Number(s.font_size ?? s.fontSize ?? 0),
      weight: Number(s.font_weight ?? s.fontWeight ?? 400),
      lineHeight: s.line_height ?? s.lineHeight,
      letterSpacing: s.letter_spacing ?? s.letterSpacing,
    });
    else if (type === "EFFECT") effect.push({ id, name, css: String(s.css ?? "") });
  }
  return { paint, text, effect };
}

function parseVariables(raw: any, warnings: string[]): SystemSources["variables"] {
  const color: ColorVariable[] = [];
  const number: NumberVariable[] = [];
  if (!raw) {
    warnings.push("variables payload unavailable");
    return { color, number };
  }
  const collections: any[] = raw.variable_collections ?? raw.variableCollections ?? [];
  const vars: any[] = raw.variables ?? [];
  const collectionNameById = new Map<string, string>();
  for (const c of collections) collectionNameById.set(String(c.id), String(c.name ?? ""));
  for (const v of vars) {
    const collection = collectionNameById.get(String(v.variable_collection_id ?? v.collectionId ?? "")) ?? "";
    const name = String(v.name ?? "");
    const type = String(v.resolved_type ?? v.resolvedType ?? v.type ?? "");
    if (type === "COLOR" && typeof v.hex === "string") color.push({ name, hex: v.hex, collection });
    else if (type === "FLOAT" && typeof v.value === "number") number.push({ name, value: v.value, collection });
  }
  return { color, number };
}

function parseComponents(raw: any, warnings: string[]): ComponentRef[] {
  if (!raw?.components || !Array.isArray(raw.components)) {
    warnings.push("components payload missing or malformed");
    return [];
  }
  const out: ComponentRef[] = [];
  for (const c of raw.components) {
    out.push({
      id: String(c.node_id ?? c.id ?? ""),
      name: String(c.name ?? ""),
      isComponentSet: Boolean(c.is_component_set ?? c.isComponentSet ?? false),
    });
  }
  return out;
}
