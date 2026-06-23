// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { computeDistanceSegments, showAxisGuides, hideAxisGuides, teardownMeasureGuides, resetMeasureTeardown } from "../../../src/frame/overlay/measureGuides";
import type { Rect } from "../../../src/frame/overlay/geometry";

const rect = (top: number, left: number, width: number, height: number): Rect =>
  ({ top, left, width, height, bottom: top + height, right: left + width });

beforeEach(() => {
  document.documentElement.querySelectorAll("[id^='dm-']").forEach((n) => n.remove());
  resetMeasureTeardown();
});

describe("computeDistanceSegments", () => {
  it("returns lines + pills describing the gap between two rects", () => {
    const a = rect(0, 0, 100, 50);     // base
    const b = rect(0, 200, 100, 50);   // 100px to the right
    const seg = computeDistanceSegments(a, b);
    expect(Array.isArray(seg.lines)).toBe(true);
    expect(Array.isArray(seg.pills)).toBe(true);
    // at least one pill carries a numeric distance label
    expect(seg.pills.some((p) => /\d/.test(p.label))).toBe(true);
  });
});

describe("axis guides", () => {
  it("showAxisGuides paints fixed-position guide lines; hide clears them", () => {
    showAxisGuides(rect(10, 10, 100, 40), "hover");
    const anyGuide = document.querySelector("[id^='dm-'][style*='position: fixed'], [id^='dm-axis']");
    expect(anyGuide).toBeTruthy();
    hideAxisGuides();
    // after hide, guide lines are removed or display:none — assert none visible
    const visible = Array.from(document.querySelectorAll<HTMLElement>("[id^='dm-axis'] *"))
      .filter((n) => n.style.display !== "none");
    expect(visible.length).toBe(0);
  });
});
