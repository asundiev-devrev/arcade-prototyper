import { describe, it, expect } from "vitest";
import { applyEditsToSource } from "../../../server/codeWriter/index";

// <C ... /> on line 2, col 3 (the tag-name position locateJsx keys on).
function frame(attrs: string) {
  return `export default function F() {\n  <C${attrs} />;\n}\n`;
}
const at = (field: string, value: string) =>
  ({ file: "frames/x/index.tsx", line: 2, column: 3, fields: [{ field, value }] });

describe("propExpr write", () => {
  it("inserts an expression attr on a self-closing element", () => {
    const r = applyEditsToSource(frame(""), at("propExpr:withCanvasPanel", "true"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain("withCanvasPanel={true}");
  });
  it("replaces an existing expression attr", () => {
    const r = applyEditsToSource(frame(" count={2}"), at("propExpr:count", "5"));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain("count={5}"); expect(r.source).not.toContain("count={2}"); }
  });
  it("replaces an existing STRING attr with an expression (string→number prop)", () => {
    const r = applyEditsToSource(frame(` n="2"`), at("propExpr:n", "5"));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.source).toContain("n={5}"); expect(r.source).not.toContain(`n="2"`); }
  });
  it("string prop: still writes a quoted attr (existing prop: path unchanged)", () => {
    const r = applyEditsToSource(frame(""), at("prop:userName", "Ada"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toContain(`userName="Ada"`);
  });
  it("reparse-guard aborts a malformed expression (file untouched)", () => {
    const r = applyEditsToSource(frame(""), at("propExpr:x", "{[}"));
    expect(r.ok).toBe(false);
  });
});
