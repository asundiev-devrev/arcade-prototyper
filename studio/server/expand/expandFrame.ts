// studio/server/expand/expandFrame.ts
import ts from "typescript";
import { extractTopLevelInstance } from "./extractInstance";
import { FULL_PAGE_TAGS, authoredExpand } from "./registry";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

/**
 * Ensures the arcade-prototypes import includes TitleBar and BreadcrumbBar.
 * The SettingsPage expansion ALWAYS emits these two components, but the original
 * frame likely only imported SettingsPage itself. Without adding them, the
 * expanded frame would white-screen at runtime (undefined component).
 */
function ensureKitImports(source: string, requiredNames: string[]): string {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let targetImport: ts.ImportDeclaration | null = null;
  let existingNames = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpec) && moduleSpec.text === "arcade-prototypes") {
        const clause = node.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          targetImport = node;
          clause.namedBindings.elements.forEach((e) => {
            existingNames.add(e.name.text);
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!targetImport) {
    // No arcade-prototypes import to extend → fail safe, leave as composite
    return source;
  }

  const missing = requiredNames.filter((n) => !existingNames.has(n));
  if (missing.length === 0) {
    // Already imported
    return source;
  }

  // AST-based splice: find the named imports clause and append missing names
  const clause = targetImport.importClause!;
  const namedBindings = clause.namedBindings as ts.NamedImports;
  const elements = namedBindings.elements;
  const lastElement = elements[elements.length - 1];
  const insertPos = lastElement.getEnd();

  // Build the insertion: ", TitleBar, BreadcrumbBar"
  const insertion = missing.map((n) => `, ${n}`).join("");
  return source.slice(0, insertPos) + insertion + source.slice(insertPos);
}

export interface ExpandResult { source: string; changed: boolean; needsAi: string | null }

export function expandFrame(source: string): ExpandResult {
  // Cheap short-circuit: no full-page tag substring → nothing to do.
  if (!FULL_PAGE_TAGS.some((t) => source.includes(`<${t}`))) {
    return { source, changed: false, needsAi: null };
  }
  const inst = extractTopLevelInstance(source, FULL_PAGE_TAGS);
  if (!inst) return { source, changed: false, needsAi: null };

  const expand = authoredExpand(inst.tag);
  if (!expand) return { source, changed: false, needsAi: inst.tag };

  const flat = expand({ ...inst.propsSrc, children: inst.childrenSrc });
  let out = source.slice(0, inst.start) + flat + source.slice(inst.end);

  // For v1, only SettingsPage expansion introduces new kit imports (TitleBar, BreadcrumbBar).
  // Ensure they're imported before returning the flat source.
  if (inst.tag === "SettingsPage") {
    const namesIntroducedBySettingsPage = ["TitleBar", "BreadcrumbBar"];
    out = ensureKitImports(out, namesIntroducedBySettingsPage);
  }

  if (!reparses(out)) return { source, changed: false, needsAi: null };
  return { source: out, changed: true, needsAi: null };
}
