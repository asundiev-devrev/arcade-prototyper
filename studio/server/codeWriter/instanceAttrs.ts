import ts from "typescript";
import { locateJsx } from "./locateJsx";

/** Current set attributes of the JSX element at (line,col), as display strings:
 *  string literal → its text; `{expr}` → the expression source; bare attr → "true".
 *  Pure; {} on miss. Used to prefill the props panel with what's actually in source. */
export function readInstanceAttrs(source: string, line: number, column: number): Record<string, string> {
  const hit = locateJsx(source, line, column);
  if (!hit) return {};
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.getStart(sf) === hit!.openingStart) opening = node;
    if (!opening) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!opening) return {};
  const out: Record<string, string> = {};
  for (const p of (opening as ts.JsxOpeningElement | ts.JsxSelfClosingElement).attributes.properties) {
    if (!ts.isJsxAttribute(p) || !p.name) continue;
    const name = p.name.getText();
    const init = p.initializer;
    if (!init) { out[name] = "true"; continue; } // bare boolean attr
    if (ts.isStringLiteral(init)) { out[name] = init.text; continue; }
    if (ts.isJsxExpression(init) && init.expression) { out[name] = init.expression.getText(sf); continue; }
  }
  return out;
}
