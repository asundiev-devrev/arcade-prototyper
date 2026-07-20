import { describe, it, expect } from "vitest";
import { decideNoOp } from "../../src/lib/renderVerifyClient";

describe("decideNoOp (pure)", () => {
  it("equal fingerprints → no-op", () => {
    expect(decideNoOp("abc", "abc")).toBe("no-op");
  });
  it("different → changed", () => {
    expect(decideNoOp("abc", "def")).toBe("changed");
  });
  it("null either side → skip (fail open — a blank/failed render is null, NOT a no-op)", () => {
    expect(decideNoOp(null, "abc")).toBe("skip");
    expect(decideNoOp("abc", null)).toBe("skip");
    expect(decideNoOp(null, null)).toBe("skip"); // two blank renders must NOT read as no-op → false corrective (cardinal sin)
  });
});
