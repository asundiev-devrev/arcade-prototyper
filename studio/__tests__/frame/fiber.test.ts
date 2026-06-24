// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getFiberFromNode, componentNameOf } from "../../src/frame/fiber";

function stampFiber(el: Element, fiber: any) {
  (el as any).__reactFiber$abc = fiber;
}

describe("getFiberFromNode", () => {
  it("returns the fiber stamped under a __reactFiber$ key", () => {
    const el = document.createElement("div");
    const f = { type: "div" };
    stampFiber(el, f);
    expect(getFiberFromNode(el)).toBe(f);
  });
  it("returns null when no fiber key present", () => {
    expect(getFiberFromNode(document.createElement("div"))).toBeNull();
  });
});

describe("componentNameOf", () => {
  it("reads the component name from the node's own fiber type (function component)", () => {
    const el = document.createElement("svg");
    function Bell() { return null; }
    stampFiber(el, { type: Bell });
    expect(componentNameOf(el)).toBe("Bell");
  });
  it("falls back to _debugOwner's type name", () => {
    const el = document.createElement("svg");
    function Star() { return null; }
    stampFiber(el, { type: "svg", _debugOwner: { type: Star } });
    expect(componentNameOf(el)).toBe("Star");
  });
  it("returns null when no name resolvable", () => {
    const el = document.createElement("div");
    stampFiber(el, { type: "div" });
    expect(componentNameOf(el)).toBeNull();
  });
});
