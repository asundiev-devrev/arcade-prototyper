// studio/scripts/runtime-probe.mts
//
// Deterministic runtime probe. Runs the REAL Figma-plugin runtime string
// (from buildExecuteScript) against a RECORDING mock of the Figma API, fed a
// real stored SLJ.json. Produces a flat inventory of every node the runtime
// would create in Figma — fills, positions, effects, text — WITHOUT the flaky
// Desktop bridge.
//
// This is the local, bridge-free half of the fidelity measurement engine. It
// answers "what does the runtime actually build from this SLJ" deterministically.
// It does NOT prove pixel fidelity (only real Figma does that) — it proves what
// nodes/fills/geometry the runtime emits, which is enough to catch whole classes
// of runtime bug (dropped nodes, wrong fills, mis-positioning, alpha loss).
//
// Usage:
//   pnpm tsx studio/scripts/runtime-probe.mts <path-to-SLJ.json> [--json]
//
import { readFileSync } from "node:fs";
import { buildExecuteScript } from "../src/export/figma/buildExecuteScript.ts";
import type { ExecutePlanMaps } from "../src/export/figma/executePlan.ts";
import type { SljDocument } from "../src/export/slj.ts";

// Maps stub that simulates the PRODUCTION fill path: every `--token` resolves to
// a (synthetic) Figma variable key, so fillFields emits a fillVariableKey and
// the runtime's bindFill path runs — matching real Figma, where color variables
// always import live (see memory: figma-variables + color-binds-live). Component
// mapping is left OFF so everything renders on the faithful frame/text/svg/image
// path (the pixel-first layer we're measuring); the instance path is probed
// separately. This makes token FILLS honest instead of collapsing to "none".
const NOOP_MAPS: ExecutePlanMaps = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: (t: string) => (t && t.startsWith("--") ? "VarKey:" + t : null),
};

export interface ProbeNode {
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Summarized fills: e.g. "SOLID rgba(1,0.2,0.18,0.16)" or "IMAGE" or "none". */
  fills: string[];
  clipsContent?: boolean;
  opacity?: number;
  effects?: string[];
  cornerRadius?: number;
  strokes?: string[];
  rotation?: number;
  characters?: string;
  depth: number;
  parentName?: string;
}

function fmtColor(c: any, opacity?: number): string {
  if (!c) return "?";
  const r = Math.round((c.r ?? 0) * 255);
  const g = Math.round((c.g ?? 0) * 255);
  const b = Math.round((c.b ?? 0) * 255);
  const a = opacity ?? c.a ?? 1;
  return `rgba(${r},${g},${b},${Number(a).toFixed(2)})`;
}

function fmtFills(fills: any[]): string[] {
  if (!Array.isArray(fills) || fills.length === 0) return ["none"];
  return fills.map((f) => {
    const boundTag = f.__boundVar ? ` VAR(${f.__boundVar})` : "";
    if (f.type === "SOLID") return `SOLID ${fmtColor(f.color, f.opacity)}${boundTag}`;
    if (f.type === "IMAGE") return `IMAGE ${f.scaleMode}`;
    if (f.type && f.type.indexOf("GRADIENT") === 0) return `GRADIENT`;
    return (f.type || "?") + boundTag;
  });
}

/** A recording Figma mock. Every created node is a plain object that records
 *  the properties the runtime sets. We keep insertion order + parent linkage so
 *  we can produce a depth-first inventory that mirrors the Figma layer tree. */
export function makeRecordingMock() {
  const nodes: any[] = [];
  let idc = 0;

  function baseNode(type: string) {
    const n: any = {
      __id: idc++,
      type,
      name: type === "FRAME" ? "frame" : type.toLowerCase(),
      x: 0, y: 0, width: 0, height: 0,
      fills: [] as any[],
      strokes: [] as any[],
      effects: [] as any[],
      opacity: 1,
      clipsContent: true,
      cornerRadius: 0,
      rotation: 0,
      children: [] as any[],
      __parent: null as any,
      layoutMode: "NONE", itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      counterAxisAlignItems: "MIN",
      primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
      appendChild(c: any) { c.__parent = this; this.children.push(c); },
      insertChild(i: number, c: any) { c.__parent = this; this.children.splice(i, 0, c); },
      resize(w: number, h: number) { this.width = w; this.height = h; },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      findAll(pred: any) { const out: any[] = []; const rec = (m: any) => { for (const k of m.children || []) { if (!pred || pred(k)) out.push(k); rec(k); } }; rec(this); return out; },
      findOne(pred: any) { return this.findAll(pred)[0] || null; },
      remove() {},
      setProperties() {},
    };
    nodes.push(n);
    return n;
  }

  const figma: any = {
    createFrame() { return baseNode("FRAME"); },
    createText() {
      const t = baseNode("TEXT");
      t.fontName = { family: "Inter", style: "Regular" };
      t.characters = "";
      t.fontSize = 14;
      t.lineHeight = { value: 20, unit: "PIXELS" };
      t.textAutoResize = "NONE";
      return t;
    },
    createImage(bytes: Uint8Array) { return { hash: "img_" + Math.random().toString(36).slice(2, 8), bytes }; },
    // Faithful path: mimic Figma's SVG import as a single vector-ish frame so we
    // record that an icon WOULD render (the real API returns a FRAME of vectors).
    createNodeFromSvg(markup: string) {
      const f = baseNode("FRAME");
      f.name = "svg";
      f.__svgLen = (markup || "").length;
      return f;
    },
    currentPage: { appendChild() {}, get selection() { return []; }, set selection(_v) {} },
    viewport: { scrollAndZoomIntoView() {} },
    root: { findAllWithCriteria: () => [] },
    async importComponentSetByKeyAsync() { return null; },
    async importComponentByKeyAsync() { return null; },
    async loadFontAsync() {},
    variables: {
      // Simulate a SUCCESSFUL color-variable import (memory: color variables
      // always import live in real Figma). Returns a COLOR variable so bindFill
      // takes its success path — token fills then record as VAR(...) instead of
      // collapsing to "none", making the probe honest about the fill pipeline.
      async importVariableByKeyAsync(key: string) { return { id: "VariableID:" + key, key, resolvedType: "COLOR", name: key }; },
      setBoundVariableForPaint: (base: any, _field: string, v: any) => ({ ...base, __boundVar: v.key }),
    },
  };

  return { figma, nodes };
}

