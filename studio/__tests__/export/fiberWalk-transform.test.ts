// studio/__tests__/export/fiberWalk-transform.test.ts
// @vitest-environment node
// Bug 2: CSS transform rotate was dropped, so rotated illustration cards render
// flat. Drive rotation-degree capture from the computed transform matrix.
import { describe, it, expect } from "vitest";
import { walkFiber, type WalkCtx } from "../../src/export/fiberWalk";
import type { MinimalFiber, FiberReader } from "../../src/export/fiberTypes";
import { isElementNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 100, height: 60 };
function host(tag: string, props = {}): MinimalFiber {
  const node: any = { type: tag, memoizedProps: props, child: null, sibling: null };
  return node;
}

type StyleMap = Record<string, string>;
function makeReader(styles: Map<MinimalFiber, StyleMap>, unrotated?: Map<MinimalFiber, { width: number; height: number }>): FiberReader {
  return {
    hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
    hostClassName: () => null,
    box: () => box,
    unrotatedSize: (f) => unrotated?.get(f) ?? null,
    style: (f) => {
      const m = styles.get(f) ?? {};
      return {
        getPropertyValue: (p: string) => {
          if (m[p] !== undefined) return m[p];
          if (p === "display") return "block";
          if (p === "background-color") return "rgba(0, 0, 0, 0)";
          if (p === "transform") return "none";
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

describe("fiberWalk — CSS rotation capture", () => {
  it("decodes a rotate matrix into rotation degrees (positive, CCW-ideal)", () => {
    // matrix(cos, sin, -sin, cos, 0, 0) for ~6deg: cos=0.9945, sin=0.1045
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      transform: "matrix(0.9945, 0.1045, -0.1045, 0.9945, 0, 0)",
    }]]);
    const unrotated = new Map([[div, { width: 100, height: 60 }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles, unrotated)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeDefined();
      expect(node.style.rotation).toBeCloseTo(6, 0);
    }
  });

  it("captures a negative rotation (clockwise)", () => {
    // -6deg: cos=0.9945, sin=-0.1045
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      transform: "matrix(0.9945, -0.1045, 0.1045, 0.9945, 0, 0)",
    }]]);
    const unrotated = new Map([[div, { width: 100, height: 60 }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles, unrotated)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeCloseTo(-6, 0);
    }
  });

  it("does NOT emit rotation for transform:none", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { transform: "none" }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeUndefined();
    }
  });

  it("does NOT emit rotation for a pure translate matrix (no angle)", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      transform: "matrix(1, 0, 0, 1, 20, 40)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeUndefined();
    }
  });

  it("does NOT emit rotation for sub-threshold angle (< 0.1deg)", () => {
    // 0.05deg → sin ≈ 0.00087
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      transform: "matrix(1, 0.00087, -0.00087, 1, 0, 0)",
    }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeUndefined();
    }
  });

  it("captures the un-rotated size alongside rotation so the runtime can place it", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      transform: "matrix(0.9945, 0.1045, -0.1045, 0.9945, 0, 0)",
    }]]);
    const unrotated = new Map([[div, { width: 120, height: 80 }]]);
    const node = walkFiber(div, baseCtx(makeReader(styles, unrotated)));
    if (isElementNode(node)) {
      expect(node.style.rotation).toBeCloseTo(6, 0);
      expect(node.box.width).toBe(120);
      expect(node.box.height).toBe(80);
    }
  });
});
