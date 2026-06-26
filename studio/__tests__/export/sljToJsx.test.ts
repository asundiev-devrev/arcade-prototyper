import { describe, it, expect } from "vitest";
import { sljToJsx, collectKitComponents } from "../../src/export/sljToJsx";
import type { SljNode } from "../../src/export/slj";

const box = { x: 0, y: 0, width: 0, height: 0 };
const textNode = (s: string): SljNode => ({ kind: "element", tag: "text", box, layout: null, style: { characters: s }, children: [] });

describe("sljToJsx", () => {
  it("prints a host element with className and a text child", () => {
    const node: SljNode = { kind: "element", tag: "div", className: "flex p-4", box, layout: null, style: {}, children: [textNode("Hi")] };
    expect(sljToJsx(node)).toBe(`<div className="flex p-4">Hi</div>`);
  });
  it("prints a host element with no className", () => {
    const node: SljNode = { kind: "element", tag: "span", box, layout: null, style: {}, children: [textNode("x")] };
    expect(sljToJsx(node)).toBe(`<span>x</span>`);
  });
  it("prints a kit component node with scalar props", () => {
    const node: SljNode = { kind: "component", component: "Button", source: "arcade/components", props: { variant: "primary", disabled: true, count: 3 }, box, layout: null, children: [textNode("Go")] };
    expect(sljToJsx(node)).toBe(`<Button variant="primary" disabled count={3}>Go</Button>`);
  });
  it("self-closes a childless component", () => {
    const node: SljNode = { kind: "component", component: "Icon", source: "arcade/components", props: { name: "Trash" }, box, layout: null, children: [] };
    expect(sljToJsx(node)).toBe(`<Icon name="Trash" />`);
  });
  it("escapes braces/quotes in text and attribute values", () => {
    const node: SljNode = { kind: "element", tag: "div", className: "x", box, layout: null, style: {}, children: [textNode("a{b}c")] };
    // braces in JSX text must be escaped to render literally
    expect(sljToJsx(node)).toBe(`<div className="x">a{"{"}b{"}"}c</div>`);
  });
  it("nests children with structure", () => {
    const inner: SljNode = { kind: "element", tag: "span", className: "label", box, layout: null, style: {}, children: [textNode("hi")] };
    const node: SljNode = { kind: "element", tag: "div", className: "wrap", box, layout: null, style: {}, children: [inner] };
    expect(sljToJsx(node)).toContain(`<div className="wrap">`);
    expect(sljToJsx(node)).toContain(`<span className="label">hi</span>`);
  });
});

describe("collectKitComponents", () => {
  it("lists distinct component names in the tree", () => {
    const node: SljNode = { kind: "element", tag: "div", box, layout: null, style: {}, children: [
      { kind: "component", component: "Button", source: "arcade/components", props: {}, box, layout: null, children: [] },
      { kind: "component", component: "Icon", source: "arcade/components", props: {}, box, layout: null, children: [] },
      { kind: "component", component: "Button", source: "arcade/components", props: {}, box, layout: null, children: [] },
    ] };
    expect(collectKitComponents(node).sort()).toEqual(["Button", "Icon"]);
  });
});
