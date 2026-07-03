// @vitest-environment node
// Integration test: verify the hook behavior against the REAL arcade-gen CSS,
// not just fixture data. Guards against doctored test tokens masking real bugs.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  loadTokenNames,
  detectTokenClassViolations,
} from "../../../server/hooks/validateTokenClasses.mjs";

describe("validateTokenClasses (real arcade-gen CSS)", () => {
  const realTokens = loadTokenNames();

  it("loads a non-empty token set from the shipped arcade-gen styles.css", () => {
    expect(realTokens.size).toBeGreaterThan(100);
  });

  it("does NOT flag shadow-elevation-01 (Defect 1 regression guard)", () => {
    // shadow-elevation-01 is a real rendering utility that compiles correctly.
    // Removed 'shadow' from TOKEN_PREFIXES to fix the over-block.
    const v = detectTokenClassViolations(["shadow-elevation-01"], realTokens);
    expect(v).toEqual([]);
  });

  it("DOES flag bg-intelligence-prominent → bg-(--bg-intelligence-prominent) (Defect 2 fix)", () => {
    // The token is named --bg-intelligence-prominent (the bg- is part of the token name).
    // The class bg-intelligence-prominent doesn't compile, so it should be flagged.
    const v = detectTokenClassViolations(["bg-intelligence-prominent"], realTokens);
    expect(v.length).toBe(1);
    expect(v[0]?.badClass).toBe("bg-intelligence-prominent");
    expect(v[0]?.suggestion).toBe("bg-(--bg-intelligence-prominent)");
  });

  it("DOES flag text-fg-neutral-medium → text-(--fg-neutral-medium) (tail-check still works)", () => {
    // The token is --fg-neutral-medium. The tail fg-neutral-medium is the token name.
    const v = detectTokenClassViolations(["text-fg-neutral-medium"], realTokens);
    expect(v.length).toBe(1);
    expect(v[0]?.badClass).toBe("text-fg-neutral-medium");
    expect(v[0]?.suggestion).toBe("text-(--fg-neutral-medium)");
  });

  it("does NOT flag valid utilities (flex, text-body-small, px-4, bg-[#fff])", () => {
    const v = detectTokenClassViolations(
      ["flex", "text-body-small", "px-4", "bg-[#fff]"],
      realTokens,
    );
    expect(v).toEqual([]);
  });

  it("does NOT flag bg-gradient-to-r (real check: not a token in arcade-gen)", () => {
    // bg-gradient-to-r is a Tailwind built-in utility. In the real arcade-gen,
    // there is NO token named --bg-gradient-to-r, so this should never flag.
    const v = detectTokenClassViolations(["bg-gradient-to-r"], realTokens);
    expect(v).toEqual([]);
  });
});
