// studio/__tests__/export/figma/executeFigmaOps.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { executeFigmaOps, type FigmaBridge } from "../../../src/export/figma/executeFigmaOps";
import type { FigmaOp } from "../../../src/export/figma/ops";

function fakeBridge() {
  const calls: string[] = [];
  const imported: string[] = [];
  let nodeSeq = 0;
  const bridge: FigmaBridge = {
    async importComponent(key) { imported.push(key); return { ok: true }; },
    async importVariable(key) { imported.push("var:" + key); return { ok: true }; },
    async createFrame(_parentRealId) { calls.push("createFrame"); return "real-" + nodeSeq++; },
    async createInstance(key, _parentRealId, variant) { calls.push(`createInstance:${key}:${variant ? JSON.stringify(variant) : ""}`); return "real-" + nodeSeq++; },
    async setText(_realId, _hint, characters) { calls.push(`setText:${characters}`); },
    async bindVariable(_realId, field, variableKey) { calls.push(`bindVariable:${field}:${variableKey}`); },
    async setFill(_realId, field, color) { calls.push(`setFill:${field}:${color}`); },
  };
  return { bridge, calls, imported };
}

const ops: FigmaOp[] = [
  { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } },
  { op: "createInstance", id: "n1", parent: "n0", componentKey: "k-bubble", variant: { Type: "Receiver" }, box: { x: 0, y: 0, width: 1, height: 1 } },
  { op: "createInstance", id: "n2", parent: "n0", componentKey: "k-bubble", box: { x: 0, y: 0, width: 1, height: 1 } },
  { op: "setText", target: "n1", textNodeHint: { strategy: "lowest-depth" }, characters: "Hi" },
  { op: "bindVariable", target: "n1", field: "fill", variableKey: "var-x" },
];

describe("executeFigmaOps", () => {
  it("imports each distinct component key exactly once (dedup)", async () => {
    const { bridge, imported } = fakeBridge();
    await executeFigmaOps(ops, bridge);
    expect(imported.filter((k) => k === "k-bubble")).toHaveLength(1);
    expect(imported).toContain("var:var-x");
  });

  it("runs ops in order and maps synthetic ids to real ids for later ops", async () => {
    const { bridge, calls } = fakeBridge();
    const result = await executeFigmaOps(ops, bridge);
    expect(calls[0]).toBe("createFrame");
    expect(calls).toContain("createInstance:k-bubble:{\"Type\":\"Receiver\"}");
    expect(calls).toContain("setText:Hi");
    expect(calls).toContain("bindVariable:fill:var-x");
    expect(result.rootNodeId).toBe("real-0");
    expect(result.summary.instances).toBe(2);
    expect(result.summary.failures).toBe(0);
  });

  it("records a per-op error instead of throwing when a bridge call fails", async () => {
    const { bridge } = fakeBridge();
    const throwing: FigmaBridge = { ...bridge, async createInstance() { throw new Error("boom"); } };
    const result = await executeFigmaOps(ops, throwing);
    expect(result.summary.failures).toBeGreaterThan(0);
    expect(result.perOp.some((p) => !p.ok && /boom/.test(p.error ?? ""))).toBe(true);
    expect(result).toBeTruthy();
  });
});

describe("executeFigmaOps — partial failure resilience", () => {
  it("uses the provided rootId to report the real root node", async () => {
    const { bridge } = fakeBridge();
    // root is n0 (createFrame, created first → real-0)
    const result = await executeFigmaOps(ops, bridge, "n0");
    expect(result.rootNodeId).toBe("real-0");
  });

  it("does NOT orphan a child to root when its parent's create failed", async () => {
    const captured: string[] = [];
    let seq = 0;
    const bridge: FigmaBridge = {
      async importComponent() { return { ok: true }; },
      async importVariable() { return { ok: true }; },
      async createFrame() { throw new Error("frame boom"); },
      async createInstance(_key, parentRealId) { captured.push(`createInstance parent=${String(parentRealId)}`); return "real-" + seq++; },
      async setText() {}, async bindVariable() {}, async setFill() {},
    };
    const result = await executeFigmaOps([
      { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } },
      { op: "createInstance", id: "n1", parent: "n0", componentKey: "k", box: { x: 0, y: 0, width: 1, height: 1 } },
    ], bridge, "n0");
    // the child instance must NOT have been created (parent n0 failed → missing → skip)
    expect(captured).toHaveLength(0);
    expect(result.summary.instances).toBe(0);
    expect(result.summary.failures).toBeGreaterThanOrEqual(2); // frame fail + instance skipped
  });

  it("dedups distinct variable keys and repeated keys", async () => {
    const { bridge, imported } = fakeBridge();
    await executeFigmaOps([
      { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } },
      { op: "bindVariable", target: "n0", field: "fill", variableKey: "v1" },
      { op: "bindVariable", target: "n0", field: "stroke", variableKey: "v1" }, // repeat
      { op: "setFill", target: "n0", field: "fill", color: "#000" },
    ], bridge);
    expect(imported.filter((k) => k === "var:v1")).toHaveLength(1);
  });
});
