import { describe, it, expect } from "vitest";
import { nextFramePrefix } from "../../server/projects";

describe("nextFramePrefix", () => {
  it("returns 01 when there are no frames", () => {
    expect(nextFramePrefix([])).toBe("01");
  });

  it("returns the next two-digit prefix after the highest existing one", () => {
    expect(nextFramePrefix(["01-home", "02-settings"])).toBe("03");
  });

  it("ignores frame slugs that don't begin with a two-digit prefix", () => {
    expect(nextFramePrefix(["welcome", "02-settings"])).toBe("03");
  });

  it("handles gaps by always picking highest+1, not filling the gap", () => {
    expect(nextFramePrefix(["01-home", "05-done"])).toBe("06");
  });

  it("pads single digits to two chars", () => {
    expect(nextFramePrefix(["08-foo"])).toBe("09");
  });

  it("works for three-digit ranges", () => {
    expect(nextFramePrefix(["99-last"])).toBe("100");
  });
});
