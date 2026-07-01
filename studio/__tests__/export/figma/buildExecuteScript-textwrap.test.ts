// studio/__tests__/export/figma/buildExecuteScript-textwrap.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";

const MAPS: ExecutePlanMaps = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

describe("buildExecuteScript text wrapping", () => {
  it("emits textAutoResize HEIGHT pattern for text nodes with width > 0", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 400, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 200, height: 40 },
            layout: null,
            style: { characters: "Long text that should wrap", fontSize: 14 },
            children: [],
          },
        ],
      },
    };

    const script = buildExecuteScript(slj, MAPS);
    expect(script).toContain('t.textAutoResize = "HEIGHT"');
    expect(script).toContain("t.resize");
  });

  it("emits lineHeight assignment with PIXELS unit when lineHeight present", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 400, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 200, height: 40 },
            layout: null,
            style: { characters: "Text", fontSize: 14, lineHeight: 20 },
            children: [],
          },
        ],
      },
    };

    const script = buildExecuteScript(slj, MAPS);
    expect(script).toContain("t.lineHeight");
    expect(script).toContain("PIXELS");
  });

  it("applies lineHeight before autoresize (correct order)", () => {
    const slj: SljDocument = {
      slj: 1,
      frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element",
        tag: "div",
        box: { x: 0, y: 0, width: 400, height: 100 },
        layout: null,
        style: {},
        children: [
          {
            kind: "element",
            tag: "text",
            box: { x: 10, y: 10, width: 200, height: 40 },
            layout: null,
            style: { characters: "Text", fontSize: 14, lineHeight: 20 },
            children: [],
          },
        ],
      },
    };

    const script = buildExecuteScript(slj, MAPS);
    // lineHeight should come before textAutoResize in the text branch
    const lineHeightIdx = script.indexOf("t.lineHeight");
    const autoresizeIdx = script.indexOf('t.textAutoResize = "HEIGHT"');
    expect(lineHeightIdx).toBeGreaterThan(0);
    expect(autoresizeIdx).toBeGreaterThan(0);
    expect(lineHeightIdx).toBeLessThan(autoresizeIdx);
  });
});
