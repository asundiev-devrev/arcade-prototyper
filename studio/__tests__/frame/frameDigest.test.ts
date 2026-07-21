// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { digestElements, isDigestCandidate, DIGEST_ELEMENT_CAP } from "../../src/frame/frameDigest";
import type { MeasureFn, Measured } from "../../src/frame/renderFingerprint";
import { PAINT_PROPS } from "../../src/frame/renderFingerprint";

// Synthetic measure: styles come from a data-styles JSON attr, else defaults.
// (jsdom returns zero rects + stub styles, so injected measure is the only way
// to test discrimination — same pattern as renderFingerprint.test.ts.)
function fakeMeasure(styleById: Record<string, Record<string, string>> = {}): MeasureFn {
  return (el: Element): Measured | null => {
    const id = el.getAttribute("data-id") ?? el.tagName.toLowerCase();
    const style: Record<string, string> = {};
    for (const p of PAINT_PROPS) style[p] = styleById[id]?.[p] ?? "x";
    return { tag: el.tagName.toLowerCase(), rect: { x: 0, y: 0, w: 10, h: 10 }, style };
  };
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("isDigestCandidate", () => {
  it("includes a data-orientation carrier", () => {
    const el = mount(`<div data-orientation="vertical"></div>`).firstElementChild!;
    expect(isDigestCandidate(el)).toBe(true);
  });
  it("includes a button", () => {
    expect(isDigestCandidate(mount(`<button></button>`).firstElementChild!)).toBe(true);
  });
  it("excludes a bare wrapper div with no role", () => {
    expect(isDigestCandidate(mount(`<div></div>`).firstElementChild!)).toBe(false);
  });
});

describe("digestElements", () => {
  it("captures the data-orientation attr AND the computed flexDirection (they can disagree — the swallow)", () => {
    const root = mount(`<div data-orientation="vertical" data-id="tg"></div>`);
    const d = digestElements(root, fakeMeasure({ tg: { flexDirection: "row" } }));
    const carrier = d.elements.find((e) => e.dataOrientation === "vertical");
    expect(carrier).toBeTruthy();
    expect(carrier!.styles.flexDirection).toBe("row"); // says vertical, IS row
  });

  it("captures role", () => {
    const root = mount(`<div role="tablist" data-id="t"></div>`);
    const d = digestElements(root, fakeMeasure());
    // a div with a role is a candidate
    expect(d.elements.some((e) => e.role === "tablist")).toBe(true);
  });

  it("skips non-candidate wrappers but recurses into them", () => {
    const root = mount(`<div><div data-orientation="horizontal" data-id="tg"></div></div>`);
    const d = digestElements(root, fakeMeasure());
    expect(d.elements.some((e) => e.dataOrientation === "horizontal")).toBe(true);
    // the bare outer wrapper is not itself a measured element
    expect(d.elements.every((e) => e.dataOrientation !== null || e.role !== null || e.tag !== "div")).toBe(true);
  });

  it("caps the element count and flags truncated", () => {
    const many = Array.from({ length: DIGEST_ELEMENT_CAP + 10 }, () => `<button></button>`).join("");
    const d = digestElements(mount(many), fakeMeasure(), DIGEST_ELEMENT_CAP);
    expect(d.elements.length).toBe(DIGEST_ELEMENT_CAP);
    expect(d.truncated).toBe(true);
  });

  it("returns [] on an empty root", () => {
    expect(digestElements(mount(``), fakeMeasure()).elements).toEqual([]);
  });
});
