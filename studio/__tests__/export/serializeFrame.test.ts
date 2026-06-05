// studio/__tests__/export/serializeFrame.test.ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { serializeFrame, type DomReader } from "../../src/export/serializeFrame";
import { buildTokenIndex } from "../../src/export/tokenIndex";
import { isComponentNode, isElementNode } from "../../src/export/slj";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  return host.firstElementChild as HTMLElement;
}

// Minimal style every node reports; overridden per-node where needed.
const baseStyle: Record<string, string> = {
  display: "block", flexDirection: "row", columnGap: "0px", rowGap: "0px",
  paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px",
  alignItems: "stretch", marginLeft: "0px",
  backgroundColor: "rgba(0, 0, 0, 0)", borderTopLeftRadius: "0px",
  borderTopWidth: "0px", borderTopColor: "rgb(0, 0, 0)",
  color: "rgb(23, 23, 23)", fontFamily: "Inter", fontSize: "14px",
  fontWeight: "400", lineHeight: "20px",
};

function makeReader(overrides: Map<Element, Partial<Record<string, string>>>): DomReader {
  return {
    style: (node) => {
      const o = overrides.get(node) ?? {};
      const merged = { ...baseStyle, ...o };
      return { getPropertyValue: (p: string) => (merged as Record<string, string>)[p] ?? "" };
    },
    box: () => ({ x: 0, y: 0, width: 100, height: 40 }),
  };
}

describe("serializeFrame", () => {
  it("emits a component node for a stamped ChatBubble with its props + text child", () => {
    const bubble = el(
      `<div data-arcade-component="ChatBubble" data-arcade-source="arcade/components" ` +
      `data-arcade-props='{"variant":"receiver","tail":false}'>Hello there</div>`,
    );
    const overrides = new Map<Element, Partial<Record<string, string>>>([
      [bubble, { backgroundColor: "rgb(245, 245, 245)" }],
    ]);
    const tokenIndex = buildTokenIndex(["--bg-neutral-soft"], () => "rgb(245, 245, 245)");

    const root = serializeFrame(bubble, { reader: makeReader(overrides), tokenIndex });

    expect(isComponentNode(root)).toBe(true);
    if (!isComponentNode(root)) throw new Error("unreachable");
    expect(root.component).toBe("ChatBubble");
    expect(root.source).toBe("arcade/components");
    expect(root.props).toEqual({ variant: "receiver", tail: false });
    expect(root.children).toHaveLength(1);
    const child = root.children[0];
    expect(isElementNode(child)).toBe(true);
    if (!isElementNode(child)) throw new Error("unreachable");
    expect(child.tag).toBe("text");
    expect(child.style.characters).toBe("Hello there");
  });

  it("emits an element node (not component) for a plain div", () => {
    const div = el(`<div>plain</div>`);
    const root = serializeFrame(div, { reader: makeReader(new Map()), tokenIndex: new Map() });
    expect(isElementNode(root)).toBe(true);
  });
});
