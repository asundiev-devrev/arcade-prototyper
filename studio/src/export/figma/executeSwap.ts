// studio/src/export/figma/executeSwap.ts
import type { Box } from "../slj";
import type { SwapOp } from "./swapOps";

/** Bridge surface the executor needs. Live impl wraps figma-console MCP
 *  (local-node instancing for create; in-file variable import for bind);
 *  tests pass a fake. */
export interface SwapBridge {
  createInstance(componentSetKey: string, parentNodeId: string, variant?: Record<string, string>): Promise<string>;
  positionNode(nodeId: string, box: Box): Promise<void>;
  setInstanceText(nodeId: string, propName: string | undefined, characters: string): Promise<void>;
  bindVariable(nodeId: string, field: "fill" | "stroke", variableKey: string): Promise<void>;
  /** Swap the instance's inner Icons/* child to the given Icons/* component-set key. */
  setIconChild(nodeId: string, iconSetKey: string): Promise<void>;
  clearChildren(nodeId: string): Promise<void>;
  removeNode(nodeId: string): Promise<void>;
}

export interface SwapResult {
  perOp: Array<{ op: string; ok: boolean; error?: string }>;
  summary: { replaced: number; injected: number; failures: number };
}

export async function executeSwap(ops: SwapOp[], bridge: SwapBridge): Promise<SwapResult> {
  const perOp: SwapResult["perOp"] = [];
  const summary = { replaced: 0, injected: 0, failures: 0 };

  for (const op of ops) {
    try {
      if (op.op === "replaceWithInstance") {
        // Create the real instance FIRST; only remove the flat frame once it exists.
        const id = await bridge.createInstance(op.componentSetKey, op.parentNodeId, op.variant);
        await bridge.positionNode(id, op.box);
        if (op.text) await bridge.setInstanceText(id, op.text.propName, op.text.characters);
        for (const b of op.binds ?? []) await bridge.bindVariable(id, b.field, b.variableKey);
        if (op.icon) {
          try { await bridge.setIconChild(id, op.icon.setKey); }
          catch (e) { perOp.push({ op: "setIconChild", ok: false, error: String((e as Error).message ?? e) }); }
        }
        await bridge.removeNode(op.targetNodeId);
        summary.replaced++;
        perOp.push({ op: op.op, ok: true });
      } else if (op.op === "injectInstances") {
        if (op.clearChildren) await bridge.clearChildren(op.containerNodeId);
        for (const inst of op.instances) {
          const id = await bridge.createInstance(inst.componentSetKey, op.containerNodeId, inst.variant);
          await bridge.positionNode(id, inst.box);
          if (inst.text) await bridge.setInstanceText(id, inst.text.propName, inst.text.characters);
          summary.injected++;
        }
        perOp.push({ op: op.op, ok: true });
      }
    } catch (e) {
      summary.failures++;
      perOp.push({ op: op.op, ok: false, error: String((e as Error).message ?? e) });
    }
  }
  return { perOp, summary };
}
