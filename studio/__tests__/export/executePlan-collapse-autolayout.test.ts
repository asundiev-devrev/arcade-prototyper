// studio/__tests__/export/executePlan-collapse-autolayout.test.ts
// Post pixel-first: layout is always null, so everything is absolute context.
// Collapse happens unconditionally for styleless single-child wrappers.
import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import type { SljDocument } from "../../src/export/slj";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("executePlan collapse in pixel-first mode (all absolute)", () => {
  it("collapses wrapper even when SLJ element had auto-layout (pixel-first nulls it)", () => {
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
    // Pixel-first: root layout forced to null → everything is absolute → collapse happens
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
    expect((plan.root.children[0] as any).characters).toBe("Label");
  });

  it("collapses wrapper inside absolute parent (layout null) — same as before", () => {
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
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
    expect((plan.root.children[0] as any).characters).toBe("Label");
  });

  it("collapses wrapper with SLJ layout (pixel-first nulls it, so no layout on wrapper)", () => {
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
            layout: { mode: "horizontal", gap: 4, padding: [0, 0, 0, 0], align: "start" },
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
    // Pixel-first nulls wrapper layout too → it's now styleless single-child → collapses
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
  });

  it("collapses deep chain in absolute context", () => {
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
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
  });
});
