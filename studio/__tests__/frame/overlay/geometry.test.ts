// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getElementRect, hexToRgba, Z_INDEX } from "../../../src/frame/overlay/geometry";

describe("getElementRect", () => {
  it("returns viewport coords (no scroll offset added)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // jsdom getBoundingClientRect is all-zero by default; stub it.
    el.getBoundingClientRect = () =>
      ({ top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120, x: 20, y: 10, toJSON() {} }) as DOMRect;
    // even with a scrolled window, the rect must NOT add scrollX/Y
    Object.defineProperty(window, "scrollX", { value: 999, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 999, configurable: true });
    const r = getElementRect(el);
    expect(r).toEqual({ top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120 });
  });
});

describe("hexToRgba", () => {
  it("converts 6-digit hex to rgba", () => {
    expect(hexToRgba("#4F9EFF", 0.06)).toBe("rgba(79, 158, 255, 0.06)");
    expect(hexToRgba("FF6363", 0.28)).toBe("rgba(255, 99, 99, 0.28)");
  });
  it("falls back to a safe rgba on bad input", () => {
    expect(hexToRgba("nope", 0.3)).toBe("rgba(255, 99, 99, 0.3)");
  });
});

describe("Z_INDEX", () => {
  it("orders bands below their outlines and all above page content", () => {
    expect(Z_INDEX.HOVER_BANDS).toBeLessThan(Z_INDEX.HOVER_OVERLAY);
    expect(Z_INDEX.SELECT_BANDS).toBeLessThan(Z_INDEX.SELECT_OVERLAY);
    expect(Z_INDEX.HOVER_OVERLAY).toBeGreaterThan(1_000_000);
  });
});
