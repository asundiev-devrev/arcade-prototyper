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

describe("tokenIndex color canonicalization", () => {
  it("matches a hex8 token value against a browser-normalized rgba lookup", () => {
    // token authored as #8985871a; element computed bg as rgba(137, 133, 135, 0.1)
    const idx = buildTokenIndex(["--bg-neutral-soft"], () => "#8985871a");
    expect(resolveToken(idx, "rgba(137, 133, 135, 0.1)")).toBe("--bg-neutral-soft");
  });

  it("matches a hex6 token value against an rgb lookup", () => {
    const idx = buildTokenIndex(["--fg-neutral-prominent"], () => "#171717");
    expect(resolveToken(idx, "rgb(23, 23, 23)")).toBe("--fg-neutral-prominent");
  });

  it("matches a 3-digit hex token against rgb lookup", () => {
    const idx = buildTokenIndex(["--white"], () => "#fff");
    expect(resolveToken(idx, "rgb(255, 255, 255)")).toBe("--white");
  });

  it("still returns the raw value for an unknown color", () => {
    const idx = buildTokenIndex(["--x"], () => "#000000");
    expect(resolveToken(idx, "rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });

  it("passes non-color values through unchanged (no false token match)", () => {
    const idx = buildTokenIndex(["--corner-radius"], () => "8px");
    expect(resolveToken(idx, "8px")).toBe("--corner-radius");
    expect(resolveToken(idx, "12px")).toBe("12px");
  });
});
