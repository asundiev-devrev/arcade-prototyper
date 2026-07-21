// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeFingerprint, PAINT_PROPS } from "../../src/frame/renderFingerprint";
import type { MeasureFn, Measured } from "../../src/frame/renderFingerprint";

// Build a synthetic measure: geometry + paint come from a data-* JSON blob on
// each element, NOT from jsdom layout (which returns all-zero rects). This lets
// us test hash DISCRIMINATION deterministically without a real browser.
function fakeMeasure(overrides: Record<string, Partial<Measured>> = {}): MeasureFn {
  return (el: Element): Measured | null => {
    const id = el.getAttribute("data-id") ?? el.tagName.toLowerCase();
    const o = overrides[id] ?? {};
    const style: Record<string, string> = {};
    for (const p of PAINT_PROPS) style[p] = (o.style?.[p]) ?? "x";
    return {
      tag: el.tagName.toLowerCase(),
      rect: o.rect ?? { x: 0, y: 0, w: 10, h: 10 },
      style,
    };
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("computeFingerprint", () => {
  it("is stable: identical DOM + identical measure → identical hash", () => {
    const a = mount(`<div data-id="a"><span data-id="b">hi</span></div>`);
    const b = mount(`<div data-id="a"><span data-id="b">hi</span></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).toBe(computeFingerprint(b, m));
  });

  it("ignores textContent: same layout, DIFFERENT text → SAME hash (a ticking clock must not flip it)", () => {
    const a = mount(`<div data-id="a"><span data-id="b">12:00:00</span></div>`);
    const b = mount(`<div data-id="a"><span data-id="b">12:00:01</span></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).toBe(computeFingerprint(b, m));
  });

  it("flips on a geometry change (the orientation-swallow case inverse)", () => {
    const a = mount(`<div data-id="a"></div>`);
    const b = mount(`<div data-id="a"></div>`);
    const same = fakeMeasure();
    const moved = fakeMeasure({ a: { rect: { x: 0, y: 40, w: 10, h: 10 } } });
    expect(computeFingerprint(a, same)).not.toBe(computeFingerprint(b, moved));
  });

  it("flips on a paint change (color edit moves no boxes)", () => {
    const a = mount(`<div data-id="a"></div>`);
    const same = fakeMeasure();
    const recolored = fakeMeasure({ a: { style: { color: "red" } } });
    expect(computeFingerprint(a, same)).not.toBe(computeFingerprint(a, recolored));
  });

  it("is DOM-order sensitive (two siblings swapped → different hash)", () => {
    const a = mount(`<div data-id="p"><i data-id="x"></i><b data-id="y"></b></div>`);
    const b = mount(`<div data-id="p"><b data-id="y"></b><i data-id="x"></i></div>`);
    const m = fakeMeasure();
    expect(computeFingerprint(a, m)).not.toBe(computeFingerprint(b, m));
  });

  it("skips elements whose measure returns null (excluded chrome)", () => {
    const withChrome = mount(`<div data-id="a"></div><div data-id="overlay"></div>`);
    const without = mount(`<div data-id="a"></div>`);
    const m: MeasureFn = (el) =>
      el.getAttribute("data-id") === "overlay" ? null : fakeMeasure()(el);
    expect(computeFingerprint(withChrome, m)).toBe(computeFingerprint(without, m));
  });

  it("returns a non-empty string for an empty root", () => {
    const empty = mount(``);
    expect(typeof computeFingerprint(empty, fakeMeasure())).toBe("string");
  });
});
