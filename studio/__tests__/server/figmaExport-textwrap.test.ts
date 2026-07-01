// studio/__tests__/server/figmaExport-textwrap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sljToExecutePlan, type ExecutePlanMaps } from "../../src/export/figma/executePlan";
import type { SljDocument, ElementNode } from "../../src/export/slj";
import { buildExecuteScript } from "../../src/export/figma/buildExecuteScript";

const mockMaps: ExecutePlanMaps = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("Text wrapping detection (executePlan)", () => {
  it("wraps text with lineHeight when box.height >= lineHeight * 1.8 (multiline case)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 150, height: 60 },
            layout: null,
            style: {
              characters: "Multi-line text",
              fontSize: 14,
              lineHeight: 20,
            },
            children: [],
          } as ElementNode,
        ],
      },
    };

    const plan = sljToExecutePlan(slj, mockMaps);
    const textNode = plan.root.children![0];
    expect(textNode.kind).toBe("text");
    expect((textNode as any).wrap).toBe(true);
  });

  it("does not wrap text with lineHeight when box.height < lineHeight * 1.8 (single line)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 150, height: 20 },
            layout: null,
            style: {
              characters: "Settings",
              fontSize: 14,
              lineHeight: 20,
            },
            children: [],
          } as ElementNode,
        ],
      },
    };

    const plan = sljToExecutePlan(slj, mockMaps);
    const textNode = plan.root.children![0];
    expect(textNode.kind).toBe("text");
    expect((textNode as any).wrap).toBeUndefined();
  });

  it("wraps text without lineHeight when box.height >= fontSize * 2.2 (multiline inferred)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 150, height: 40 },
            layout: null,
            style: {
              characters: "Multi-line text",
              fontSize: 14,
            },
            children: [],
          } as ElementNode,
        ],
      },
    };

    const plan = sljToExecutePlan(slj, mockMaps);
    const textNode = plan.root.children![0];
    expect(textNode.kind).toBe("text");
    expect((textNode as any).wrap).toBe(true);
  });

  it("does not wrap text without lineHeight when box.height < fontSize * 2.2 (single line)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 150, height: 18 },
            layout: null,
            style: {
              characters: "Settings",
              fontSize: 14,
            },
            children: [],
          } as ElementNode,
        ],
      },
    };

    const plan = sljToExecutePlan(slj, mockMaps);
    const textNode = plan.root.children![0];
    expect(textNode.kind).toBe("text");
    expect((textNode as any).wrap).toBeUndefined();
  });

  it("does not wrap text with no fontSize or lineHeight", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 100, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 150, height: 60 },
            layout: null,
            style: {
              characters: "Text without metrics",
            },
            children: [],
          } as ElementNode,
        ],
      },
    };

    const plan = sljToExecutePlan(slj, mockMaps);
    const textNode = plan.root.children![0];
    expect(textNode.kind).toBe("text");
    expect((textNode as any).wrap).toBeUndefined();
  });
});

describe("Text wrapping runtime (buildExecuteScript)", () => {
  it("emits node.wrap gate in the generated script for conditional textAutoResize", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "text",
        box: { x: 0, y: 0, width: 100, height: 50 },
        layout: null,
        style: {
          characters: "Text",
          fontSize: 14,
          lineHeight: 20,
        },
        children: [],
      },
    };

    const script = buildExecuteScript(slj, mockMaps);
    expect(script).toContain("if (node.wrap && node.box.width > 0)");
    expect(script).toContain("t.textAutoResize = \"HEIGHT\"");
  });

  it("does not unconditionally set textAutoResize for single-line text", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element",
        tag: "text",
        box: { x: 0, y: 0, width: 100, height: 20 },
        layout: null,
        style: {
          characters: "Settings",
          fontSize: 14,
          lineHeight: 20,
        },
        children: [],
      },
    };

    const script = buildExecuteScript(slj, mockMaps);
    // The runtime should have the conditional, but this particular node won't have wrap:true
    expect(script).toContain("if (node.wrap && node.box.width > 0)");
    // Should NOT contain unconditional textAutoResize call outside the gate
    expect(script).not.toMatch(/if\s*\(\s*node\.box\.width\s*>\s*0\s*\)\s*{\s*try\s*{\s*t\.textAutoResize\s*=\s*"HEIGHT"/);
  });
});
