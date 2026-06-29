// studio/server/codeWriter/bindEdit.ts
import ts from "typescript";

export interface BindPath { array: string; id: number; field: string[] }

/** Parse `transcript[id=2].text` / `transcript[id=2].artefact.title`. null on malformed. */
export function parseBindPath(bindPath: string): BindPath | null {
  const m = /^([A-Za-z_$][\w$]*)\[id=(\d+)\]\.(.+)$/.exec(bindPath);
  if (!m) return null;
  const field = m[3].split(".").filter(Boolean);
  if (field.length === 0) return null;
  return { array: m[1], id: Number(m[2]), field };
}

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

/** Find the `const <name> = [ … ]` array literal initializer anywhere in the file. */
function findArrayLiteral(sf: ts.SourceFile, name: string): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) found = node.initializer;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** Within an object literal, the property assignment for `key` (string/numeric/ident name). */
function propByName(obj: ts.ObjectLiteralExpression, key: string): ts.PropertyAssignment | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText().replace(/['"]/g, "") === key) return p;
  }
  return null;
}

export function writeBindEdit(
  source: string, bindPath: string, newText: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  const parsed = parseBindPath(bindPath);
  if (!parsed) return { ok: false, reason: "bad-bindpath" };
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const arr = findArrayLiteral(sf, parsed.array);
  if (!arr) return { ok: false, reason: "array-not-found" };

  // Find the element object whose `id` numeric literal === parsed.id.
  let target: ts.ObjectLiteralExpression | null = null;
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    const idProp = propByName(el, "id");
    if (idProp && ts.isNumericLiteral(idProp.initializer) && Number(idProp.initializer.text) === parsed.id) {
      target = el;
      break;
    }
  }
  if (!target) return { ok: false, reason: "id-not-found" };

  // Walk the field path: all but the last must be nested object literals.
  let obj: ts.ObjectLiteralExpression = target;
  for (let i = 0; i < parsed.field.length - 1; i++) {
    const p = propByName(obj, parsed.field[i]);
    if (!p || !ts.isObjectLiteralExpression(p.initializer)) return { ok: false, reason: "field-not-object" };
    obj = p.initializer;
  }
  const leafKey = parsed.field[parsed.field.length - 1];
  const leaf = propByName(obj, leafKey);
  if (!leaf || !ts.isStringLiteral(leaf.initializer)) return { ok: false, reason: "leaf-not-string" };

  // Replace the leaf string-literal value (incl. quotes) with a JSON-encoded
  // double-quoted string so embedded quotes/newlines can't break parse.
  const start = leaf.initializer.getStart(sf);
  const end = leaf.initializer.getEnd();
  const encoded = JSON.stringify(newText);
  const out = source.slice(0, start) + encoded + source.slice(end);

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
