// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readBindPath } from "../../src/frame/bindRead";

describe("readBindPath", () => {
  it("reads the bind off the clicked node", () => {
    const el = document.createElement("span");
    el.setAttribute("data-arcade-bind", "transcript[id=2].text");
    expect(readBindPath(el)).toBe("transcript[id=2].text");
  });
  it("reads the bind off an ancestor", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-arcade-bind", "transcript[id=3].text");
    const inner = document.createElement("b");
    outer.appendChild(inner);
    expect(readBindPath(inner)).toBe("transcript[id=3].text");
  });
  it("returns null when no bind ancestor", () => {
    expect(readBindPath(document.createElement("p"))).toBeNull();
  });
});
