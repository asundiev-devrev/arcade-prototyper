// studio/server/middleware/figmaExport.ts
//
// POST /api/projects/:slug/export/:frame/to-figma
// Loads the frame's stored SLJ, builds the Figma build script, and runs it
// through the Bridge WS server (which the Figma Desktop Bridge plugin connects
// to). One EXECUTE_CODE round trip. Returns { ok, summary } or a typed error.
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { frameDir } from "../paths";
import type { SljDocument } from "../../src/export/slj";
import { buildExecuteScript } from "../../src/export/figma/buildExecuteScript";
import { findComponentMapping } from "../../src/export/figma/componentMap";
import { findIconMapping } from "../../src/export/figma/iconMap";
import { buildTokenMap } from "../../src/export/figma/tokenMap";
import variablesSnapshot from "../../src/export/figma/figma-variables.json";
import { startBridgeServer, type BridgeServer } from "../figmaBridge/wsServer";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import { track } from "../../src/lib/telemetry/server";

const ROUTE = /^\/api\/projects\/([a-z0-9-]+)\/export\/([a-z0-9-]+)\/to-figma(?:\?.*)?$/;
// File the export pipeline writes per frame — see server/middleware/export.ts
// (POST /api/projects/:slug/export/:frame.slj.json → frameDir/SLJ.json).
const SLJ_FILENAME = "SLJ.json";
const EXEC_TIMEOUT_MS = 30_000;

export interface FigmaExportDeps {
  loadSlj: (slug: string, frame: string) => Promise<SljDocument | null>;
  getBridge: () => Promise<BridgeServer>;
}

export interface FigmaExportResult {
  status: number;
  body: any;
}

const tokenMap = buildTokenMap((variablesSnapshot as { variables: any[] }).variables);
const MAPS = {
  findComponentMapping,
  findIconSetKey: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.componentSetKey : null; },
  findIconSetName: (n: string) => { const m = findIconMapping(n); return m && m.figma ? m.figma.setName : null; },
  tokenNameToVariableKey: tokenMap.tokenNameToVariableKey,
};

export function countPlanNodes(node: any, acc = { instances: 0, frames: 0, text: 0 }) {
  if (node.kind === "instance") acc.instances++;
  else if (node.kind === "text") acc.text++;
  else acc.frames++;
  for (const c of node.children ?? []) countPlanNodes(c, acc);
  return acc;
}

/** Pure handler — tested directly; the middleware wraps it with HTTP plumbing. */
export async function handleFigmaExport(slug: string, frame: string, deps: FigmaExportDeps): Promise<FigmaExportResult> {
  const slj = await deps.loadSlj(slug, frame);
  if (!slj) {
    track({ name: "figma_export_failed", props: { error_kind: "build_error", duration_ms: 0 } });
    return { status: 404, body: { error: { code: "not_found", message: "No SLJ for this frame — open it first" } } };
  }

  const startedAt = Date.now();
  track({ name: "figma_export_started", props: { frame_count: 1 } });

  const bridge = await deps.getBridge();
  if (!bridge.isConnected()) {
    track({ name: "figma_export_failed", props: { error_kind: "no_bridge", duration_ms: Date.now() - startedAt } });
    return { status: 409, body: { error: { code: "no_bridge", message: "No Figma plugin connected. Open the Arcade export plugin in Figma, then try again." } } };
  }

  const plan = sljToExecutePlan(slj, MAPS);
  const counts = countPlanNodes(plan.root);

  const code = buildExecuteScript(slj, MAPS);
  try {
    const result = await bridge.runCode(code, EXEC_TIMEOUT_MS);
    track({ name: "figma_export_succeeded", props: {
      ds_instances: counts.instances,
      pixel_nodes: counts.frames + counts.text,
      duration_ms: Date.now() - startedAt,
    } });
    return { status: 200, body: { ok: true, summary: result } };
  } catch (err: any) {
    const msg = String(err && err.message ? err.message : err);
    if (/^no_bridge/.test(msg)) {
      track({ name: "figma_export_failed", props: { error_kind: "no_bridge", duration_ms: Date.now() - startedAt } });
      return { status: 409, body: { error: { code: "no_bridge", message: msg } } };
    }
    if (/^timeout/.test(msg)) {
      track({ name: "figma_export_failed", props: { error_kind: "timeout", duration_ms: Date.now() - startedAt } });
      return { status: 504, body: { error: { code: "timeout", message: msg } } };
    }
    track({ name: "figma_export_failed", props: { error_kind: "other", duration_ms: Date.now() - startedAt } });
    return { status: 502, body: { error: { code: "exec_error", message: msg } } };
  }
}

// --- live deps (singleton bridge) ---
let bridgeSingleton: BridgeServer | null = null;
async function liveGetBridge(): Promise<BridgeServer> {
  if (!bridgeSingleton) bridgeSingleton = await startBridgeServer({ hello: { serverVersion: "studio" } });
  return bridgeSingleton;
}
async function liveLoadSlj(slug: string, frame: string): Promise<SljDocument | null> {
  try {
    const raw = await fs.readFile(path.join(frameDir(slug, frame), SLJ_FILENAME), "utf-8");
    return JSON.parse(raw) as SljDocument;
  } catch { return null; }
}

export function figmaExportMiddleware() {
  // Start the bridge eagerly so the plugin can connect before the first export.
  void liveGetBridge();
  return async (req: IncomingMessage, res: ServerResponse, next?: () => void) => {
    const m = (req.url ?? "/").match(ROUTE);
    if (!m || req.method !== "POST") return next?.();
    const [, slug, frame] = m;
    for await (const _ of req) { /* drain body */ }
    const out = await handleFigmaExport(slug, frame, { loadSlj: liveLoadSlj, getBridge: liveGetBridge });
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(out.body));
  };
}
