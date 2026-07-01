// studio/__tests__/export/executePlan-svg.test.ts
import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import { buildExecuteScript } from "../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../src/export/slj";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan SVG nodes", () => {
  it("converts SljNode with tag=svg and style.svg to PlanNode kind=svg", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "svg",
            box: { x: 10, y: 10, width: 24, height: 24 },
            layout: null,
            style: {
              svg: '<svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ff0000"/></svg>',
            },
            children: [],
          },
        ],
      },
    };

    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect(plan.root.children).toHaveLength(1);

    const svgNode = plan.root.children[0];
    expect(svgNode.kind).toBe("svg");
    if (svgNode.kind === "svg") {
      expect(svgNode.box).toEqual({ x: 10, y: 10, width: 24, height: 24 });
      expect(svgNode.markup).toBe('<svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ff0000"/></svg>');
    }
  });

  it("converts svg element without style.svg to regular frame", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "svg",
        box: { x: 0, y: 0, width: 24, height: 24 },
        layout: null,
        style: {},
        children: [],
      },
    };

    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.kind).toBe("frame");
  });
});

describe("buildExecuteScript SVG runtime", () => {
  it("generates script with createNodeFromSvg for svg nodes", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "icon-test", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "svg",
            box: { x: 10, y: 10, width: 24, height: 24 },
            layout: null,
            style: {
              svg: '<svg width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>',
            },
            children: [],
          },
        ],
      },
    };

    const script = buildExecuteScript(slj, MAPS as any);

    // Verify script contains the SVG node creation logic
    expect(script).toContain('kind === "svg"');
    expect(script).toContain('figma.createNodeFromSvg');
    expect(script).toContain('node.markup');
    expect(script).toContain('made.icons++');

    // Verify it has fallback to frame on parse failure
    expect(script).toContain('if (sv)');
  });

  it("script includes svg markup in plan data", () => {
    const svgMarkup = '<svg><path d="M10,10"/></svg>';
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "svg",
        box: { x: 0, y: 0, width: 24, height: 24 },
        layout: null,
        style: { svg: svgMarkup },
        children: [],
      },
    };

    const script = buildExecuteScript(slj, MAPS as any);

    // The script should embed the SVG markup in the plan JSON (escaped in JSON)
    expect(script).toContain('"markup":"<svg><path d=\\"M10,10\\"/></svg>"');
  });
});
