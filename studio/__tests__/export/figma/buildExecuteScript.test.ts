// studio/__tests__/export/figma/buildExecuteScript.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const iconButton: FigmaComponentMapping = {
  arcadeGen: "IconButton", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
};
const maps: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "IconButton" ? iconButton : null),
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};
const slj: SljDocument = {
  slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
  root: {
    kind: "element", tag: "div", box: { x: 0, y: 0, width: 1280, height: 600 }, layout: null, style: {},
    children: [{
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 10, y: 10, width: 20, height: 20 }, layout: null, children: [],
    }],
  },
};

describe("buildExecuteScript", () => {
  it("returns a non-empty JS string referencing the figma API + returning a result", () => {
    const code = buildExecuteScript(slj, maps);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(100);
    expect(code).toContain("IB_KEY");
    expect(code).toContain("figma.createFrame");
    expect(code).toContain("createInstance");
    expect(code).toMatch(/return\s+\{/);
  });

  it("embeds the plan as valid JSON (parseable substring)", () => {
    const code = buildExecuteScript(slj, maps);
    const m = code.match(/var __PLAN__\s*=\s*(\{[\s\S]*?\});/);
    expect(m).not.toBeNull();
    const plan = JSON.parse(m![1]);
    expect(plan.frame.slug).toBe("computer");
    expect(plan.root.children[0].componentSetKey).toBe("IB_KEY");
  });

  it("does not use optional chaining or TS annotations (sandbox-safe)", () => {
    const code = buildExecuteScript(slj, maps);
    expect(code).not.toContain("?.");
    expect(code).not.toContain(": string");
  });
});
