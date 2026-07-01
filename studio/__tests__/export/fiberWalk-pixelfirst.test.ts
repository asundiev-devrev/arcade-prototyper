// studio/__tests__/export/fiberWalk-pixelfirst.test.ts
// @vitest-environment node
// Tests for pixel-first fiberWalk additions: overflow→clip, box-shadow→shadow,
// opacity capture, img→imageData leaf.
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

// Configurable style map per fiber
type StyleMap = Record<string, string>;
function makeReader(overrides?: { styles?: Map<MinimalFiber, StyleMap>; imageData?: Map<MinimalFiber, string | null> }): FiberReader {
  const styles = overrides?.styles ?? new Map();
  const imageDataMap = overrides?.imageData ?? new Map();
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
          return "0px";
        },
      };
    },
    text: (f) => (f as any).__text ?? null,
    directText: () => null,
    svgMarkup: () => null,
    imageData: (f) => imageDataMap.get(f) ?? null,
  };
}

const baseCtx = (reader: FiberReader): WalkCtx => ({
  reader,
  isComponent: () => null,
  resolveColor: (v) => v,
  isSkippable: () => false,
  iconNameFor: () => null,
});

describe("fiberWalk — overflow → clip:true", () => {
  it("emits clip:true when overflow is hidden", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { overflow: "hidden" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBe(true);
  });

  it("emits clip:true when overflow-y is auto (scroll container)", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { "overflow-y": "auto" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBe(true);
  });

  it("emits clip:true when overflow-x is scroll", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { "overflow-x": "scroll" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBe(true);
  });

  it("emits clip:true when overflow is clip", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { overflow: "clip" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBe(true);
  });

  it("does NOT emit clip when overflow is visible", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { overflow: "visible" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBeUndefined();
  });

  it("does NOT emit clip when overflow not set (defaults)", () => {
    const div = host("div");
    const reader = makeReader();
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.clip).toBeUndefined();
  });
});

describe("fiberWalk — box-shadow → shadow", () => {
  it("parses computed box-shadow into shadow object", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "box-shadow": "rgba(0, 0, 0, 0.1) 0px 4px 12px 0px",
    }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.shadow).toEqual({
      color: "rgba(0, 0, 0, 0.1)",
      x: 0, y: 4, blur: 12, spread: 0,
    });
  });

  it("parses box-shadow without spread (3-value)", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, {
      "box-shadow": "rgba(0, 0, 0, 0.25) 2px 3px 8px",
    }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.shadow).toEqual({
      color: "rgba(0, 0, 0, 0.25)",
      x: 2, y: 3, blur: 8, spread: 0,
    });
  });

  it("does NOT emit shadow when box-shadow is none", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { "box-shadow": "none" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.shadow).toBeUndefined();
  });

  it("does NOT emit shadow when box-shadow is empty", () => {
    const div = host("div");
    const reader = makeReader();
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.shadow).toBeUndefined();
  });
});

describe("fiberWalk — opacity capture", () => {
  it("captures opacity < 1", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { opacity: "0.5" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.opacity).toBe(0.5);
  });

  it("does NOT emit opacity when 1 (default)", () => {
    const div = host("div");
    const styles = new Map<MinimalFiber, StyleMap>([[div, { opacity: "1" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.opacity).toBeUndefined();
  });

  it("does NOT emit opacity when not set (defaults to 1)", () => {
    const div = host("div");
    // Real computed style returns "1" for opacity by default
    const styles = new Map<MinimalFiber, StyleMap>([[div, { opacity: "1" }]]);
    const reader = makeReader({ styles });
    const node = walkFiber(div, baseCtx(reader));
    expect(isElementNode(node) && node.style.opacity).toBeUndefined();
  });
});

describe("fiberWalk — img element → imageData leaf", () => {
  it("emits element leaf with imageData when reader provides it", () => {
    const img = host("img");
    const imageDataMap = new Map<MinimalFiber, string | null>([[img, "iVBORw0KGgoAAAANS..."]]);
    const reader = makeReader({ imageData: imageDataMap });
    const node = walkFiber(img, baseCtx(reader));
    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.tag).toBe("img");
      expect(node.style.imageData).toBe("iVBORw0KGgoAAAANS...");
      expect(node.children).toHaveLength(0);
    }
  });

  it("emits img as plain frame (no imageData) when reader returns null", () => {
    const img = host("img");
    const reader = makeReader();
    const node = walkFiber(img, baseCtx(reader));
    expect(isElementNode(node)).toBe(true);
    if (isElementNode(node)) {
      expect(node.tag).toBe("img");
      expect(node.style.imageData).toBeUndefined();
    }
  });

  it("img with imageData has no children (leaf node, prunes subtree)", () => {
    // An img tag might have alt text children in fiber — imageData should prune
    const child = host("span");
    (child as any).__text = "alt text";
    const img = host("img", [child]);
    const imageDataMap = new Map<MinimalFiber, string | null>([[img, "base64data"]]);
    const reader = makeReader({ imageData: imageDataMap });
    const node = walkFiber(img, baseCtx(reader));
    if (isElementNode(node)) {
      expect(node.children).toHaveLength(0);
    }
  });
});

describe("fiberWalk — svg still works (regression)", () => {
  it("emits svg leaf with markup when host is svg element", () => {
    const svg = host("svg");
    const reader: FiberReader = {
      hostTag: (f) => (typeof (f as any).type === "string" ? (f as any).type : null),
      hostClassName: () => null,
      box: () => box,
      style: () => ({ getPropertyValue: () => "" }),
      text: () => null,
      directText: () => null,
      svgMarkup: () => '<svg><path d="M0 0"/></svg>',
      imageData: () => null,
    };
    const node = walkFiber(svg, baseCtx(reader));
    expect(isElementNode(node) && node.tag).toBe("svg");
    if (isElementNode(node)) {
      expect(node.style.svg).toBe('<svg><path d="M0 0"/></svg>');
    }
  });
});
