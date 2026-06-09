// studio/__tests__/export/figma/executeSwap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { executeSwap, type SwapBridge } from "../../../src/export/figma/executeSwap";
import type { SwapOp } from "../../../src/export/figma/swapOps";

function makeBridge(overrides: Partial<SwapBridge> = {}): { bridge: SwapBridge; calls: string[] } {
  const calls: string[] = [];
  let seq = 0;
  const base: SwapBridge = {
    async createInstance(key, parentId, variant) { calls.push(`createInstance:${key}->${parentId}:${variant ? JSON.stringify(variant) : ""}`); return "inst-" + seq++; },
    async positionNode(id, box) { calls.push(`position:${id}:${box.x},${box.y},${box.width},${box.height}`); },
    async setInstanceText(id, propName, chars) { calls.push(`text:${id}:${propName ?? "(auto)"}:${chars}`); },
    async bindVariable(id, field, key) { calls.push(`bind:${id}:${field}:${key}`); },
    async clearChildren(id) { calls.push(`clear:${id}`); },
    async removeNode(id) { calls.push(`remove:${id}`); },
  };
  return { bridge: { ...base, ...overrides }, calls };
}

describe("executeSwap", () => {
  it("replaceWithInstance: creates instance under parent, positions, sets text, removes flat frame (in that order)", async () => {
    const ops: SwapOp[] = [{
      op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "K", parentNodeId: "side",
      box: { x: 8, y: 148, width: 239, height: 36 }, text: { propName: "Item name#8536:0", characters: "Hi" },
    }];
    const { bridge, calls } = makeBridge();
    const r = await executeSwap(ops, bridge);
    expect(calls[0]).toBe("createInstance:K->side:");
    expect(calls).toContain("position:inst-0:8,148,239,36");
    expect(calls).toContain("text:inst-0:Item name#8536:0:Hi");
    expect(calls.indexOf("remove:flat1")).toBeGreaterThan(calls.indexOf("createInstance:K->side:"));
    expect(r.summary.replaced).toBe(1);
    expect(r.summary.failures).toBe(0);
  });

  it("does NOT remove the flat frame when instance creation fails", async () => {
    const ops: SwapOp[] = [{ op: "replaceWithInstance", targetNodeId: "flat1", componentSetKey: "K", parentNodeId: "side", box: { x: 0, y: 0, width: 1, height: 1 } }];
    const { bridge, calls } = makeBridge({ async createInstance() { throw new Error("boom"); } });
    const r = await executeSwap(ops, bridge);
    expect(calls).not.toContain("remove:flat1");
    expect(r.summary.failures).toBe(1);
    expect(r.summary.replaced).toBe(0);
  });

  it("injectInstances: clears the container then creates each instance under it", async () => {
    const ops: SwapOp[] = [{
      op: "injectInstances", containerNodeId: "transcript", clearChildren: true,
      instances: [
        { componentSetKey: "B", variant: { Type: "Receiver" }, box: { x: 16, y: 16, width: 400, height: 409 }, text: { characters: "Hi" } },
        { componentSetKey: "B", variant: { Type: "Sender" }, box: { x: 16, y: 449, width: 317, height: 41 }, text: { characters: "Yo" } },
      ],
    }];
    const { bridge, calls } = makeBridge();
    const r = await executeSwap(ops, bridge);
    expect(calls[0]).toBe("clear:transcript");
    expect(calls).toContain('createInstance:B->transcript:{"Type":"Receiver"}');
    expect(calls).toContain('createInstance:B->transcript:{"Type":"Sender"}');
    expect(calls).toContain("text:inst-0:(auto):Hi");
    expect(r.summary.injected).toBe(2);
  });
});
