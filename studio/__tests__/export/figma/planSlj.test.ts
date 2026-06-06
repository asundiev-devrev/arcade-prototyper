// studio/__tests__/export/figma/planSlj.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { planFigmaOps, type PlannerMaps } from "../../../src/export/figma/planSlj";
import type { SljDocument } from "../../../src/export/slj";

const MAPS: PlannerMaps = {
  findComponentMapping: (name) =>
    name === "ChatBubble"
      ? { arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
          figma: { componentSetKey: "k-bubble", setName: "Bubble" },
          variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver" } }],
          textNode: { strategy: "lowest-depth" }, note: "" }
      : null,
  tokenNameToVariableKey: (n) => (n === "--bg-neutral-soft" ? "var-bg-neutral-soft" : null),
};

function doc(root: SljDocument["root"]): SljDocument {
  return { slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" }, root };
}

const box = { x: 0, y: 0, width: 10, height: 10 };

describe("planFigmaOps — element nodes", () => {
  it("emits a root createFrame for an element root with its layout", () => {
    const plan = planFigmaOps(doc({
      kind: "element", tag: "div", box,
      layout: { mode: "vertical", gap: 8, padding: [4, 4, 4, 4], align: "start" },
      style: {}, children: [],
    }), MAPS);
    expect(plan.ops[0]).toMatchObject({ op: "createFrame", parent: null, layout: { mode: "vertical", gap: 8 } });
    expect(plan.rootId).toBe(plan.ops[0].op === "createFrame" ? plan.ops[0].id : "");
  });

  it("binds a token fill to a variable, and emits setFill for a raw fill", () => {
    const tokenFill = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "--bg-neutral-soft" }, children: [] }), MAPS);
    expect(tokenFill.ops).toContainEqual(expect.objectContaining({ op: "bindVariable", field: "fill", variableKey: "var-bg-neutral-soft" }));

    const rawFill = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "rgb(1,2,3)" }, children: [] }), MAPS);
    expect(rawFill.ops).toContainEqual(expect.objectContaining({ op: "setFill", field: "fill", color: "rgb(1,2,3)" }));

    const unknownToken = planFigmaOps(doc({ kind: "element", tag: "div", box, layout: null, style: { fill: "--not-a-real-token" }, children: [] }), MAPS);
    expect(unknownToken.ops).toContainEqual(expect.objectContaining({ op: "setFill", field: "fill", color: "--not-a-real-token" }));
  });

  it("emits a text node's characters via setText and binds its color", () => {
    const plan = planFigmaOps(doc({
      kind: "element", tag: "text", box, layout: null,
      style: { characters: "Hello", color: "--bg-neutral-soft" }, children: [],
    }), MAPS);
    expect(plan.ops).toContainEqual(expect.objectContaining({ op: "setText", characters: "Hello" }));
    expect(plan.ops).toContainEqual(expect.objectContaining({ op: "bindVariable", field: "fill", variableKey: "var-bg-neutral-soft" }));
  });
});

describe("planFigmaOps — variant edge cases", () => {
  it("applies a valueMap entry even when it maps to an empty string", () => {
    const maps = {
      findComponentMapping: (name: string) =>
        name === "Thing"
          ? { arcadeGen: "Thing", status: "mapped" as const, generation: "0.3" as const,
              figma: { componentSetKey: "k-thing", setName: "Thing" },
              variants: [{ prop: "mode", figmaProp: "Mode", valueMap: { default: "" } }],
              note: "" }
          : null,
      tokenNameToVariableKey: () => null,
    };
    const plan = planFigmaOps(doc({
      kind: "component", component: "Thing", source: "arcade/components",
      props: { mode: "default" }, box, layout: null, children: [],
    }), maps);
    const inst = plan.ops.find((o) => o.op === "createInstance") as { variant?: Record<string,string> };
    expect(inst.variant).toEqual({ Mode: "" });
  });
});
