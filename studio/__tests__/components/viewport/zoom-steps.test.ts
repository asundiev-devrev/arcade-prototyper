import { describe, it, expect } from "vitest";
import {
  ZOOM_STEPS,
  ZOOM_MIN,
  ZOOM_MAX,
  nextStep,
  snapToNearestStep,
  formatZoomLabel,
} from "../../../src/components/viewport/zoomSteps";

describe("ZOOM_STEPS", () => {
  it("is sorted ascending and spans 25% to 200%", () => {
    expect(ZOOM_STEPS[0]).toBe(0.25);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(2.0);
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1]);
    }
  });

  it("contains 1.0 so reset is on-step", () => {
    expect(ZOOM_STEPS).toContain(1.0);
  });

  it("exposes ZOOM_MIN and ZOOM_MAX matching the endpoints", () => {
    expect(ZOOM_MIN).toBe(ZOOM_STEPS[0]);
    expect(ZOOM_MAX).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  });
});

describe("nextStep", () => {
  it("moves up one step when zooming in from an on-step value", () => {
    expect(nextStep(1.0, "in")).toBe(1.1);
  });

  it("moves down one step when zooming out from an on-step value", () => {
    expect(nextStep(1.0, "out")).toBe(0.9);
  });

  it("snaps an off-step value to the next larger step when zooming in", () => {
    expect(nextStep(0.8, "in")).toBe(0.9);
  });

  it("snaps an off-step value to the next smaller step when zooming out", () => {
    expect(nextStep(0.8, "out")).toBe(0.75);
  });

  it("clamps at the max when zooming in from the max", () => {
    expect(nextStep(2.0, "in")).toBe(2.0);
  });

  it("clamps at the min when zooming out from the min", () => {
    expect(nextStep(0.25, "out")).toBe(0.25);
  });
});

describe("snapToNearestStep", () => {
  it("returns the nearest step for a value between two stops", () => {
    // 0.4 is between 0.33 and 0.5; nearer to 0.33
    expect(snapToNearestStep(0.4)).toBe(0.33);
    // 0.45 is nearer to 0.5
    expect(snapToNearestStep(0.45)).toBe(0.5);
  });

  it("clamps out-of-range values", () => {
    expect(snapToNearestStep(0.01)).toBe(0.25);
    expect(snapToNearestStep(5)).toBe(2.0);
  });

  it("returns the same value when already on a step", () => {
    expect(snapToNearestStep(1.0)).toBe(1.0);
  });
});

describe("formatZoomLabel", () => {
  it("formats as a whole-number percent", () => {
    expect(formatZoomLabel(1.0)).toBe("100%");
    expect(formatZoomLabel(0.67)).toBe("67%");
    expect(formatZoomLabel(0.33)).toBe("33%");
    expect(formatZoomLabel(0.25)).toBe("25%");
  });
});
