// studio/__tests__/lift/tokens.test.ts
//
// Guards for the token + utility-class patch table (PR 6a).
//
// The table is self-sunsetting — each entry carries a path inside
// @xorkavi/arcade-gen where the `studio` side is expected to live. The
// drift audit (tested separately in drift.test.ts) fires when that
// expectation breaks. Tests here cover:
//   - applicablePatches filters correctly (no false positives from
//     substring matches like "rounded-square-x2" triggering "rounded-square"),
//   - buildManifest + renderXml wire patches through end-to-end,
//   - manifest omits <tokens> entirely when no patches match.

import { describe, it, expect } from "vitest";
import { buildManifest } from "../../src/lift/buildManifest";
import { renderXml } from "../../src/lift/render";
import { applicablePatches, TOKEN_PATCHES, CLASS_PATCHES } from "../../src/lift/tokens";

describe("applicablePatches", () => {
  it("matches a token patch when the frame uses its `studio` name", () => {
    const { tokenPatches } = applicablePatches(
      `const x = "var(--surface-overlay)";`,
    );
    expect(tokenPatches.map((p) => p.studio)).toContain("--surface-overlay");
  });

  it("does not match when the name is absent", () => {
    const { tokenPatches, classPatches } = applicablePatches(
      `import { Button } from "arcade";`,
    );
    expect(tokenPatches).toEqual([]);
    expect(classPatches).toEqual([]);
  });

  it("applies word-boundary matching for utility classes", () => {
    // "rounded-square-x2" must not trigger a "rounded-square" match.
    const { classPatches } = applicablePatches(
      `<div className="rounded-square-x2" />`,
    );
    const names = classPatches.map((p) => p.studio);
    expect(names).toContain("rounded-square-x2");
    expect(names).not.toContain("rounded-square");
  });

  it("matches both when both classes appear", () => {
    const { classPatches } = applicablePatches(
      `<div className="rounded-square-x2 p-4" />
       <div className="rounded-square p-2" />`,
    );
    const names = classPatches.map((p) => p.studio);
    expect(names).toContain("rounded-square-x2");
    expect(names).toContain("rounded-square");
  });
});

describe("tokens table metadata", () => {
  it("every patch declares a stylesheet path inside arcade-gen/dist/", () => {
    for (const patch of [...TOKEN_PATCHES, ...CLASS_PATCHES]) {
      expect(patch.sunset_if_absent_from, `patch ${patch.studio}`).toMatch(
        /^dist\/.+\.(css|scss)$/,
      );
    }
  });
});

describe("renderer wiring", () => {
  function build(source: string) {
    return buildManifest({
      projectSlug: "p",
      frameSlug: "f",
      frameAbsPath: "/f",
      frameSource: source,
      intentSummary: "",
    });
  }

  it("omits <tokens> entirely when no patches apply", () => {
    const xml = renderXml(build(`import { Button } from "arcade";`));
    expect(xml).not.toContain(`<tokens`);
  });

  it("emits <tokens alignment=\"patching\"> with matching patches only", () => {
    const source = `
      import { Button } from "arcade";
      export default function F() {
        return <div className="rounded-square-x2" style={{ background: "var(--surface-overlay)" }} />;
      }
    `;
    const xml = renderXml(build(source));
    expect(xml).toContain(`<tokens alignment="patching">`);
    expect(xml).toContain(
      `<patch kind="css_var" studio="--surface-overlay" production="--bg-surface-overlay"`,
    );
    expect(xml).toContain(
      `<patch kind="class" studio="rounded-square-x2" production="rounded-lg"`,
    );
    // Irrelevant patches should NOT appear:
    expect(xml).not.toContain(`studio="rounded-square"`);
  });
});
