// studio/server/expand/extractInstance.ts
import ts from "typescript";

export interface ExtractedInstance {
  tag: string;
  propsSrc: Record<string, string>;
  childrenSrc: string;
  start: number;
  end: number;
}

export function extractTopLevelInstance(source: string, tags: string[]): ExtractedInstance | null {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const want = new Set(tags);
  let found: ExtractedInstance | null = null;

  function tagNameOf(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
    return open.tagName.getText(sf);
  }
  function readProps(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of open.attributes.properties) {
      if (!ts.isJsxAttribute(p) || !p.name) continue;
      const name = p.name.getText(sf);
      const init = p.initializer;
      if (!init) { out[name] = "true"; continue; }              // bare boolean attr
      if (ts.isStringLiteral(init)) { out[name] = init.getText(sf); continue; } // "X" incl quotes
      if (ts.isJsxExpression(init) && init.expression) {
        out[name] = init.expression.getText(sf);                // inner of {…}
      }
    }
    return out;
  }

  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isJsxElement(node) && want.has(node.openingElement.tagName.getText(sf))) {
      const open = node.openingElement;
      const childStart = open.getEnd();
      const childEnd = node.closingElement.getStart(sf);
      found = {
        tag: tagNameOf(open),
        propsSrc: readProps(open),
        childrenSrc: source.slice(childStart, childEnd),
        start: node.getStart(sf),
        end: node.getEnd(),
      };
      return;
    }
    if (ts.isJsxSelfClosingElement(node) && want.has(node.tagName.getText(sf))) {
      found = {
        tag: tagNameOf(node),
        propsSrc: readProps(node),
        childrenSrc: "",
        start: node.getStart(sf),
        end: node.getEnd(),
      };
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
