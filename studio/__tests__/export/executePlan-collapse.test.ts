import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import { buildExecuteScript } from "../../src/export/figma/buildExecuteScript";
import type { SljDocument, SljNode } from "../../src/export/slj";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan collapses pointless wrapper frames", () => {
  it("collapses chain of 3 styleless single-child element nodes wrapping text", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "div",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: {},
            children: [
              {
                kind: "element",
                tag: "div",
                box: { x: 15, y: 15, width: 70, height: 20 },
                layout: null,
                style: {},
                children: [
                  {
                    kind: "element",
                    tag: "text",
                    box: { x: 20, y: 18, width: 60, height: 14 },
                    layout: null,
                    style: { characters: "Hello" },
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    // Root stays; below root, text should be reached without intermediate frames
    expect(plan.root.kind).toBe("frame");
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
    expect((plan.root.children[0] as any).characters).toBe("Hello");
  });

  it("does NOT collapse wrapper WITH fill", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "div",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: { fill: "#ff0000" },
            children: [
              {
                kind: "element",
                tag: "text",
                box: { x: 20, y: 18, width: 60, height: 14 },
                layout: null,
                style: { characters: "Hello" },
                children: [],
              },
            ],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).fillColor).toBe("#ff0000");
  });

  it("does NOT collapse wrapper with 2 children", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "div",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: {},
            children: [
              {
                kind: "element",
                tag: "text",
                box: { x: 20, y: 18, width: 30, height: 14 },
                layout: null,
                style: { characters: "A" },
                children: [],
              },
              {
                kind: "element",
                tag: "text",
                box: { x: 55, y: 18, width: 30, height: 14 },
                layout: null,
                style: { characters: "B" },
                children: [],
              },
            ],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect(plan.root.children[0].children).toHaveLength(2);
  });

  it("never collapses root even if styleless single-child", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: { characters: "Hello" },
            children: [],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
  });

  it("transfers name from styleless wrapper to unnamed child frame", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "div",
            name: "Tabs",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: {},
            children: [
              {
                kind: "element",
                tag: "div",
                box: { x: 15, y: 15, width: 70, height: 20 },
                layout: null,
                style: {},
                children: [],
              },
            ],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).name).toBe("Tabs");
  });
});

describe("fiberWalk emits name from component/tag", () => {
  it("emits element node with name from composite component", () => {
    // Verify name flows through from SljDocument → PlanNode
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        name: "GeneralEmptyState",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).name).toBe("GeneralEmptyState");
  });

  it("emits semantic tag names as name", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "nav",
            name: "nav",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: null,
            style: {},
            children: [],
          },
        ],
      },
    };
    const plan = sljToExecutePlan(slj, MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    expect((plan.root.children[0] as any).name).toBe("nav");
  });
});

describe("buildExecuteScript runtime emits name assignment", () => {
  it("emitted script contains frame name assignment pattern", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        name: "TestFrame",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {},
        children: [],
      },
    };

    const script = buildExecuteScript(slj, MAPS as any);
    expect(script).toContain("f.name = node.name");
  });
});
