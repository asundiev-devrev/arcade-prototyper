// studio/server/codeWriter/locateJsx.ts
import ts from "typescript";

export interface JsxHit {
  tagName: string;
  openingStart: number;   // start of the opening element (the "<")
  openingEnd: number;     // end of the opening element (after ">")
  elementStart: number;   // start of the whole JsxElement (== openingStart)
  elementEnd: number;     // end of the whole JsxElement (after </tag> or "/>")
  selfClosing: boolean;
}

function tagNameOf(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return node.tagName.getText();
}

export function locateJsx(source: string, line: number, column: number): JsxHit | null {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const target0 = { line: line - 1, character: column - 1 }; // TS is 0-based
  let best: { hit: JsxHit; colDelta: number } | null = null;

  function visit(node: ts.Node) {
    let opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement | null = null;
    let elementEnd = node.getEnd();
    let selfClosing = false;
    if (ts.isJsxElement(node)) { opening = node.openingElement; }
    else if (ts.isJsxSelfClosingElement(node)) { opening = node; selfClosing = true; }

    if (opening) {
      // Position of the tag-name identifier.
      const namePos = opening.tagName.getStart(sf);
      const lc = sf.getLineAndCharacterOfPosition(namePos);
      if (lc.line === target0.line) {
        const colDelta = Math.abs(lc.character - target0.character);
        const hit: JsxHit = {
          tagName: tagNameOf(opening),
          openingStart: (ts.isJsxSelfClosingElement(node) ? node : (node as ts.JsxElement).openingElement).getStart(sf),
          openingEnd: opening.getEnd(),
          elementStart: node.getStart(sf),
          elementEnd,
          selfClosing,
        };
        if (!best || colDelta < best.colDelta) best = { hit, colDelta };
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return best ? best.hit : null;
}
