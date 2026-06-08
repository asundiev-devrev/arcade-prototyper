// studio/src/export/figma/executeFigmaOps.ts
import type { FigmaOp } from "./ops";
import type { TextNodeHint } from "./types";

/** The Bridge surface the executor needs. The real implementation wraps the
 *  figma-console MCP; tests pass a fake. Each create* returns the real Figma
 *  node id. import* are idempotent at the Figma layer; the executor still
 *  dedupes to avoid redundant slow cross-file imports. */
export interface FigmaBridge {
  importComponent(key: string): Promise<{ ok: boolean; error?: string }>;
  importVariable(key: string): Promise<{ ok: boolean; error?: string }>;
  createFrame(parentRealId: string | null): Promise<string>;
  createInstance(componentKey: string, parentRealId: string | null, variant?: Record<string, string>): Promise<string>;
  setText(realId: string, hint: TextNodeHint, characters: string): Promise<void>;
  bindVariable(realId: string, field: "fill" | "stroke", variableKey: string): Promise<void>;
  setFill(realId: string, field: "fill" | "stroke", color: string): Promise<void>;
}

export type ExecResult = {
  rootNodeId: string | null;
  perOp: Array<{ op: string; ok: boolean; error?: string }>;
  summary: { instances: number; frames: number; boundVariables: number; failures: number };
};

/** Resolve a create op's parent to a real Figma node id.
 *  - "root": parent is null or "" (the export root) → attach with null.
 *  - "ok": a non-empty parent id that resolves in the map.
 *  - "missing": a non-empty parent id NOT in the map → its ancestor's create
 *    failed/was skipped. The child must be skipped too (not orphaned to root). */
type ParentResolution =
  | { kind: "root" }
  | { kind: "ok"; realId: string }
  | { kind: "missing" };

function resolveParent(parent: string | null, real: Map<string, string>): ParentResolution {
  if (parent === null || parent === "") return { kind: "root" };
  const realId = real.get(parent);
  return realId === undefined ? { kind: "missing" } : { kind: "ok", realId };
}

/** Run a planned op list over the bridge. When `rootId` (the FigmaPlan's
 *  authoritative synthetic root id) is given, `rootNodeId` is the real id that
 *  synthetic id maps to (null if the root create failed). Without it, falls
 *  back to "first created node wins" for back-compat. */
export async function executeFigmaOps(
  ops: FigmaOp[],
  bridge: FigmaBridge,
  rootId?: string,
): Promise<ExecResult> {
  const compKeys = new Set<string>();
  const varKeys = new Set<string>();
  for (const o of ops) {
    if (o.op === "createInstance") compKeys.add(o.componentKey);
    if (o.op === "bindVariable") varKeys.add(o.variableKey);
  }
  const perOp: ExecResult["perOp"] = [];
  for (const k of compKeys) { try { await bridge.importComponent(k); } catch (e) { perOp.push({ op: "importComponent", ok: false, error: String((e as Error).message ?? e) }); } }
  for (const k of varKeys) { try { await bridge.importVariable(k); } catch (e) { perOp.push({ op: "importVariable", ok: false, error: String((e as Error).message ?? e) }); } }

  const real = new Map<string, string>();
  const summary = { instances: 0, frames: 0, boundVariables: 0, failures: 0 };
  let rootNodeId: string | null = null;

  // Record a created node's real id + track the root.
  const recordCreated = (synthId: string, realId: string) => {
    real.set(synthId, realId);
    if (rootId !== undefined) {
      if (synthId === rootId) rootNodeId = realId;
    } else if (rootNodeId === null) {
      rootNodeId = realId;
    }
  };

  for (const o of ops) {
    try {
      if (o.op === "createFrame" || o.op === "createInstance") {
        const parent = resolveParent(o.parent, real);
        if (parent.kind === "missing") {
          // Ancestor failed → skip rather than orphan to canvas root.
          perOp.push({ op: o.op, ok: false, error: `parent ${o.parent} not created` });
          summary.failures++;
          continue;
        }
        const parentRealId = parent.kind === "ok" ? parent.realId : null;
        if (o.op === "createFrame") {
          const rid = await bridge.createFrame(parentRealId);
          recordCreated(o.id, rid); summary.frames++;
        } else {
          const rid = await bridge.createInstance(o.componentKey, parentRealId, o.variant);
          recordCreated(o.id, rid); summary.instances++;
        }
      } else if (o.op === "setText") {
        const rid = real.get(o.target);
        if (rid === undefined) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.setText(rid, o.textNodeHint, o.characters);
      } else if (o.op === "bindVariable") {
        const rid = real.get(o.target);
        if (rid === undefined) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.bindVariable(rid, o.field, o.variableKey); summary.boundVariables++;
      } else if (o.op === "setFill") {
        const rid = real.get(o.target);
        if (rid === undefined) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.setFill(rid, o.field, o.color);
      }
      perOp.push({ op: o.op, ok: true });
    } catch (e) {
      perOp.push({ op: o.op, ok: false, error: String((e as Error).message ?? e) });
      summary.failures++;
    }
  }

  return { rootNodeId, perOp, summary };
}
