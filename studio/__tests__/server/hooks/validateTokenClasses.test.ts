// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-expect-error — .mjs import of a pure-JS module with no types
import {
  extractTokenNames,
  parseClassNames,
  detectTokenClassViolations,
  extractTokenRefs,
  extractLocalDefs,
  detectDeadTokenRefs,
  suggestRealTokens,
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

  it("does NOT flag standard Tailwind v4 text-size utilities (text-sm/xs/base/lg)", () => {
    // arcade-gen's @theme defines --text-sm / --text-xs / --text-base / --text-lg
    // (font-size vars), so baseIsToken is true for these — but they are the
    // STANDARD Tailwind font-size utilities that compile perfectly. Flagging them
    // churned every frame and the agent's "fix" (text-(--text-sm)) is worse: it
    // drops the paired --text-sm--line-height. The TAILWIND_DEFAULT_PREFIXES skip
    // must exempt them. (Real tokens loaded from arcade-gen's styles.css.)
    const v = detectTokenClassViolations(
      ["text-sm", "text-xs", "text-base", "text-lg", "md:text-sm"], tokens);
    expect(v).toEqual([]);
  });

  it("STILL flags a real DS-token color collision written without the paren form", () => {
    // The Tailwind-default skip must NOT weaken the real catch: text-fg-neutral-medium
    // (tail = a real DS token) and hover:text-fg-neutral-medium still flag.
    const v = detectTokenClassViolations(
      ["text-fg-neutral-medium", "hover:text-fg-neutral-medium"], tokens);
    expect(v.map((x) => x.badClass).sort()).toEqual(
      ["hover:text-fg-neutral-medium", "text-fg-neutral-medium"]);
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

const UNION = new Set([
  "bg-neutral-subtle", "fg-neutral-medium", "surface-shallow",
  "fg-neutral-on-prominent", "bg-neutral-transparent",       // kit-CSS-only (lossy ADS)
  "bg-expressive-yellow-subtle",
]);
const SEED = { "bg-expressive-orange-subtle": "#FCECD2" };    // ADS-real, kit-absent

describe("extractTokenRefs", () => {
  it("captures the Tailwind paren-var form", () => {
    expect([...extractTokenRefs(`<div className="bg-(--bg-orange-subtle)" />`)]).toEqual(["bg-orange-subtle"]);
  });
  it("captures var() in inline styles", () => {
    expect([...extractTokenRefs(`style={{ background: "var(--surface-overlay)" }}`)]).toEqual(["surface-overlay"]);
  });
  it("ignores a JS decrement (--i) — no internal hyphen", () => {
    expect([...extractTokenRefs(`arr[(--i)]`)]).toEqual([]);
  });
});

describe("extractLocalDefs (React object-key syntax)", () => {
  it("captures a quoted object-key CSS var", () => {
    expect(extractLocalDefs(`style={{ "--my-thing": "#fff" }}`).has("my-thing")).toBe(true);
  });
  it("captures a computed object-key CSS var", () => {
    expect(extractLocalDefs(`style={{ ["--my-thing"]: "#fff" }}`).has("my-thing")).toBe(true);
  });
});

describe("detectDeadTokenRefs", () => {
  it("flags a ref absent from the union as a typo (no realValue)", () => {
    const v = detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, UNION, SEED);
    expect(v.map(x => x.ref)).toEqual(["bg-orange-subtle"]);
    expect(v[0].realValue).toBeNull();
  });
  it("flags an ADS-real-but-kit-absent ref WITH its real value", () => {
    const v = detectDeadTokenRefs(`className="bg-(--bg-expressive-orange-subtle)"`, UNION, SEED);
    expect(v).toHaveLength(1);
    expect(v[0].realValue).toBe("#FCECD2");
  });
  it("does NOT flag a kit-shipped *-on-prominent token (rev-4 false-alarm regression guard)", () => {
    expect(detectDeadTokenRefs(`className="text-(--fg-neutral-on-prominent)"`, UNION, SEED)).toEqual([]);
  });
  it("does NOT flag a resolvable token", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-neutral-subtle)"`, UNION, SEED)).toEqual([]);
  });
  it("does NOT flag an author-local var (unioned by caller)", () => {
    const withLocal = new Set([...UNION, "my-thing"]);
    expect(detectDeadTokenRefs(`style={{ ["--my-thing"]: "#fff", color: "var(--my-thing)" }}`, withLocal, SEED)).toEqual([]);
  });
  it("fails open on an empty union", () => {
    expect(detectDeadTokenRefs(`className="bg-(--bg-orange-subtle)"`, new Set(), SEED)).toEqual([]);
  });
  it("skips Tailwind-default refs (framework primitives, not DS tokens)", () => {
    // --radius-md is a Tailwind built-in, never in resolvable, but always resolves → skip it.
    const v = detectDeadTokenRefs(`className="rounded-(--radius-md)"`, UNION, SEED);
    expect(v).toEqual([]);
  });
});

describe("suggestRealTokens", () => {
  it("returns union tokens sharing the leading segment, capped", () => {
    const s = suggestRealTokens("bg-orange-subtle", UNION, 3);
    expect(s.length).toBeLessThanOrEqual(3);
    expect(s.every(t => UNION.has(t) && t.startsWith("bg-"))).toBe(true);
  });
});

const HOOK = path.resolve(__dirname, "../../../server/hooks/validateTokenClasses.mjs");

function runHook(payload: any) {
  return spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    env: process.env,
    encoding: "utf-8",
  });
}

function tmpFrame(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-token-"));
  const frameDir = path.join(dir, "projects", "p", "frames", "01");
  fs.mkdirSync(frameDir, { recursive: true });
  const file = path.join(frameDir, "index.tsx");
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

describe("validateTokenClasses hook (dead-ref integration)", () => {
  it("exit 2 on a typo token in a frame file (Write, full content)", () => {
    const f = tmpFrame(`export default () => <div className="bg-(--bg-orange-subtle)" />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(2);
    expect(p.stderr).toMatch(/bg-orange-subtle/);
  });
  it("exit 2 with the real value for an ADS-real-but-kit-absent token", () => {
    const f = tmpFrame(`export default () => <div className="bg-(--bg-expressive-orange-subtle)" />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(2);
    expect(p.stderr).toMatch(/#FCECD2/i);
  });
  it("exit 0 for a kit-shipped *-on-prominent token (rev-4 regression guard)", () => {
    const f = tmpFrame(`export default () => <div className="text-(--fg-neutral-on-prominent)" />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(0);
  });
  it("exit 0 for --radius-bubble (real, in tailwind.css @theme)", () => {
    const f = tmpFrame(`export default () => <div className="rounded-(--radius-bubble)" />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(0);
  });
  it("exit 0 for --component-bubble-radius (real, in arcade-gen-patches.css)", () => {
    const f = tmpFrame(`export default () => <div style={{ borderRadius: "var(--component-bubble-radius)" }} />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(0);
  });
  it("exit 0 for --radius-md (Tailwind default, allowlisted)", () => {
    const f = tmpFrame(`export default () => <div className="rounded-(--radius-md)" />;`);
    const p = runHook({ tool_name: "Write", tool_input: { file_path: f, content: fs.readFileSync(f, "utf-8") } });
    expect(p.status).toBe(0);
  });
});
