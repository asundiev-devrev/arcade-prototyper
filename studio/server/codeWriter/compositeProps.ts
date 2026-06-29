// studio/server/codeWriter/compositeProps.ts
import ts from "typescript";

export interface KitProp2 {
  name: string;
  kind: "text" | "toggle" | "number" | "select";
  values?: string[];
  default?: string;
}

/** id-like prop names whose value must match an existing item — unsafe as free text. */
function isIdLike(name: string): boolean {
  return name === "id" || /Id$/.test(name);
}

/** A union node whose every member is a string literal → its literal values. Else null. */
function stringUnionValues(typeNode: ts.TypeNode): string[] | null {
  if (!ts.isUnionTypeNode(typeNode)) return null;
  const values: string[] = [];
  for (const t of typeNode.types) {
    if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
    else return null;
  }
  return values.length > 0 ? values : null;
}

function typeText(node: ts.TypeNode): string {
  return node.getText();
}

function isReactNode(node: ts.TypeNode): boolean {
  const t = typeText(node).trim();
  return t === "React.ReactNode" || t === "ReactNode";
}

/** A union of only `string` keyword and/or ReactNode (a text-slot the kit widened). */
function isStringOrReactNodeUnion(node: ts.TypeNode): boolean {
  if (!ts.isUnionTypeNode(node)) return false;
  return node.types.every(
    (t) => t.kind === ts.SyntaxKind.StringKeyword || isReactNode(t),
  );
}

/** Find the `<componentName>Props` member list (type alias OR interface). */
function findPropsMembers(sf: ts.SourceFile, componentName: string): ts.NodeArray<ts.TypeElement> | null {
  const wanted = `${componentName}Props`;
  let members: ts.NodeArray<ts.TypeElement> | null = null;
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === wanted) members = node.members;
    else if (
      ts.isTypeAliasDeclaration(node) &&
      node.name.text === wanted &&
      ts.isTypeLiteralNode(node.type)
    ) members = node.type.members;
    if (!members) ts.forEachChild(node, visit);
  }
  visit(sf);
  return members;
}

/** Map prop name → its destructuring default literal text (string/number/bool), when literal. */
function readDestructuringDefaults(sf: ts.SourceFile, componentName: string): Map<string, { value: string; isString: boolean }> {
  const out = new Map<string, { value: string; isString: boolean }>();
  let params: ts.NodeArray<ts.ParameterDeclaration> | null = null;
  function visit(node: ts.Node) {
    if (params) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === componentName) params = node.parameters;
    else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === componentName && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          params = d.initializer.parameters;
        }
      }
    }
    if (!params) ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!params || params.length === 0) return out;
  const first = params[0];
  if (!ts.isObjectBindingPattern(first.name)) return out;
  for (const el of first.name.elements) {
    // propertyName is the source prop name when aliased (`activeSessionId: x = …`).
    const propName = (el.propertyName ?? el.name).getText();
    const init = el.initializer;
    if (!init) continue;
    if (ts.isStringLiteral(init)) out.set(propName, { value: init.text, isString: true });
    else if (ts.isNumericLiteral(init)) out.set(propName, { value: init.text, isString: false });
    else if (init.kind === ts.SyntaxKind.TrueKeyword) out.set(propName, { value: "true", isString: false });
    else if (init.kind === ts.SyntaxKind.FalseKeyword) out.set(propName, { value: "false", isString: false });
  }
  return out;
}

/**
 * Pure: parse a composite's `<Name>Props` + the component's destructuring defaults
 * into editable scalar prop descriptors. See the Global Constraints scalar-only rule.
 */
export function parseCompositeProps(source: string, componentName: string): KitProp2[] {
  const sf = ts.createSourceFile("kit.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const members = findPropsMembers(sf, componentName);
  if (!members) return [];
  const defaults = readDestructuringDefaults(sf, componentName);
  const out: KitProp2[] = [];

  for (const m of members) {
    try {
      if (!ts.isPropertySignature(m) || !m.name || !m.type) continue;
      const name = m.name.getText();
      const def = defaults.get(name);
      const t = m.type;

      // string-literal union → select
      const union = stringUnionValues(t);
      if (union) {
        out.push({ name, kind: "select", values: union, ...(def?.isString ? { default: def.value } : {}) });
        continue;
      }
      // boolean
      if (t.kind === ts.SyntaxKind.BooleanKeyword) { out.push({ name, kind: "toggle" }); continue; }
      // number
      if (t.kind === ts.SyntaxKind.NumberKeyword) {
        out.push({ name, kind: "number", ...(def && !def.isString ? { default: def.value } : {}) });
        continue;
      }
      // plain string
      if (t.kind === ts.SyntaxKind.StringKeyword) {
        if (isIdLike(name)) continue; // unsafe as free text
        out.push({ name, kind: "text", ...(def?.isString ? { default: def.value } : {}) });
        continue;
      }
      // ReactNode (or string|ReactNode union) → text ONLY with a string-literal default
      if (isReactNode(t) || isStringOrReactNodeUnion(t)) {
        if (def?.isString) out.push({ name, kind: "text", default: def.value });
        continue; // no string default → skip
      }
      // everything else (arrays, objects, functions, JSX, mixed unions) → skip
    } catch { /* per-prop: skip a weird member, keep the rest */ }
  }
  return out;
}