function runRuntime(code: string, figma: any): Promise<any> {
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

export interface ProbeResult {
  summary: any;
  inventory: ProbeNode[];
  /** Nodes that render invisible: no fills, no strokes, no text, no children with visuals. */
  invisibleFrames: ProbeNode[];
}

export async function probeSlj(slj: SljDocument, maps: ExecutePlanMaps = NOOP_MAPS): Promise<ProbeResult> {
  const code = buildExecuteScript(slj, maps);
  const mock = makeRecordingMock();
  const summary = await runRuntime(code, mock.figma);

  // Build a depth-first inventory following parent linkage from the root(s).
  const inventory: ProbeNode[] = [];
  const roots = mock.nodes.filter((n) => n.__parent === null);
  const seen = new Set<any>();
  function visit(n: any, depth: number) {
    if (seen.has(n)) return;
    seen.add(n);
    inventory.push({
      type: n.type,
      name: n.name,
      x: Math.round(n.x), y: Math.round(n.y),
      width: Math.round(n.width), height: Math.round(n.height),
      fills: fmtFills(n.fills),
      clipsContent: n.type === "FRAME" ? n.clipsContent : undefined,
      opacity: n.opacity !== 1 ? n.opacity : undefined,
      effects: n.effects && n.effects.length ? n.effects.map((e: any) => `${e.type} ${fmtColor(e.color)} off(${e.offset?.x},${e.offset?.y}) r${e.radius}`) : undefined,
      cornerRadius: n.cornerRadius || undefined,
      strokes: n.strokes && n.strokes.length ? fmtFills(n.strokes) : undefined,
      rotation: n.rotation || undefined,
      characters: n.type === "TEXT" ? n.characters : undefined,
      depth,
      parentName: n.__parent?.name,
    });
    for (const c of n.children || []) visit(c, depth + 1);
  }
  for (const r of roots) visit(r, 0);

  // Flag "invisible" frames: FRAME with no fill, no stroke, no effect, and no
  // descendant that paints anything. These are pure structure — fine if they
  // hold visible children, suspicious if they're a leaf that should have paint.
  const invisibleFrames = inventory.filter((n) =>
    n.type === "FRAME" &&
    (n.fills.length === 0 || (n.fills.length === 1 && n.fills[0] === "none")) &&
    !n.strokes && !n.effects
  );

  return { summary, inventory, invisibleFrames };
}

// CLI
const path = process.argv[2];
if (!path) {
  console.error("usage: pnpm tsx studio/scripts/runtime-probe.mts <SLJ.json> [--json]");
  process.exit(1);
}
const slj = JSON.parse(readFileSync(path, "utf8")) as SljDocument;

// --live-maps: use the REAL component/icon/token maps so the INSTANCE path is
// exercised (mapped arcade-gen components → PlanInstance). The recording mock's
// import* functions return null, which faithfully simulates the cold-import wall
// (WS3/WS4): the runtime then hits its local-search fallback + made.fail path.
// This measures what a real export does to component instances when the library
// can't cold-import — the biggest unmeasured risk surface.
let maps = undefined;
if (process.argv.includes("--live-maps")) {
  const { findComponentMapping } = await import("../src/export/figma/componentMap.ts");
  const { findIconMapping } = await import("../src/export/figma/iconMap.ts");
  const { buildTokenMap } = await import("../src/export/figma/tokenMap.ts");
  const variablesSnapshot: any = (await import("../src/export/figma/figma-variables.json", { with: { type: "json" } })).default;
  const tokenMap = buildTokenMap(variablesSnapshot.variables);
  maps = {
    findComponentMapping,
    findIconSetKey: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.componentSetKey : null; },
    findIconSetName: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.setName : null; },
    tokenNameToVariableKey: tokenMap.tokenNameToVariableKey,
  };
}
const res = await probeSlj(slj, maps);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(res, null, 2));
} else {
  console.log("=== RUNTIME SUMMARY ===");
  console.log(JSON.stringify(res.summary, null, 2));
  console.log(`\n=== INVENTORY: ${res.inventory.length} nodes ===`);
  for (const n of res.inventory) {
    const pad = "  ".repeat(n.depth);
    const bits = [
      `${n.type}`,
      n.name && n.name !== n.type.toLowerCase() ? `"${n.name}"` : "",
      `@(${n.x},${n.y}) ${n.width}x${n.height}`,
      `fill=${n.fills.join("|")}`,
      n.strokes ? `stroke=${n.strokes.join("|")}` : "",
      n.effects ? `fx=${n.effects.join("|")}` : "",
      n.opacity != null ? `op=${n.opacity}` : "",
      n.rotation != null ? `rot=${n.rotation}` : "",
      n.cornerRadius != null ? `r=${n.cornerRadius}` : "",
      n.clipsContent ? "CLIP" : "",
      n.characters != null ? `text=${JSON.stringify(n.characters.slice(0, 40))}` : "",
    ].filter(Boolean).join(" ");
    console.log(pad + bits);
  }
  console.log(`\n=== ${res.invisibleFrames.length} INVISIBLE (no-paint) FRAMES ===`);
}
