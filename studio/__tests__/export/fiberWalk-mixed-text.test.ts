// studio/__tests__/export/fiberWalk-mixed-text.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import type { Box } from "../../src/export/slj";

// Fake fiber: div with one span child (element) AND direct text via reader.directText
function host(tag: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  return chain({ type: tag, memoizedProps: props } as any, children);
}
function chain(node: any, children: MinimalFiber[]): MinimalFiber {
  node.child = children[0] ?? null;
  node.sibling = null;
  for (let i = 0; i < children.length - 1; i++) (children[i] as any).sibling = children[i + 1];
  return node;
}

describe("fiberWalk captures direct text in mixed text+element nodes", () => {
  it("prepends a text leaf for direct text when element has both text and element children", () => {
    const spanChild = host("span");
    (spanChild as any).__text = "next meeting.";
    const div = host("div", [spanChild]);

    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: (f) =>
        f === div
          ? { x: 10, y: 10, width: 300, height: 60 }
          : { x: 150, y: 20, width: 100, height: 30 },
      style: (f) => ({
        getPropertyValue: (p: string) => {
          if (p === "display") return "flex";
          if (p === "flex-direction") return "row";
          if (p === "background-color") return "transparent";
          if (p === "color") return "rgb(20, 22, 26)";
          if (p === "font-size") return "14px";
          if (p === "font-weight") return "400";
          if (p === "font-family") return "Inter, sans-serif";
          if (p === "line-height") return "20px";
          return "0px";
        },
      }),
      text: (f) => (f as any).__text ?? null,
      directText: (f) => {
        if (f === div) {
          return {
            text: "Let's prepare for your",
            box: { x: 15, y: 15, width: 120, height: 20 },
          };
        }
        return null;
      },
    };

    const ctx: WalkCtx = {
      reader,
      isComponent: () => null,
      resolveColor: (v) => v,
      isSkippable: () => false,
      iconNameFor: () => null,
    };

    const node = walkFiber(div, ctx);
    expect(node.kind).toBe("element");
    if (node.kind !== "element") return;

    // Should have 2 children: direct text leaf + span child
    expect(node.children).toHaveLength(2);

    // First child: direct text
    const first = node.children[0];
    expect(first.kind).toBe("element");
    if (first.kind !== "element") return;
    expect(first.tag).toBe("text");
    expect(first.style.characters).toBe("Let's prepare for your");
    expect(first.box).toEqual({ x: 15, y: 15, width: 120, height: 20 });
    expect(first.style.color).toBe("rgb(20, 22, 26)");
    expect(first.style.fontSize).toBe(14);

    // Second child: the span
    const second = node.children[1];
    expect(second.kind).toBe("element");
    if (second.kind !== "element") return;
    expect(second.tag).toBe("text"); // It's a text leaf since span has text + no children
    expect(second.style.characters).toBe("next meeting.");
  });

  it("does not prepend a text leaf when directText returns null", () => {
    const spanChild = host("span");
    (spanChild as any).__text = "only child text";
    const div = host("div", [spanChild]);

    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      style: () => ({
        getPropertyValue: () => "0px",
      }),
      text: (f) => (f as any).__text ?? null,
      directText: () => null, // No direct text
    };

    const ctx: WalkCtx = {
      reader,
      isComponent: () => null,
      resolveColor: (v) => v,
      isSkippable: () => false,
      iconNameFor: () => null,
    };

    const node = walkFiber(div, ctx);
    expect(node.kind).toBe("element");
    if (node.kind !== "element") return;

    // Should have only 1 child: the span
    expect(node.children).toHaveLength(1);
    expect(node.children[0].kind).toBe("element");
    if (node.children[0].kind === "element") {
      expect(node.children[0].tag).toBe("text");
      expect(node.children[0].style.characters).toBe("only child text");
    }
  });
});
