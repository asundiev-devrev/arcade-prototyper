// studio/__tests__/export/fiberWalk-borders.test.ts
// @vitest-environment node
// Bug 1: borders were captured (border-top only) then dropped; per-corner radius
// only read top-left. Drive per-side border capture + per-corner radius.
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 100, height: 100 };
function host(tag: string, children: MinimalFiber[] = [], props = {}): MinimalFiber {
  return chain({ type: tag, memoizedProps: props } as any, children);
}
function chain(node: any, children: MinimalFiber[]): MinimalFiber {
  node.child = children[0] ?? null; node.sibling = null;
  for (let i = 0; i < children.length - 1; i++) (children[i] as any).sibling = children[i + 1];
  return node;
}

type StyleMap = Record<string, string>;
function makeReader(styles: Map<MinimalFiber, StyleMap>): FiberReader {
  return {
    hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
    hostClassName: () => null,
    box: () => box,
    style: (f) => {
      const m = styles.get(f) ?? {};
      return {
        getPropertyValue: (p: string) => {
          if (m[p] !== undefined) return m[p];
          if (p === "display") return "flex";
          if (p === "flex-direction") return "column";
          if (p === "background-color") return "rgba(0, 0, 0, 0)";
          // border widths default to 0, styles to "none"
          if (/^border-.*-style$/.test(p)) return "none";
          return "0px";
        },
      };
    },
    text: (f) => (f as any).__text ?? null,
    directText: () => null,
    svgMarkup: () => null,
    imageData: () => null,
  };
}

const baseCtx = (reader: FiberReader): WalkCtx => ({
  reader,
  isComponent: () => null,
  resolveColor: (v) => v,
  isSkippable: () => false,
  iconNameFor: () => null,
});

describe("fiberWalk — per-side borders", () => {
  it("captures border-bottom only (a divider): borders.bottom set, others absent", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-bottom-width": "1px",
      "border-bottom-style": "solid",
      "border-bottom-color": "rgb(230, 230, 230)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.style.borders).toBeDefined();
      expect(node.style.borders!.bottom).toEqual({ color: "rgb(230, 230, 230)", width: 1 });
      expect(node.style.borders!.top).toBeUndefined();
      expect(node.style.borders!.left).toBeUndefined();
      expect(node.style.borders!.right).toBeUndefined();
    }
  });

  it("captures a uniform border on all four sides", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-top-width": "1px", "border-top-style": "solid", "border-top-color": "rgb(10, 10, 10)",
      "border-right-width": "1px", "border-right-style": "solid", "border-right-color": "rgb(10, 10, 10)",
      "border-bottom-width": "1px", "border-bottom-style": "solid", "border-bottom-color": "rgb(10, 10, 10)",
      "border-left-width": "1px", "border-left-style": "solid", "border-left-color": "rgb(10, 10, 10)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.borders).toBeDefined();
      expect(node.style.borders!.top).toEqual({ color: "rgb(10, 10, 10)", width: 1 });
      expect(node.style.borders!.right).toEqual({ color: "rgb(10, 10, 10)", width: 1 });
      expect(node.style.borders!.bottom).toEqual({ color: "rgb(10, 10, 10)", width: 1 });
      expect(node.style.borders!.left).toEqual({ color: "rgb(10, 10, 10)", width: 1 });
    }
  });

  it("skips a side whose border-style is none even if width > 0", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-top-width": "3px", "border-top-style": "none", "border-top-color": "rgb(1, 2, 3)",
      "border-bottom-width": "2px", "border-bottom-style": "solid", "border-bottom-color": "rgb(4, 5, 6)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.borders).toBeDefined();
      expect(node.style.borders!.top).toBeUndefined();
      expect(node.style.borders!.bottom).toEqual({ color: "rgb(4, 5, 6)", width: 2 });
    }
  });

  it("skips a side whose border-style is hidden", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-left-width": "3px", "border-left-style": "hidden", "border-left-color": "rgb(1, 2, 3)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.borders).toBeUndefined();
    }
  });

  it("emits no borders when there are no visible borders", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {}]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.borders).toBeUndefined();
    }
  });
});

describe("fiberWalk — per-corner radius", () => {
  it("emits cornerRadius when all four corners are equal", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.cornerRadius).toBe(8);
      expect(node.style.corners).toBeUndefined();
    }
  });

  it("emits a corners map when corners differ", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "border-top-left-radius": "12px",
      "border-top-right-radius": "12px",
      "border-bottom-right-radius": "0px",
      "border-bottom-left-radius": "0px",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.corners).toEqual({ tl: 12, tr: 12, br: 0, bl: 0 });
      // cornerRadius should NOT be set (they differ)
      expect(node.style.cornerRadius).toBeUndefined();
    }
  });

  it("emits nothing when all corners are 0", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {}]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.cornerRadius).toBeUndefined();
      expect(node.style.corners).toBeUndefined();
    }
  });
});
