import { describe, it, expect } from "vitest";
import { walkFiber } from "../../src/export/fiberWalk";

// Minimal fake reader/ctx: a single text host node with a computed style.
function fakeStyle(map: Record<string,string>) {
  return { getPropertyValue: (p: string) => map[p] ?? "" };
}
function makeCtx(styleMap: Record<string,string>) {
  return {
    isSkippable: () => false,
    isComponent: () => null,
    iconNameFor: () => null,
    resolveColor: (v: string) => v,
    reader: {
      hostTag: () => "span",
      box: () => ({ x: 0, y: 0, width: 40, height: 16 }),
      text: () => "Hello",
      style: () => fakeStyle(styleMap),
      hostClassName: () => null,
    },
  } as any;
}

describe("fiberWalk captures text styling", () => {
  it("emits color/size/weight/family/lineHeight on a text leaf", () => {
    const fiber = { child: null, sibling: null, memoizedProps: {}, type: "span" } as any;
    const node: any = walkFiber(fiber, makeCtx({
      "color": "rgb(20, 22, 26)",
      "font-size": "13px",
      "font-weight": "500",
      "font-family": "Inter, sans-serif",
      "line-height": "20px",
    }));
    expect(node.tag).toBe("text");
    expect(node.style.characters).toBe("Hello");
    expect(node.style.color).toBe("rgb(20, 22, 26)");
    expect(node.style.fontSize).toBe(13);
    expect(node.style.fontWeight).toBe(500);
    expect(node.style.fontFamily).toContain("Inter");
    expect(node.style.lineHeight).toBe(20);
  });
});
