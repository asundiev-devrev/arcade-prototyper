import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { frameDir } from "../paths";
import { translateField } from "./pxScale";
import { applyClass, hasSpacingShorthand } from "./classFamily";
import { locateJsx } from "./locateJsx";
import { readClassName, readTextChild, readAttr, splice } from "./patchSource";
import { writeBindEdit } from "./bindEdit";

export interface FieldEdit { field: string; value: string }
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
  /** When set, this edit targets a frame DATA binding (e.g. a ComputerScene
   *  transcript message), not a JSX node. `text` carries the new string. */
  bindPath?: string;
}
export interface VisualEditRequest { frameSlug: string; edits: ElementEdit[] }
export type WriteResult = { ok: true } | { ok: false; reason: string };

const TOKEN_PREFIX = "tok:";

function reparses(source: string): boolean {
  const sf = ts.createSourceFile("frame.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // ts.SourceFile carries parseDiagnostics on the internal field; check for any.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.length === 0;
}

/** Apply one element's edits to a source string. Pure. Bails on the first problem. */
export function applyEditsToSource(
  source: string, edit: ElementEdit,
): (WriteResult & { source?: string }) {
  // Frame-DATA binding edit (e.g. a transcript message). Bypasses JSX location
  // entirely — targets the named const array by message id.
  if (edit.bindPath) {
    if (typeof edit.text !== "string") return { ok: false, reason: "bind-no-text" };
    const r = writeBindEdit(source, edit.bindPath, edit.text);
    return r.ok ? { ok: true, source: r.source } : { ok: false, reason: r.reason };
  }

  if (edit.iconSwap) return { ok: false, reason: "icon-swap" };

  let out = source;

  // 1. className edits (must re-locate after each splice; offsets shift).
  for (const f of edit.fields) {
    // Handle prop: fields FIRST
    if (f.field.startsWith("prop:")) {
      const propName = f.field.slice("prop:".length);
      const hit = locateJsx(out, edit.line, edit.column);
      if (!hit) return { ok: false, reason: "element-not-found" };
      const a = readAttr(out, hit, propName);
      if (!a.ok) return { ok: false, reason: a.reason };
      if ("insertAttr" in a && a.insertAttr) {
        out = splice(out, a.insertAt, a.insertAt, ` ${propName}="${f.value}"`);
      } else {
        out = splice(out, a.valueStart, a.valueEnd, f.value);
      }
      continue;
    }

    const targetClass = f.value.startsWith(TOKEN_PREFIX)
      ? f.value.slice(TOKEN_PREFIX.length)
      : translateField(f.field, f.value);
    if (targetClass === null) return { ok: false, reason: `unmappable-field:${f.field}` };

    const hit = locateJsx(out, edit.line, edit.column);
    if (!hit) return { ok: false, reason: "element-not-found" };
    const cn = readClassName(out, hit);
    if (!cn.ok) return { ok: false, reason: cn.reason };

    if ("insertAttr" in cn && cn.insertAttr) {
      out = splice(out, cn.insertAt, cn.insertAt, ` className="${targetClass}"`);
      continue;
    }

    // Check for spacing-shorthand conflict ONLY if there's no existing per-side class to replace
    const perSidePrefix = targetClass.match(/^([pm][trbl])-/)?.[1];
    const hasExistingPerSide = perSidePrefix
      ? cn.current.split(/\s+/).some(t => new RegExp(`^${perSidePrefix}-`).test(t))
      : false;

    if (!hasExistingPerSide && hasSpacingShorthand(cn.current, targetClass)) {
      return { ok: false, reason: "spacing-shorthand-conflict" };
    }
    const next = applyClass(cn.current, targetClass);
    out = splice(out, cn.valueStart, cn.valueEnd, next);
  }

  // 2. text content (after class edits; re-locate).
  if (typeof edit.text === "string") {
    const hit = locateJsx(out, edit.line, edit.column);
    if (!hit) return { ok: false, reason: "element-not-found" };
    const tc = readTextChild(out, hit);
    if (!tc.ok) return { ok: false, reason: tc.reason };
    out = splice(out, tc.start, tc.end, edit.text);
  }

  if (!reparses(out)) return { ok: false, reason: "reparse-failed" };
  return { ok: true, source: out };
}

/**
 * Success shape for {@link writeBatch}. Carries the line-count delta the write
 * introduced so the client can refresh the source coordinates of any held
 * selection at/below the edit — otherwise a SECOND edit to a line-shifted
 * element posts a stale line:column and `locateJsx` misses.
 *
 * `editLine` is the 1-based source line of the edited element (the MIN line
 * among the batch's edits). `lineDelta` is (lines after) − (lines before),
 * counting newlines; in-place edits report 0.
 */
export type WriteBatchResult =
  | { ok: true; lineDelta: number; editLine: number }
  | { ok: false; reason: string };

function countLines(s: string): number {
  return s.split("\n").length;
}

/** Apply a whole batch atomically: all-or-nothing. */
export async function writeBatch(frameSlug: string, edits: ElementEdit[]): Promise<WriteBatchResult> {
  if (edits.length === 0) return { ok: false, reason: "empty-batch" };
  // All edits in a batch share one frame; derive the project slug from the path.
  const file = edits[0].file;
  const m = /\/projects\/([^/]+)\/frames\//.exec(file);
  if (!m) return { ok: false, reason: "unresolved-project" };
  const projectSlug = m[1];
  const filePath = path.join(frameDir(projectSlug, frameSlug), "index.tsx");

  // Path-safety: ensure resolved path is inside the project's frames dir.
  const base = frameDir(projectSlug, frameSlug);
  if (!path.resolve(filePath).startsWith(path.resolve(base))) {
    return { ok: false, reason: "path-escape" };
  }

  let source: string;
  try { source = await fs.readFile(filePath, "utf-8"); }
  catch { return { ok: false, reason: "frame-read-failed" }; }

  let working = source;
  for (const e of edits) {
    const r = applyEditsToSource(working, e);
    if (!r.ok) return r;            // whole batch bails on any element
    working = r.source!;
  }
  if (working === source) return { ok: false, reason: "no-change" };

  await fs.writeFile(filePath, working, "utf-8");
  // Report the net line-count change + the edited element's line so the client
  // can shift the held coordinates of selections at/below the edit.
  const lineDelta = countLines(working) - countLines(source);
  const editLine = Math.min(...edits.map((e) => e.line));
  return { ok: true, lineDelta, editLine };
}
