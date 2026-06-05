// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildTokenIndex, resolveToken } from "../../src/export/tokenIndex";

// A fake reader standing in for getComputedStyle(:root): name -> resolved value.
const fakeRoot = {
  "--fg-neutral-prominent": "rgb(23, 23, 23)",
  "--bg-neutral-soft": "rgb(245, 245, 245)",
  "--surface-overlay": "rgb(245, 245, 245)", // collides with bg-neutral-soft
};

describe("tokenIndex", () => {
  it("indexes known token names by their resolved value", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(idx.get("rgb(23, 23, 23)")).toEqual(["--fg-neutral-prominent"]);
  });

  it("returns all candidates when a value is shared (collision deferred to consumer)", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(idx.get("rgb(245, 245, 245)")).toEqual(["--bg-neutral-soft", "--surface-overlay"]);
  });

  it("resolveToken returns the single candidate name, the raw value when unknown", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(resolveToken(idx, "rgb(23, 23, 23)")).toBe("--fg-neutral-prominent");
    expect(resolveToken(idx, "rgb(0, 0, 0)")).toBe("rgb(0, 0, 0)"); // unknown → raw passthrough
  });

  it("normalizes whitespace so 'rgb(23,23,23)' and 'rgb(23, 23, 23)' match", () => {
    const idx = buildTokenIndex(Object.keys(fakeRoot), (n) => fakeRoot[n as keyof typeof fakeRoot] ?? "");
    expect(resolveToken(idx, "rgb(23,23,23)")).toBe("--fg-neutral-prominent");
  });
});
