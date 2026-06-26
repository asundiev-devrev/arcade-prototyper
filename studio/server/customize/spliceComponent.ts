// studio/server/customize/spliceComponent.ts
import ts from "typescript";
import { locateJsx } from "../codeWriter/locateJsx";
import { splice } from "../codeWriter/patchSource";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

export function spliceComponentInSource(
  source: string, componentName: string, line: number, column: number, jsx: string,
): { ok: true; source: string } | { ok: false; reason: string } {
  const hit = locateJsx(source, line, column);
  if (!hit || hit.tagName !== componentName) {
    // fall back: scan for the named element nearest the requested line
    return { ok: false, reason: "target-not-found" };
  }
  const out = splice(source, hit.elementStart, hit.elementEnd, jsx);
  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
