// studio/__tests__/export/fiberWalk-classname.test.ts
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

// Minimal fake: one host <div class="flex p-4"> with a text child.
const textFiber: MinimalFiber = { type: null, child: null, sibling: null, memoizedProps: null };
const divFiber: MinimalFiber = { type: "div", child: textFiber, sibling: null, memoizedProps: null };

function reader(): FiberReader {
  return {
    hostTag: (f) => (f === divFiber ? "div" : null),
    hostClassName: (f) => (f === divFiber ? "flex p-4" : null),
    box: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    style: () => ({ getPropertyValue: () => "" }),
    text: (f) => (f === textFiber ? "Hi" : null),
  };
}
const ctx = (): WalkCtx => ({
  reader: reader(),
  isComponent: () => "composite",
  resolveColor: (v) => v,
  isSkippable: () => false,
  iconNameFor: () => null,
});

describe("fiber walk className capture", () => {
  it("puts the host className on the element node", () => {
    const root = walkFiber(divFiber, ctx());
    expect(isElementNode(root)).toBe(true);
    if (isElementNode(root)) expect(root.className).toBe("flex p-4");
  });
});
