import { describe, it, expect } from "vitest";
import { countPlanNodes } from "../../server/middleware/figmaExport";

describe("countPlanNodes", () => {
  it("counts instances (Tier 1) vs frames/text (Tier 2)", () => {
    const root: any = { kind: "frame", children: [
      { kind: "instance", children: [] },
      { kind: "text", },
      { kind: "frame", children: [{ kind: "instance", children: [] }] },
    ]};
    expect(countPlanNodes(root)).toEqual({ instances: 2, frames: 2, text: 1 });
  });
});
