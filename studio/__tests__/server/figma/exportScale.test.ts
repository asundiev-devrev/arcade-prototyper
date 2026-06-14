import { describe, it, expect } from "vitest";
import { computeExportScale, TARGET_LONGEST_EDGE_PX } from "../../../server/figma/exportScale";

describe("computeExportScale", () => {
  it("upscales a small node toward the target longest edge", () => {
    // A 240x800 sidebar: longest edge is 800 → 2000/800 = 2.5x (was a flat 2).
    const { scale, widthPx, heightPx } = computeExportScale(240, 800);
    expect(scale).toBeCloseTo(2.5, 5);
    expect(widthPx).toBe(600);
    expect(heightPx).toBe(2000);
  });

  it("clamps a very small node at Figma's 4x export ceiling", () => {
    // A 120px icon would want 2000/120 ≈ 16.7x; Figma caps export at 4x.
    const { scale, widthPx, heightPx } = computeExportScale(120, 120);
    expect(scale).toBe(4);
    expect(widthPx).toBe(480);
    expect(heightPx).toBe(480);
  });

  it("picks a fractional scale that lands a mid-size node on the target", () => {
    // 1000px longest edge → 2000/1000 = 2.0 exactly.
    const { scale, widthPx, heightPx } = computeExportScale(1000, 600);
    expect(scale).toBeCloseTo(2, 5);
    expect(widthPx).toBe(2000);
    expect(heightPx).toBe(1200);
  });

  it("never downscales below 1x even for an already-large frame", () => {
    // A 3000px frame would imply scale < 1; clamp to 1 so we never shrink.
    const { scale, widthPx, heightPx } = computeExportScale(3000, 2000);
    expect(scale).toBe(1);
    expect(widthPx).toBe(3000);
    expect(heightPx).toBe(2000);
  });

  it("uses the LONGEST edge to compute scale, not width", () => {
    // Tall narrow node: height is the longest edge and governs the scale.
    const { scale } = computeExportScale(200, 1000);
    expect(scale).toBeCloseTo(TARGET_LONGEST_EDGE_PX / 1000, 5);
  });

  it("falls back to a safe default scale when dimensions are unknown", () => {
    const { scale, widthPx, heightPx } = computeExportScale(0, 0);
    expect(scale).toBe(2);
    expect(widthPx).toBe(0);
    expect(heightPx).toBe(0);
  });
});
