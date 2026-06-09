// studio/__tests__/export/figma/swapOps.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { flattenManifest, type ManifestComponent } from "../../../src/export/figma/swapOps";
import type { SljDocument } from "../../../src/export/slj";

const slj: SljDocument = {
  slj: 1,
  frame: { slug: "f", project: "p", width: 1280, mode: "light" },
  root: {
    kind: "element", tag: "div", box: { x: 0, y: 0, width: 1280, height: 631 },
    layout: null, style: {}, children: [
      {
        kind: "component", component: "ComputerSidebar.Item", source: "arcade-prototypes",
        props: {}, box: { x: 8, y: 148, width: 239, height: 36 }, layout: null,
        children: [{ kind: "element", tag: "text", box: { x: 8, y: 148, width: 200, height: 16 }, layout: null, style: { characters: "Remove council reference" }, children: [] }],
      },
      {
        kind: "component", component: "ChatBubble", source: "arcade/components",
        props: { variant: "receiver" }, box: { x: 272, y: 64, width: 400, height: 409 }, layout: null,
        children: [{ kind: "element", tag: "text", box: { x: 272, y: 64, width: 380, height: 380 }, layout: null, style: { characters: "Hello there" }, children: [] }],
      },
    ],
  },
};

describe("flattenManifest", () => {
  it("flattens every ComponentNode with name, box, props, and first text", () => {
    const m = flattenManifest(slj);
    expect(m).toHaveLength(2);
    const item = m.find((c) => c.component === "ComputerSidebar.Item")!;
    expect(item.box).toEqual({ x: 8, y: 148, width: 239, height: 36 });
    expect(item.text).toBe("Remove council reference");
    const bubble = m.find((c) => c.component === "ChatBubble")!;
    expect(bubble.props.variant).toBe("receiver");
    expect(bubble.text).toBe("Hello there");
  });

  it("does NOT descend into a component's children for more components (prune-with-text already applied upstream)", () => {
    const nested: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "ChatBubble", source: "arcade/components", props: {},
        box: { x: 0, y: 0, width: 10, height: 10 }, layout: null,
        children: [{ kind: "component", component: "Button", source: "arcade/components", props: {}, box: { x: 1, y: 1, width: 2, height: 2 }, layout: null, children: [] }],
      },
    };
    const m = flattenManifest(nested);
    expect(m.map((c) => c.component)).toEqual(["ChatBubble"]);
  });
});

describe("flattenManifest — icon", () => {
  it("carries the ComponentNode.icon onto the manifest entry", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "IconButton", source: "arcade/components",
        props: { variant: "tertiary" }, box: { x: 0, y: 0, width: 20, height: 20 },
        layout: null, children: [], icon: "ChevronLeftSmall",
      },
    };
    const m = flattenManifest(slj);
    expect(m).toHaveLength(1);
    expect(m[0].icon).toBe("ChevronLeftSmall");
  });

  it("leaves icon undefined when the node has none", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: {
        kind: "component", component: "ChatBubble", source: "arcade/components",
        props: {}, box: { x: 0, y: 0, width: 10, height: 10 }, layout: null, children: [],
      },
    };
    expect(flattenManifest(slj)[0].icon).toBeUndefined();
  });
});
