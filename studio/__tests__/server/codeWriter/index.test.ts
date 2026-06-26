import { describe, it, expect } from "vitest";
import { applyEditsToSource, type ElementEdit } from "../../../server/codeWriter/index";

const FILE = "/x/frames/01-demo/index.tsx";
function srcWith(jsx: string) {
  return `export default function F() {\n  return (\n    ${jsx}\n  );\n}\n`;
}
// helper to build an edit whose line:column points at the JSX on line 3
function edit(partial: Partial<ElementEdit>): ElementEdit {
  return { file: FILE, line: 3, column: 6, fields: [], ...partial };
}

describe("applyEditsToSource", () => {
  it("swaps a per-side padding (raw px) deterministically", () => {
    const src = srcWith(`<div className="p-0 pt-4 flex">hi</div>`);
    // NOTE: column must point at the div tag; the helper assumes col 6 on line 3
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "24px" }] }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain("pt-6");
    expect(r.source).not.toContain("pt-4");
  });

  it("applies a token color class verbatim", () => {
    const src = srcWith(`<div className="text-(--fg-default)">hi</div>`);
    const r = applyEditsToSource(src, edit({
      fields: [{ field: "color", value: "tok:text-(--fg-muted)" }],
    }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain("text-(--fg-muted)");
    expect(r.source).not.toContain("text-(--fg-default)");
  });

  it("replaces text content", () => {
    const src = srcWith(`<span>Old</span>`);
    const r = applyEditsToSource(src, edit({ text: "New", fields: [] }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain(">New<");
  });

  it("bails on a spacing-shorthand conflict", () => {
    const src = srcWith(`<div className="p-4">hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "24px" }] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("spacing-shorthand-conflict");
  });

  it("applies off-scale spacing as arbitrary value", () => {
    const src = srcWith(`<div className="flex">hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "paddingTop", value: "23px" }] }));
    expect(r.ok).toBe(true);
    expect(r.source).toContain("pt-[23px]");
  });

  it("bails on dynamic className", () => {
    const src = srcWith(`<div className={cn("flex")}>hi</div>`);
    const r = applyEditsToSource(src, edit({ fields: [{ field: "color", value: "tok:text-(--fg-muted)" }] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("dynamic-classname");
  });

  it("bails when an iconSwap is requested", () => {
    const src = srcWith(`<div className="flex">hi</div>`);
    const r = applyEditsToSource(src, edit({ iconSwap: "Trash", fields: [] }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("icon-swap");
  });
});
