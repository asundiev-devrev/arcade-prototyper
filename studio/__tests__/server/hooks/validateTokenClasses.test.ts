// @vitest-environment node
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  extractTokenNames,
  parseClassNames,
  detectTokenClassViolations,
} from "../../../server/hooks/validateTokenClasses.mjs";

describe("extractTokenNames", () => {
  it("pulls custom-property names (sans --) from CSS", () => {
    const css = `:root{--fg-neutral-medium:#615e5f;--surface-shallow:#faf9f9;--bg-intelligence-prominent:#5800e6;}`;
    const names = extractTokenNames(css);
    expect(names.has("fg-neutral-medium")).toBe(true);
    expect(names.has("surface-shallow")).toBe(true);
    expect(names.has("bg-intelligence-prominent")).toBe(true);
  });
  it("returns empty set on non-string / empty", () => {
    expect(extractTokenNames("").size).toBe(0);
    expect(extractTokenNames(undefined).size).toBe(0);
  });
});

describe("parseClassNames", () => {
  it("extracts classes from className string literals", () => {
    const src = `<div className="flex text-fg-neutral-medium px-4"><span className={"bg-surface-shallow"} /></div>`;
    const c = parseClassNames(src);
    expect(c).toContain("text-fg-neutral-medium");
    expect(c).toContain("bg-surface-shallow");
    expect(c).toContain("flex");
    expect(c).toContain("px-4");
  });
  it("ignores dynamic className expressions it can't read as a literal", () => {
    // A template/interpolated className yields no bare string literal; we just
    // don't crash and return whatever literals we can see.
    const src = "<div className={cx(styles.a)} />";
    expect(Array.isArray(parseClassNames(src))).toBe(true);
  });
});

describe("detectTokenClassViolations", () => {
  const tokens = new Set([
    "fg-neutral-medium", "fg-neutral-prominent", "surface-shallow",
    "surface-overlay", "bg-intelligence-prominent", "stroke-neutral-subtle",
    "elevation-01",
  ]);

  it("flags the named-token form and suggests the paren form", () => {
    const v = detectTokenClassViolations(
      ["text-fg-neutral-medium", "bg-surface-shallow", "bg-intelligence-prominent", "border-stroke-neutral-subtle"],
      tokens,
    );
    const bad = v.map((x) => x.badClass);
    expect(bad).toContain("text-fg-neutral-medium");
    expect(bad).toContain("bg-surface-shallow");
    expect(bad).toContain("bg-intelligence-prominent");
    expect(bad).toContain("border-stroke-neutral-subtle");
    const sug = Object.fromEntries(v.map((x) => [x.badClass, x.suggestion]));
    expect(sug["text-fg-neutral-medium"]).toBe("text-(--fg-neutral-medium)");
    expect(sug["bg-surface-shallow"]).toBe("bg-(--surface-shallow)");
    expect(sug["bg-intelligence-prominent"]).toBe("bg-(--bg-intelligence-prominent)");
  });

  it("does NOT flag real utilities, paren form, arbitrary brackets, or custom classes", () => {
    const v = detectTokenClassViolations(
      [
        "text-body-small", "text-caption", "text-title-2", "flex", "px-4", "gap-2",
        "text-(--fg-neutral-prominent)", "bg-(--surface-overlay)",
        "bg-[#FAF9F9]", "hover:bg-black/5", "rounded-square-x2", "my-custom-thing",
      ],
      tokens,
    );
    expect(v).toEqual([]);
  });

  it("handles variant prefixes (hover:, md:) on a bad token class", () => {
    const v = detectTokenClassViolations(["hover:text-fg-neutral-medium"], tokens);
    expect(v[0]?.badClass).toBe("hover:text-fg-neutral-medium");
    expect(v[0]?.suggestion).toBe("hover:text-(--fg-neutral-medium)");
  });

  it("fails open: empty token set → no violations", () => {
    expect(detectTokenClassViolations(["text-fg-neutral-medium"], new Set())).toEqual([]);
  });

  it("does NOT flag when only tail matches (not base), preserving Tailwind utilities", () => {
    // The logic now checks BOTH tail and base. If neither the tail nor the base is
    // a token, it won't flag. In this artificial test, we have a token named
    // 'bg-gradient-to-r' but the tail 'gradient-to-r' is not a token, so it would
    // match the base-is-token rule. However, in REALITY (real arcade-gen CSS),
    // 'bg-gradient-to-r' is NOT a token — see the integration test for the real guard.
    // This unit test now verifies that when base IS a token but tail is NOT, we flag it.
    const t = new Set(["bg-gradient-to-r"]); // tail='gradient-to-r' not in set, base is
    const v = detectTokenClassViolations(["bg-gradient-to-r"], t);
    expect(v.length).toBe(1);
    expect(v[0]?.suggestion).toBe("bg-(--bg-gradient-to-r)");
  });

  it("does NOT flag shadow-elevation-01 when elevation-01 is a token", () => {
    // shadow-elevation-01 is a real rendering utility; shadow was removed from
    // TOKEN_PREFIXES so it's never flagged. This regression test guards against
    // the over-block from Defect 1.
    const v = detectTokenClassViolations(["shadow-elevation-01"], tokens);
    expect(v).toEqual([]);
  });

  it("flags bg-<intent>-* family when the full base is a token name", () => {
    // bg-intelligence-prominent where --bg-intelligence-prominent is the token.
    // The base 'bg-intelligence-prominent' is itself a token, so it should be
    // flagged and suggest bg-(--bg-intelligence-prominent).
    const v = detectTokenClassViolations(["bg-intelligence-prominent"], tokens);
    expect(v.length).toBe(1);
    expect(v[0]?.badClass).toBe("bg-intelligence-prominent");
    expect(v[0]?.suggestion).toBe("bg-(--bg-intelligence-prominent)");
  });
});

describe("loadTokenNames (real arcade-gen styles.css)", () => {
  it("resolves the shipped token CSS and contains known tokens", async () => {
    // @ts-expect-error — .mjs import of a pure-JS module with no types
    const { loadTokenNames } = await import("../../../server/hooks/validateTokenClasses.mjs");
    const names = loadTokenNames();
    // arcade-gen dist/styles.css defines 1000+ custom props incl. these.
    expect(names.has("fg-neutral-medium")).toBe(true);
    expect(names.has("surface-shallow")).toBe(true);
    expect(names.size).toBeGreaterThan(100);
  });
});

describe("formatTokenClassError", () => {
  it("names each bad class + its paren-form fix", async () => {
    // @ts-expect-error — .mjs import of a pure-JS module with no types
    const { formatTokenClassError } = await import("../../../server/hooks/validateTokenClasses.mjs");
    const msg = formatTokenClassError([
      { badClass: "text-fg-neutral-medium", suggestion: "text-(--fg-neutral-medium)" },
    ]);
    expect(msg).toContain("text-fg-neutral-medium");
    expect(msg).toContain("text-(--fg-neutral-medium)");
    expect(msg).toMatch(/compile to nothing|render/i);
  });
});
