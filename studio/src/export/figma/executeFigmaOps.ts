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

export async function executeFigmaOps(ops: FigmaOp[], bridge: FigmaBridge): Promise<ExecResult> {
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

  const realParent = (p: string | null): string | null => (p && p !== "" ? real.get(p) ?? null : null);

  for (const o of ops) {
    try {
      if (o.op === "createFrame") {
        const rid = await bridge.createFrame(realParent(o.parent));
        real.set(o.id, rid); summary.frames++;
        if (rootNodeId === null) rootNodeId = rid;
      } else if (o.op === "createInstance") {
        const rid = await bridge.createInstance(o.componentKey, realParent(o.parent), o.variant);
        real.set(o.id, rid); summary.instances++;
        if (rootNodeId === null) rootNodeId = rid;
      } else if (o.op === "setText") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.setText(rid, o.textNodeHint, o.characters);
      } else if (o.op === "bindVariable") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
        await bridge.bindVariable(rid, o.field, o.variableKey); summary.boundVariables++;
      } else if (o.op === "setFill") {
        const rid = real.get(o.target);
        if (!rid) { perOp.push({ op: o.op, ok: false, error: `target ${o.target} not created` }); summary.failures++; continue; }
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
