// studio/__tests__/export/fiberWalk-hidden.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 10, height: 10 };
const zeroBox = { x: 0, y: 0, width: 0, height: 0 };

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

describe("walkFiber — hidden content (display:none, visibility:hidden, 0×0 box)", () => {
  it("drops a non-root fiber with 0×0 box AND absolute position", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: (f) => (f as any).__zeroBox ? zeroBox : box,
      style: (f) => ({
        getPropertyValue: (p: string) => {
          if (p === "position" && (f as any).__zeroBox) return "absolute";
          return "";
        },
      }),
      text: () => null,
      directText: () => null,
    };
    const ctx: WalkCtx = {
      reader, isComponent: () => null, resolveColor: (v) => v, isSkippable: () => false, iconNameFor: () => null,
    };

    const visible = host("span");
    const invisible = host("span");
    (invisible as any).__zeroBox = true;
    const parent = host("div", [visible, invisible]);

    const node = walkFiber(parent, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
    expect(node.children).toHaveLength(1);
  });

  it("drops a fiber with display:none", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: (f) => ({
        getPropertyValue: (p: string) => {
          if (p === "display" && (f as any).__displayNone) return "none";
          return "";
        },
      }),
      text: () => null,
      directText: () => null,
    };
    const ctx: WalkCtx = {
      reader, isComponent: () => null, resolveColor: (v) => v, isSkippable: () => false, iconNameFor: () => null,
    };

    const visible = host("span");
    const hidden = host("span");
    (hidden as any).__displayNone = true;
    const parent = host("div", [visible, hidden]);

    const node = walkFiber(parent, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
    expect(node.children).toHaveLength(1);
  });

  it("drops a fiber with visibility:hidden", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: (f) => ({
        getPropertyValue: (p: string) => {
          if (p === "visibility" && (f as any).__visibilityHidden) return "hidden";
          return "";
        },
      }),
      text: () => null,
      directText: () => null,
    };
    const ctx: WalkCtx = {
      reader, isComponent: () => null, resolveColor: (v) => v, isSkippable: () => false, iconNameFor: () => null,
    };

    const visible = host("span");
    const hidden = host("span");
    (hidden as any).__visibilityHidden = true;
    const parent = host("div", [visible, hidden]);

    const node = walkFiber(parent, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
    expect(node.children).toHaveLength(1);
  });

  it("never drops root even with 0×0 box", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => zeroBox,
      style: () => ({ getPropertyValue: () => "" }),
      text: () => null,
      directText: () => null,
    };
    const ctx: WalkCtx = {
      reader, isComponent: () => null, resolveColor: (v) => v, isSkippable: () => false, iconNameFor: () => null,
    };

    const root = host("div");
    const node = walkFiber(root, ctx);
    expect(node).not.toBeNull();
    expect(isElementNode(node) && node.tag).toBe("div");
  });

  it("drops a hidden mapped primitive (Button with display:none)", () => {
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: (f) => ({
        getPropertyValue: (p: string) => {
          if (p === "display" && (f as any).__displayNone) return "none";
          return "";
        },
      }),
      text: () => null,
      directText: () => null,
    };
    const ctx: WalkCtx = {
      reader, isComponent: (n) => (n === "Button" ? "primitive" : null), resolveColor: (v) => v, isSkippable: () => false, iconNameFor: () => null,
    };

    const visible = comp("Button");
    const hidden = comp("Button");
    (hidden as any).__displayNone = true;
    const parent = host("div", [visible, hidden]);

    const node = walkFiber(parent, ctx);
    expect(isElementNode(node) && node.tag).toBe("div");
    expect(node.children).toHaveLength(1);
  });
});
