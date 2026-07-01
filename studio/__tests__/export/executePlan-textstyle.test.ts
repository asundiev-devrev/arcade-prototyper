import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan carries text styling", () => {
  it("copies color/size/weight/family/lineHeight onto PlanText", () => {
    const slj: any = {
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "text", box: { x: 0, y: 0, width: 40, height: 16 },
        layout: null, children: [],
        style: { characters: "Hi", color: "#141a1a", fontSize: 13, fontWeight: 500, fontFamily: "Inter", lineHeight: 20 } },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root).toMatchObject({
      kind: "text", characters: "Hi", fillColor: "#141a1a",
      fontSize: 13, fontWeight: 500, fontFamily: "Inter", lineHeight: 20,
    });
  });
});
