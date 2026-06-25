// studio/server/codeWriter/kitProps.ts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

export interface KitProp { name: string; values: string[] }

/** Pure: given a .d.ts source, return string-union props of `<Component>Props`. */
export function parsePropsFromDts(dts: string, componentName: string): KitProp[] {
  const sf = ts.createSourceFile("kit.d.ts", dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = `${componentName}Props`;
  const out: KitProp[] = [];
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === wanted) {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
        if (!ts.isUnionTypeNode(member.type)) continue;
        const values: string[] = [];
        let allStrings = true;
        for (const t of member.type.types) {
          if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
          else allStrings = false;
        }
        if (allStrings && values.length > 0) out.push({ name: member.name.getText(), values });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

let dtsCache: string | null = null;
function readKitDts(): string {
  if (dtsCache !== null) return dtsCache;
  try {
    const require = createRequire(import.meta.url);
    const mainEntry = require.resolve("@xorkavi/arcade-gen");
    const dir = path.dirname(mainEntry);
    for (const f of ["index.d.mts", "index.d.cts", "index.d.ts"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) { dtsCache = fs.readFileSync(p, "utf-8"); return dtsCache; }
    }
  } catch { /* fall through */ }
  dtsCache = "";
  return dtsCache;
}

const propCache = new Map<string, KitProp[]>();
export function kitPropsFor(componentName: string): KitProp[] {
  if (propCache.has(componentName)) return propCache.get(componentName)!;
  const props = parsePropsFromDts(readKitDts(), componentName);
  propCache.set(componentName, props);
  return props;
}

export function isKitComponent(componentName: string): boolean {
  return /^[A-Z]/.test(componentName) && kitPropsFor(componentName).length > 0;
}
