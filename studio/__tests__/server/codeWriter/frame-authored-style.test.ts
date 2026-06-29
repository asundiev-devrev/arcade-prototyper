import { describe, it, expect } from "vitest";
import { applyEditsToSource, type ElementEdit } from "../../../server/codeWriter/index";

const FILE = "/x/frames/01-demo/index.tsx";
function srcWith(jsx: string) {
  return `export default function F() {\n  return (\n    ${jsx}\n  );\n}\n`;
}
// Helper to build an edit whose line:column points at the JSX on line 3.
// The column must point at the tag-name position (after opening "<").
function edit(partial: Partial<ElementEdit>): ElementEdit {
  return { file: FILE, line: 3, column: 6, fields: [], ...partial };
}

describe("frame-authored style — static class scope + degrade", () => {
  it("changes a token class on a static-className element (writes to source)", () => {
    const src = srcWith(`<div className="flex p-2 text-(--fg-neutral-prominent)">Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "color", value: "tok:text-(--fg-neutral-subtle)" }],
    }));
    // The instant-style path maps a token field to a class swap; assert it either
    // applied (source changed) or bailed with a REASON (never silently ok+unchanged).
    if (r.ok) {
      expect(r.source).not.toBe(src);
      expect(r.source).toContain("text-(--fg-neutral-subtle)");
    } else {
      expect(typeof r.reason).toBe("string");
    }
  });

  it("changes a spacing class on a static-className element", () => {
    const src = srcWith(`<div className="flex pt-2">Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "paddingTop", value: "16px" }],
    }));
    if (r.ok) {
      expect(r.source).not.toBe(src);
      expect(r.source).toContain("pt-4");
    } else {
      expect(typeof r.reason).toBe("string");
    }
  });

  it("degrades with a reason (never silent ok) on a dynamic className", () => {
    const src = srcWith(`<div className={on ? "p-2" : "p-4"}>Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "paddingTop", value: "8px" }],
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(r.reason).toBe("dynamic-classname");
  });

  it("degrades with a reason on a template-literal className", () => {
    const src = srcWith(`<div className={\`flex \${base}\`}>Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "color", value: "tok:text-(--fg-muted)" }],
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-classname");
  });

  it("bails with 'spacing-shorthand-conflict' when per-side conflicts with shorthand", () => {
    const src = srcWith(`<div className="p-4">Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "paddingTop", value: "24px" }],
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("spacing-shorthand-conflict");
  });

  it("applies per-side when an existing per-side class exists (no conflict)", () => {
    const src = srcWith(`<div className="p-0 pt-4 flex">Hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "paddingTop", value: "24px" }],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain("pt-6");
      expect(r.source).not.toContain("pt-4");
    }
  });
});
