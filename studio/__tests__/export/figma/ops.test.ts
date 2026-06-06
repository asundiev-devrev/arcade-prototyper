// studio/__tests__/export/figma/ops.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { FigmaOp, FigmaPlan } from "../../../src/export/figma/ops";
import { isCreateOp } from "../../../src/export/figma/ops";

describe("figma ops types", () => {
  it("isCreateOp distinguishes node-creating ops from mutation ops", () => {
    const frame: FigmaOp = { op: "createFrame", id: "n0", parent: null, layout: null, box: { x: 0, y: 0, width: 1, height: 1 } };
    const inst: FigmaOp = { op: "createInstance", id: "n1", parent: "n0", componentKey: "k" };
    const text: FigmaOp = { op: "setText", target: "n1", textNodeHint: { strategy: "lowest-depth" }, characters: "hi" };
    expect(isCreateOp(frame)).toBe(true);
    expect(isCreateOp(inst)).toBe(true);
    expect(isCreateOp(text)).toBe(false);
    const plan: FigmaPlan = { rootId: "n0", ops: [frame, inst, text] };
    expect(plan.ops).toHaveLength(3);
  });
});
