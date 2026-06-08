// studio/__tests__/export/fiberWalk.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 10, height: 10 };
function host(tag: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  return chain({ type: tag, memoizedProps: props } as any, children);
}
function comp(name: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  const fn: any = function () {}; Object.defineProperty(fn, "name", { value: name });
  return chain({ type: fn, memoizedProps: props } as any, children);
}
function chain(node: any, children: MinimalFiber[]): MinimalFiber {
  node.child = children[0] ?? null; node.sibling = null;
  for (let i = 0; i < children.length - 1; i++) (children[i] as any).sibling = children[i + 1];
  return node;
}
const reader: FiberReader = {
  hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
  box: () => box,
  style: () => ({ getPropertyValue: (p) => (p === "display" ? "flex" : p === "flex-direction" ? "column" : p === "background-color" ? "rgba(0, 0, 0, 0)" : "0px") }),
  text: (f) => (f as any).__text ?? null,
};
const ctx: WalkCtx = {
  reader,
  isComponent: (n) => (n === "ChatBubble" ? "primitive" : n === "ComputerSidebar" ? "composite" : null),
  resolveColor: (v) => v,
  isSkippable: (n) => n === "MenuProvider" || n === "Root",
};

describe("walkFiber — host + text + skip", () => {
  it("emits an element node for a host div", () => {
    const root = host("div");
    const node = walkFiber(root, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
  });
  it("skips a skippable wrapper, descending to its child host", () => {
    const inner = host("section");
    const wrapper = comp("MenuProvider", [inner]);
    const node = walkFiber(wrapper, ctx);
    expect(isElementNode(node) && node.tag).toBe("section");
  });
  it("emits a text node for a fiber whose host carries text and no element children", () => {
    const t = host("span"); (t as any).__text = "Hello";
    const node = walkFiber(t, ctx);
    expect(isElementNode(node) && node.tag).toBe("text");
    if (isElementNode(node)) expect(node.style.characters).toBe("Hello");
  });
});
