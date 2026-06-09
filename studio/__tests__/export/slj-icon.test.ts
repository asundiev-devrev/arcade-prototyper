// studio/__tests__/export/slj-icon.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isComponentNode, type ComponentNode } from "../../src/export/slj";

describe("ComponentNode.icon", () => {
  it("accepts an optional icon (arcade-gen icon name)", () => {
    const n: ComponentNode = {
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 0, y: 0, width: 20, height: 20 }, layout: null,
      children: [], icon: "ChevronLeftSmall",
    };
    expect(isComponentNode(n)).toBe(true);
    expect(n.icon).toBe("ChevronLeftSmall");
  });

  it("allows omitting icon (non-icon components)", () => {
    const n: ComponentNode = {
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: {}, box: { x: 0, y: 0, width: 10, height: 10 }, layout: null, children: [],
    };
    expect(n.icon).toBeUndefined();
  });
});
