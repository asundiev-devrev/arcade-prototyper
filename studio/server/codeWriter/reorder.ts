import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { frameDir } from "../paths";
import type { WriteResult } from "./index";
import { splice } from "./patchSource";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

export function moveSiblingInSource(
  source: string, line: number, column: number, dir: "up" | "down",
): { ok: true; source: string } | { ok: false; reason: string } {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const target0 = { line: line - 1, character: column - 1 };

  // Find the target JSX element (element or self-closing) at line:column.
  let target: ts.JsxChild | null = null;
  let parentChildren: ts.NodeArray<ts.JsxChild> | null = null;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      for (const child of node.children) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          const open = ts.isJsxElement(child) ? child.openingElement : child;
          const lc = sf.getLineAndCharacterOfPosition(open.tagName.getStart(sf));
          if (lc.line === target0.line) { target = child; parentChildren = node.children; }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!target || !parentChildren) return { ok: false, reason: "element-not-found" };

  // Element siblings only (ignore whitespace-only JsxText).
  const sibs = parentChildren.filter(
    (c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
  );
  const idx = sibs.indexOf(target);
  const otherIdx = dir === "up" ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= sibs.length) return { ok: false, reason: "no-sibling" };

  const a = idx < otherIdx ? target : sibs[otherIdx];
  const b = idx < otherIdx ? sibs[otherIdx] : target;
  const aStart = a.getStart(sf), aEnd = a.getEnd();
  const bStart = b.getStart(sf), bEnd = b.getEnd();
  const aText = source.slice(aStart, aEnd);
  const bText = source.slice(bStart, bEnd);

  // Swap by splicing the later range first (so earlier offsets stay valid).
  let out = splice(source, bStart, bEnd, aText);
  out = splice(out, aStart, aEnd, bText);

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}

export async function moveSibling(
  frameSlug: string, file: string, line: number, column: number, dir: "up" | "down",
): Promise<WriteResult> {
  const m = /\/projects\/([^/]+)\/frames\//.exec(file);
  if (!m) return { ok: false, reason: "unresolved-project" };
  const base = frameDir(m[1], frameSlug);
  const filePath = path.join(base, "index.tsx");
  if (!path.resolve(filePath).startsWith(path.resolve(base))) return { ok: false, reason: "path-escape" };

  let source: string;
  try { source = await fs.readFile(filePath, "utf-8"); }
  catch { return { ok: false, reason: "frame-read-failed" }; }

  const r = moveSiblingInSource(source, line, column, dir);
  if (!r.ok) return r;
  await fs.writeFile(filePath, r.source, "utf-8");
  return { ok: true };
}
