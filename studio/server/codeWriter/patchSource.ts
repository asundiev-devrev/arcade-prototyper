// studio/server/codeWriter/patchSource.ts
import ts from "typescript";
import type { JsxHit } from "./locateJsx";

export function splice(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end);
}

function openingNodeAt(sf: ts.SourceFile, hit: JsxHit):
  ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  let found: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.getStart(sf) === hit.openingStart) {
      found = node;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

export type ReadClassName =
  | { ok: true; current: string; valueStart: number; valueEnd: number; insertAttr?: false }
  | { ok: true; current: ""; insertAt: number; insertAttr: true }
  | { ok: false; reason: string };

export function readClassName(source: string, hit: JsxHit): ReadClassName {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const opening = openingNodeAt(sf, hit);
  if (!opening) return { ok: false, reason: "opening-not-found" };
  const attr = opening.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className",
  );
  if (!attr) {
    // insert ` className="…"` right after the tag name
    return { ok: true, current: "", insertAt: opening.tagName.getEnd(), insertAttr: true };
  }
  const init = attr.initializer;
  if (!init) return { ok: false, reason: "dynamic-classname" };
  // className="..."
  if (ts.isStringLiteral(init)) {
    return { ok: true, current: init.text, valueStart: init.getStart(sf) + 1, valueEnd: init.getEnd() - 1 };
  }
  // className={ ... }
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
    const lit = init.expression;
    return { ok: true, current: lit.text, valueStart: lit.getStart(sf) + 1, valueEnd: lit.getEnd() - 1 };
  }
  return { ok: false, reason: "dynamic-classname" };
}

export type ReadText =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: string };

export function readTextChild(source: string, hit: JsxHit): ReadText {
  if (hit.selfClosing) return { ok: false, reason: "no-children" };
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element: ts.JsxElement | null = null;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.getStart(sf) === hit.openingStart) element = node;
    if (!element) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!element) return { ok: false, reason: "element-not-found" };
  const kids = (element as ts.JsxElement).children.filter(
    (c) => !(ts.isJsxText(c) && c.getText().trim() === ""),
  );
  if (kids.length !== 1) return { ok: false, reason: "non-leaf-text" };
  const only = kids[0];
  if (ts.isJsxText(only)) {
    const raw = only.getText();
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    return { ok: true, start: only.getStart(sf) + lead, end: only.getEnd() - trail };
  }
  if (ts.isJsxExpression(only)) return { ok: false, reason: "dynamic-text" };
  return { ok: false, reason: "non-leaf-text" };
}
