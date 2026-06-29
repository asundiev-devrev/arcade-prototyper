import ts from "typescript";
import { findArrayLiteral } from "./bindEdit";

export type StructureOp =
  | { kind: "insert"; afterId: number | null; entry: { role: "user" | "assistant"; text: string } }
  | { kind: "delete"; id: number }
  | { kind: "move"; id: number; beforeId: number | null }
  | { kind: "setRole"; id: number; role: "user" | "assistant" };

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

function parse(source: string) {
  return ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elementId(el: ts.Expression): number | null {
  if (!ts.isObjectLiteralExpression(el)) return null;
  for (const p of el.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText().replace(/['"]/g, "") === "id"
        && ts.isNumericLiteral(p.initializer)) return Number(p.initializer.text);
  }
  return null;
}

function maxId(arr: ts.ArrayLiteralExpression): number {
  let m = 0;
  for (const el of arr.elements) { const id = elementId(el); if (id != null && id > m) m = id; }
  return m;
}

/** True when the array is laid out one-element-per-line (multi-line). */
function isMultiLine(sf: ts.SourceFile, arr: ts.ArrayLiteralExpression): boolean {
  const text = arr.getText(sf);
  // Newline between the opening "[" and the first element ⇒ multi-line layout.
  return /\[\s*\n/.test(text);
}

/** The indent (leading whitespace) of the first element's line, for multi-line inserts. */
function elementIndent(source: string, arr: ts.ArrayLiteralExpression, sf: ts.SourceFile): string {
  if (arr.elements.length === 0) return "  ";
  const start = arr.elements[0].getStart(sf);
  const lineStart = source.lastIndexOf("\n", start) + 1;
  return source.slice(lineStart, start);
}

function entryText(entry: { role: "user" | "assistant"; text: string }, id: number): string {
  return `{ id: ${id}, role: ${JSON.stringify(entry.role)}, text: ${JSON.stringify(entry.text)} }`;
}

export function writeBindStructure(
  source: string, arrayName: string, op: StructureOp,
): { ok: true; source: string } | { ok: false; reason: string } {
  const sf = parse(source);
  const arr = findArrayLiteral(sf, arrayName);
  if (!arr) return { ok: false, reason: "array-not-found" };
  const els = arr.elements;
  const idxOf = (id: number) => els.findIndex((e) => elementId(e) === id);

  let out: string;

  if (op.kind === "insert") {
    const newId = maxId(arr) + 1;
    const entry = entryText(op.entry, newId);
    const multi = isMultiLine(sf, arr);
    const indent = elementIndent(source, arr, sf);
    // UNIFORM insert strategy (correct for all 3 real formats):
    // pick the "anchor" element to insert AFTER — the afterId element, or the
    // LAST element when afterId is null (append). Then insert immediately after
    // that element's own end (its closing `}`), BEFORE any trailing comma. We
    // always emit the new entry as: ", <entry>" (single-line) or ",\n<indent><entry>"
    // (multi-line). Inserting right after the brace (not after the separator
    // comma) guarantees exactly one separator on each side regardless of whether
    // a trailing comma exists, so there is never a doubled or orphaned comma.
    if (els.length === 0) {
      // empty array: drop the entry between the brackets, no separators needed.
      const closeBracket = arr.getEnd() - 1; // position of "]"
      out = source.slice(0, closeBracket) + entry + source.slice(closeBracket);
    } else {
      const anchorIdx = op.afterId == null ? els.length - 1 : idxOf(op.afterId);
      if (anchorIdx === -1) return { ok: false, reason: "afterId-not-found" };
      const anchorEnd = els[anchorIdx].getEnd(); // position just after the anchor element's `}`
      // ", <entry>" places the new entry AFTER the anchor brace and BEFORE the
      // anchor's existing trailing comma (if any). Net sequence becomes:
      //   } , <entry> ,?    → "}, <entry>," (valid) or "}, <entry>" then "]" (valid)
      const ins = multi ? `,\n${indent}${entry}` : `, ${entry}`;
      out = source.slice(0, anchorEnd) + ins + source.slice(anchorEnd);
    }
  } else if (op.kind === "delete") {
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    const el = els[i];
    const start = el.getStart(sf);
    let end = el.getEnd();
    // swallow a trailing comma + following whitespace if present
    const after = source.slice(end, arr.getEnd());
    const cm = after.match(/^\s*,/);
    if (cm) end += cm[0].length;
    // also trim the now-leading whitespace up to the previous newline
    let s = start;
    const before = source.slice(arr.getStart(sf), start);
    const lead = before.match(/\n[ \t]*$/);
    if (lead) s -= lead[0].length;
    out = source.slice(0, s) + source.slice(end);
  } else if (op.kind === "move") {
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    // Simple, format-robust move: delete the entry's text, re-insert before beforeId
    // (or at end if beforeId null). Do it by recomputing on the AST in two passes.
    const elText = els[i].getText(sf).trim();
    const del = writeBindStructure(source, arrayName, { kind: "delete", id: op.id });
    if (!del.ok) return del;
    // Re-find in the deleted source, then insert elText before beforeId.
    const sf2 = parse(del.source);
    const arr2 = findArrayLiteral(sf2, arrayName);
    if (!arr2) return { ok: false, reason: "array-not-found" };
    const multi = isMultiLine(sf2, arr2);
    const indent = elementIndent(del.source, arr2, sf2);
    if (op.beforeId == null) {
      // Append to the end. REUSE the insert op's anchor strategy: splice the
      // moved element AFTER the last element's `}` with a LEADING separator
      // (never after-the-brace-before-the-trailing-comma, which double-commas
      // on trailing-comma-on-every-element frames). One separator each side
      // regardless of whether a trailing comma exists.
      const closeBracket = arr2.getEnd() - 1;
      if (arr2.elements.length === 0) {
        out = del.source.slice(0, closeBracket) + elText + del.source.slice(closeBracket);
      } else {
        const lastEnd = arr2.elements[arr2.elements.length - 1].getEnd();
        const ins = multi ? `,\n${indent}${elText}` : `, ${elText}`;
        out = del.source.slice(0, lastEnd) + ins + del.source.slice(lastEnd);
      }
      // Reparse fallback (defensive, mirrors the beforeId!=null branch).
      if (!reparses(out)) {
        out = del.source.slice(0, closeBracket) + `, ${elText}` + del.source.slice(closeBracket);
      }
    } else {
      const j = arr2.elements.findIndex((e) => elementId(e) === op.beforeId);
      if (j === -1) return { ok: false, reason: "beforeId-not-found" };
      const beforeStart = arr2.elements[j].getStart(sf2);
      const lineStart = del.source.lastIndexOf("\n", beforeStart) + 1;
      // Multi-line: splice the moved element as its own line at lineStart, then
      // a newline so the displaced element's existing line (which already carries
      // its own indent from lineStart onward) follows. No extra ${indent} prepend
      // here — that was double-indenting the displaced element.
      const ins = multi ? `${indent}${elText},\n` : `${elText}, `;
      out = del.source.slice(0, multi ? lineStart : beforeStart) + ins + del.source.slice(multi ? lineStart : beforeStart);
      // Simpler robust fallback: if the above is fragile, just splice before beforeStart.
      if (!reparses(out)) {
        out = del.source.slice(0, beforeStart) + `${elText}, ` + del.source.slice(beforeStart);
      }
    }
  } else { // setRole
    const i = idxOf(op.id);
    if (i === -1) return { ok: false, reason: "id-not-found" };
    const el = els[i];
    if (!ts.isObjectLiteralExpression(el)) return { ok: false, reason: "not-object" };
    const roleProp = el.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && p.name.getText().replace(/['"]/g, "") === "role",
    );
    if (!roleProp || !ts.isStringLiteral(roleProp.initializer)) return { ok: false, reason: "role-not-string" };
    // Replace the role value.
    const rs = roleProp.initializer.getStart(sf), re = roleProp.initializer.getEnd();
    let work = source.slice(0, rs) + JSON.stringify(op.role) + source.slice(re);
    // Cosmetic hygiene: going to "user" strips an artefact prop if present. One cheap pass.
    if (op.role === "user") {
      const sf3 = parse(work);
      const arr3 = findArrayLiteral(sf3, arrayName)!;
      // Re-find the element on the RE-PARSED tree (do not reuse idxOf, which
      // closes over the original `els`) — keeps the re-parse discipline honest.
      const i3 = arr3.elements.findIndex((e) => elementId(e) === op.id);
      const el3 = i3 === -1 ? undefined : arr3.elements[i3];
      if (el3 && ts.isObjectLiteralExpression(el3)) {
        const art = el3.properties.find(
          (p) => ts.isPropertyAssignment(p) && !!p.name && p.name.getText().replace(/['"]/g, "") === "artefact",
        );
        if (art) {
          const as = art.getStart(sf3); let ae = art.getEnd();
          const after = work.slice(ae); const cm = after.match(/^\s*,/); if (cm) ae += cm[0].length;
          let s = as; const before = work.slice(0, as).match(/,\s*$/); if (before) s -= before[0].length;
          work = work.slice(0, s) + work.slice(ae);
        }
      }
    }
    out = work;
  }

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}
