// studio/__tests__/export/fiberWalk-svg.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 24, height: 24 };
function host(tag: string, children: MinimalFiber[] = []): MinimalFiber {
  return chain({ type: tag, memoizedProps: {} } as any, children);
}
function chain(node: any, children: MinimalFiber[]): MinimalFiber {
  node.child = children[0] ?? null; node.sibling = null;
  for (let i = 0; i < children.length - 1; i++) (children[i] as any).sibling = children[i + 1];
  return node;
}

describe("walkFiber — SVG capture", () => {
  it("emits an svg element node with markup when hostTag is svg", () => {
    const svgMarkup = '<svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>';
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: () => ({ getPropertyValue: () => "" }),
      text: () => null,
      directText: () => null,
      svgMarkup: (f) => (f as any).__svgMarkup ?? null,
    };
    const ctx: WalkCtx = {
      reader,
      isComponent: () => null,
      resolveColor: (v) => v,
      isSkippable: () => false,
      iconNameFor: () => null,
    };

    const svg = host("svg");
    (svg as any).__svgMarkup = svgMarkup;
    const node = walkFiber(svg, ctx);

    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.tag).toBe("svg");
      expect(node.style.svg).toBe(svgMarkup);
      expect(node.children).toHaveLength(0); // svg is a leaf, no children walked
    }
  });

  it("emits svg without markup when svgMarkup returns null", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: () => ({ getPropertyValue: () => "" }),
      text: () => null,
      directText: () => null,
      svgMarkup: () => null,
    };
    const ctx: WalkCtx = {
      reader,
      isComponent: () => null,
      resolveColor: (v) => v,
      isSkippable: () => false,
      iconNameFor: () => null,
    };

    const svg = host("svg");
    const node = walkFiber(svg, ctx);

    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.tag).toBe("svg");
      expect(node.style.svg).toBeUndefined();
    }
  });

  it("does not walk children of svg when markup is captured", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: () => ({ getPropertyValue: () => "" }),
      text: () => null,
      directText: () => null,
      svgMarkup: (f) => (f as any).__svgMarkup ?? null,
    };
    const ctx: WalkCtx = {
      reader,
      isComponent: () => null,
      resolveColor: (v) => v,
      isSkippable: () => false,
      iconNameFor: () => null,
    };

    const circle = host("circle");
    const svg = host("svg", [circle]);
    (svg as any).__svgMarkup = '<svg><circle/></svg>';

    const node = walkFiber(svg, ctx);

    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.children).toHaveLength(0); // children pruned
    }
  });
});
