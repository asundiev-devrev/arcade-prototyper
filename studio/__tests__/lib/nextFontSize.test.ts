import { describe, it, expect } from "vitest";
import { fontSizeForLines } from "../../src/lib/nextFontSize";

describe("fontSizeForLines", () => {
  const base = { start: 50, floor: 20, step: 6 };

  it("returns start for a single line", () => {
    expect(fontSizeForLines({ ...base, lines: 1 })).toBe(50);
    expect(fontSizeForLines({ ...base, lines: 0 })).toBe(50);
  });

  it("shaves one step per extra line", () => {
    expect(fontSizeForLines({ ...base, lines: 2 })).toBe(44);
    expect(fontSizeForLines({ ...base, lines: 3 })).toBe(38);
    expect(fontSizeForLines({ ...base, lines: 4 })).toBe(32);
  });

  it("never goes below the floor", () => {
    expect(fontSizeForLines({ ...base, lines: 10 })).toBe(20);
    expect(fontSizeForLines({ ...base, lines: 9999 })).toBe(20);
  });

  it("is idempotent — same input always gives the same output", () => {
    const a = fontSizeForLines({ ...base, lines: 5 });
    const b = fontSizeForLines({ ...base, lines: 5 });
    expect(a).toBe(b);
  });
});
