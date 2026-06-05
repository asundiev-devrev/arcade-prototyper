// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SLJ_VERSION, isComponentNode, isElementNode, type SljNode } from "../../src/export/slj";

describe("slj contract", () => {
  it("declares schema version 1", () => {
    expect(SLJ_VERSION).toBe(1);
  });

  it("discriminates component vs element nodes", () => {
    const comp: SljNode = {
      kind: "component",
      component: "ChatBubble",
      source: "arcade/components",
      props: { variant: "receiver" },
      box: { x: 0, y: 0, width: 10, height: 10 },
      layout: null,
      children: [],
    };
    const el: SljNode = {
      kind: "element",
      tag: "div",
      box: { x: 0, y: 0, width: 10, height: 10 },
      layout: null,
      style: {},
      children: [],
    };
    expect(isComponentNode(comp)).toBe(true);
    expect(isComponentNode(el)).toBe(false);
    expect(isElementNode(el)).toBe(true);
  });
});
