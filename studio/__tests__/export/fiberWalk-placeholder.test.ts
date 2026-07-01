// studio/__tests__/export/fiberWalk-placeholder.test.ts
// @vitest-environment node
// Bug 3: input/textarea placeholder is an attribute, not textContent, so the
// composer rendered empty. Drive a placeholder text leaf.
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 240, height: 40 };
function host(tag: string, props = {}): MinimalFiber {
  return { type: tag, memoizedProps: props, child: null, sibling: null } as any;
}

type StyleMap = Record<string, string>;
function makeReader(styles: Map<MinimalFiber, StyleMap>, placeholders: Map<MinimalFiber, string | null>): FiberReader {
  return {
    hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
    hostClassName: () => null,
    box: () => box,
    placeholder: (f) => placeholders.get(f) ?? null,
    style: (f) => {
      const m = styles.get(f) ?? {};
      return {
        getPropertyValue: (p: string) => {
          if (m[p] !== undefined) return m[p];
          if (p === "display") return "block";
          if (p === "background-color") return "rgba(0, 0, 0, 0)";
          if (p === "color") return "rgb(120, 120, 120)";
          if (p === "font-size") return "14px";
          if (/^border-.*-style$/.test(p)) return "none";
          return "0px";
        },
      };
    },
    text: () => null,
    directText: () => null,
    svgMarkup: () => null,
    imageData: () => null,
  } as FiberReader;
}

const baseCtx = (reader: FiberReader): WalkCtx => ({
  reader,
  isComponent: () => null,
  resolveColor: (v) => v,
  isSkippable: () => false,
  iconNameFor: () => null,
});

describe("fiberWalk — input/textarea placeholder text", () => {
  it("emits a text leaf child carrying the input placeholder", () => {
    const input = host("input");
    const styles = new Map<MinimalFiber, StyleMap>([[input, { color: "rgb(120, 120, 120)", "font-size": "15px" }]]);
    const placeholders = new Map<MinimalFiber, string | null>([[input, "Ask me anything"]]);
    const node = walkFiber(input, baseCtx(makeReader(styles, placeholders)));
    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      // the input frame has a single text child = the placeholder
      const text = node.children.find((c) => isElementNode(c) && c.tag === "text");
      expect(text).toBeDefined();
      if (text && isElementNode(text)) {
        expect(text.style.characters).toBe("Ask me anything");
        expect(text.style.fontSize).toBe(15);
      }
    }
  });

  it("emits placeholder text for a textarea", () => {
    const ta = host("textarea");
    const styles = new Map<MinimalFiber, StyleMap>([[ta, {}]]);
    const placeholders = new Map<MinimalFiber, string | null>([[ta, "Type a message…"]]);
    const node = walkFiber(ta, baseCtx(makeReader(styles, placeholders)));
    if (isElementNode(node)) {
      const text = node.children.find((c) => isElementNode(c) && c.tag === "text");
      expect(text && isElementNode(text) && text.style.characters).toBe("Type a message…");
    }
  });

  it("does NOT emit a text leaf when the input has no placeholder", () => {
    const input = host("input");
    const styles = new Map<MinimalFiber, StyleMap>([[input, {}]]);
    const placeholders = new Map<MinimalFiber, string | null>([[input, null]]);
    const node = walkFiber(input, baseCtx(makeReader(styles, placeholders)));
    if (isElementNode(node)) {
      expect(node.children.some((c) => isElementNode(c) && c.tag === "text")).toBe(false);
    }
  });

  it("does NOT add a placeholder leaf to a non-input element", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {}]]);
    const placeholders = new Map<MinimalFiber, string | null>([[div, "should be ignored"]]);
    const node = walkFiber(div, baseCtx(makeReader(styles, placeholders)));
    if (isElementNode(node)) {
      expect(node.children).toHaveLength(0);
    }
  });
});
