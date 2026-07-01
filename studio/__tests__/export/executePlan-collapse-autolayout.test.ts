// studio/__tests__/export/executePlan-collapse-autolayout.test.ts
import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import type { SljDocument } from "../../src/export/slj";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan collapse respects auto-layout parent context", () => {
  it("does NOT collapse wrapper inside auto-layout parent (layout non-null)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" },
        style: {},
        children: [
          {
            kind: "element",
            tag: "div",
            box: { x: 0, y: 0, width: 80, height: 30 },
            layout: null,
            style: {},
            children: [
              {
                kind: "element",
                tag: "text",
                box: { x: 10, y: 10, width: 60, height: 16 },
                layout: null,
                style: { characters: "Label" },
                children: [],
              },
            ],
          },
        ],
      },
    };

    const plan = sljToExecutePlan(slj, MAPS as any);
    // Root is auto-layout → wrapper must NOT be collapsed
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).children).toHaveLength(1);
    expect((plan.root.children[0] as any).children[0].kind).toBe("text");
  });

  it("collapses wrapper inside absolute parent (layout null)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null, // absolute parent
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
                box: { x: 15, y: 15, width: 60, height: 16 },
                layout: null,
                style: { characters: "Label" },
                children: [],
              },
            ],
          },
        ],
      },
    };

    const plan = sljToExecutePlan(slj, MAPS as any);
    // Root is absolute → wrapper SHOULD be collapsed
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
    expect((plan.root.children[0] as any).characters).toBe("Label");
  });

  it("does NOT collapse wrapper that itself has layout (even with absolute parent)", () => {
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
            tag: "div",
            box: { x: 10, y: 10, width: 80, height: 30 },
            layout: { mode: "horizontal", gap: 4, padding: [0, 0, 0, 0], align: "start" }, // wrapper HAS layout
            style: {},
            children: [
              {
                kind: "element",
                tag: "text",
                box: { x: 14, y: 14, width: 60, height: 16 },
                layout: null,
                style: { characters: "Label" },
                children: [],
              },
            ],
          },
        ],
      },
    };

    const plan = sljToExecutePlan(slj, MAPS as any);
    // Wrapper has its own layout → must NOT collapse
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).layout).toEqual({ mode: "horizontal", gap: 4, padding: [0, 0, 0, 0], align: "start" });
  });

  it("collapses deep chain only in absolute context", () => {
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
            tag: "div",
            box: { x: 10, y: 10, width: 80, height: 50 },
            layout: null,
            style: {},
            children: [
              {
                kind: "element",
                tag: "div",
                box: { x: 15, y: 15, width: 70, height: 40 },
                layout: null,
                style: {},
                children: [
                  {
                    kind: "element",
                    tag: "text",
                    box: { x: 20, y: 20, width: 60, height: 16 },
                    layout: null,
                    style: { characters: "Deep" },
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
    // All absolute → full collapse
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
  });
});
