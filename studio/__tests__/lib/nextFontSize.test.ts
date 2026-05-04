import { describe, it, expect } from "vitest";
import { nextFontSize } from "../../src/lib/nextFontSize";

describe("nextFontSize", () => {
  const base = { start: 50, floor: 20, step: 2, maxHeight: 180 };

  it("returns current size when content fits", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 60 })).toBe(50);
  });

  it("shrinks by one step when content overflows", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 200 })).toBe(48);
  });

  it("never goes below the floor", () => {
    expect(nextFontSize({ ...base, current: 20, measuredHeight: 900 })).toBe(20);
  });

  it("grows back toward start when there is slack and we are below start", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 60 })).toBe(32);
  });

  it("does not grow past start", () => {
    expect(nextFontSize({ ...base, current: 50, measuredHeight: 10 })).toBe(50);
  });

  it("shrinks when measured height exceeds max", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 181 })).toBe(28);
  });

  it("returns current when measured height exactly equals max", () => {
    expect(nextFontSize({ ...base, current: 30, measuredHeight: 180 })).toBe(30);
  });
});
