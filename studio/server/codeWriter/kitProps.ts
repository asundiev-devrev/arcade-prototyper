// studio/server/codeWriter/kitProps.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { parseCompositeProps, type KitProp2 } from "./compositeProps";

// --- arcade-gen .d.mts reader (UNCHANGED internals; now mapped to KitProp2) ---
export interface KitPropUnion { name: string; values: string[] }

/** Pure: given a .d.ts source, return string-union props of `<Component>Props`. */
export function parsePropsFromDts(dts: string, componentName: string): KitPropUnion[] {
  const sf = ts.createSourceFile("kit.d.ts", dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = `${componentName}Props`;
  const out: KitPropUnion[] = [];
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

// --- prototype-kit composite source reader (NEW) ---
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// kitProps.ts is at studio/server/codeWriter/ → prototype-kit is ../../prototype-kit
const KIT_ROOT = path.resolve(MODULE_DIR, "..", "..", "prototype-kit");
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

/** Read a composite's editable scalar props from its .tsx source. [] on any miss.
 *  NOT cached by name — composite source is live-edited in dev (no hot-reload). */
export function compositePropsFor(componentName: string): KitProp2[] {
  if (!NAME_RE.test(componentName)) return [];
  for (const sub of ["composites", "templates"]) {
    const file = path.join(KIT_ROOT, sub, `${componentName}.tsx`);
    try {
      const src = fs.readFileSync(file, "utf-8");
      return parseCompositeProps(src, componentName);
    } catch { /* try next dir */ }
  }
  return [];
}

const unionCache = new Map<string, KitProp2[]>();

/** Editable props for a component: arcade-gen string-unions first (cached, shipped),
 *  else the prototype-kit composite source reader. Returns KitProp2[]. */
export function kitPropsFor(componentName: string): KitProp2[] {
  if (unionCache.has(componentName)) {
    const cached = unionCache.get(componentName)!;
    if (cached.length > 0) return cached;
  }
  const unions = parsePropsFromDts(readKitDts(), componentName);
  if (unions.length > 0) {
    const mapped: KitProp2[] = unions.map((u) => ({ name: u.name, kind: "select", values: u.values }));
    unionCache.set(componentName, mapped);
    return mapped;
  }
  // Not an arcade-gen union component → try prototype-kit source (uncached).
  return compositePropsFor(componentName);
}

export function isKitComponent(componentName: string): boolean {
  return /^[A-Z]/.test(componentName) && kitPropsFor(componentName).length > 0;
}
