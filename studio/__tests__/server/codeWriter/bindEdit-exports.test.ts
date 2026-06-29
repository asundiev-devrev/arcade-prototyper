import { describe, it, expect } from "vitest";
import ts from "typescript";
import { findArrayLiteral, unwrap } from "../../../server/codeWriter/bindEdit";

describe("exported AST helpers", () => {
  it("findArrayLiteral locates a const array (and unwraps as const)", () => {
    const src = `const transcript = [{ id: 1, text: "a" }] as const;`;
    const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const arr = findArrayLiteral(sf, "transcript");
    expect(arr).not.toBeNull();
    expect(arr!.elements.length).toBe(1);
  });
  it("findArrayLiteral returns null for an unknown name", () => {
    const sf = ts.createSourceFile("f.tsx", `const x = [1];`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(findArrayLiteral(sf, "transcript")).toBeNull();
  });
  it("unwrap strips as/satisfies/parens", () => {
    const src = `const x = ([1] satisfies number[]);`;
    const sf = ts.createSourceFile("f.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let inner: ts.Expression | null = null;
    sf.forEachChild(function v(n): void {
      if (ts.isVariableDeclaration(n) && n.initializer) inner = unwrap(n.initializer);
      else ts.forEachChild(n, v);
    });
    expect(inner && ts.isArrayLiteralExpression(inner)).toBe(true);
  });
});
