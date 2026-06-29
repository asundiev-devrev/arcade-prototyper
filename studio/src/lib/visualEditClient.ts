import type { EditedElement } from "../hooks/editSessionContext";
import { isTokenPending, tokenClass } from "../hooks/editSessionContext";
import type { StructureOp } from "../../server/codeWriter/bindStructure";

export interface FieldEdit { field: string; value: string }
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
  /** When set, this edit targets a frame DATA binding (e.g. a ComputerScene
   *  transcript message), not a JSX node. `text` carries the new string. */
  bindPath?: string;
  /** When set, this edit performs a structure op on the frame's named data array. */
  structureOp?: StructureOp;
  arrayName?: string;
}
export interface VisualEditPayload { frameSlug: string; edits: ElementEdit[] }

/**
 * True when a picked element is authored in THIS frame's own `index.tsx` (so
 * the deterministic code-writer / scoped chat edit can touch it directly).
 *
 * The picker resolves an element to its source file. Elements the designer
 * authored live under `…/frames/<frameSlug>/`; elements that come from a
 * shared prebuilt component (a prototype-kit composite) resolve to a kit
 * source path with no `/frames/<slug>/` segment. Those are NOT directly
 * editable in place — editing kit source would change every prototype.
 */
export function isInFrame(file: string, frameSlug: string): boolean {
  if (!frameSlug) return false;
  return file.includes(`/frames/${frameSlug}/`);
}

export function toElementEdits(batch: EditedElement[], frameSlug: string): VisualEditPayload {
  const edits: ElementEdit[] = batch.map((e) => {
    const fields: FieldEdit[] = [];
    let text: string | undefined;
    let iconSwap: string | undefined;
    for (const [field, value] of Object.entries(e.pending)) {
      if (value === undefined) continue;
      if (field === "text") { text = value; continue; }
      if (field === "iconSwap") { iconSwap = value; continue; }
      fields.push({ field, value });
    }
    const { file, line, column } = e.selection;
    return { file, line, column, text, fields, iconSwap };
  });
  return { frameSlug, edits };
}

const FIELD_LABELS: Record<string, string> = {
  text: "text content", fontSize: "font size", fontWeight: "font weight",
  fontStyle: "font style", textAlign: "text align", color: "text color",
  backgroundColor: "background color", borderColor: "border color",
  paddingTop: "padding top", paddingRight: "padding right",
  paddingBottom: "padding bottom", paddingLeft: "padding left",
  marginTop: "margin top", marginRight: "margin right",
  marginBottom: "margin bottom", marginLeft: "margin left",
  gap: "gap", width: "width", height: "height",
  minWidth: "min width", maxWidth: "max width", minHeight: "min height", maxHeight: "max height",
  display: "display", flexDirection: "flex direction",
  opacity: "opacity", borderRadius: "corner radius",
  typeStyle: "type style", iconSwap: "icon",
};

/** Plain-language change lines for one element (no file/line:column refs). */
function describeChanges(e: EditedElement): string[] {
  const out: string[] = [];
  for (const [field, value] of Object.entries(e.pending)) {
    if (value === undefined) continue;
    const label = FIELD_LABELS[field] ?? field;
    if (field === "text") {
      out.push(`- set the ${label} to "${value}"`);
    } else if (field === "iconSwap") {
      out.push(`- swap the icon to <${value} />`);
    } else if (isTokenPending(value)) {
      out.push(`- set ${label} using the \`${tokenClass(value)}\` design-token class`);
    } else {
      const from = e.selection.styles[field as keyof typeof e.selection.styles];
      out.push(`- change ${label} from ${from ?? "its current value"} to ${value}`);
    }
  }
  return out;
}

/**
 * Chat instruction for editing an element that lives in a shared kit composite
 * rather than the frame's own source. We never edit kit source (that would
 * change every prototype). Instead we tell the agent to DUPLICATE the relevant
 * markup locally into this frame's `index.tsx` and apply the change to the copy
 * — the original shared component stays intact unless the designer explicitly
 * asks to change it everywhere.
 *
 * The change is described SEMANTICALLY in plain language — NOT via the kit
 * file's line:column, which is meaningless once the markup is inlined into the
 * frame.
 */
export function buildComponentEditPreamble(elements: EditedElement[], frameSlug: string): string {
  const blocks: string[] = [];
  for (const e of elements) {
    const lines = describeChanges(e);
    if (lines.length === 0) continue;
    const tag = e.selection.tagName || e.selection.componentName || "element";
    blocks.push([`On the <${tag}>:`, ...lines].join("\n"));
  }
  if (blocks.length === 0) return "";

  const compName = elements[0]?.selection.componentName || "a shared component";
  return [
    `The designer wants to adjust an element that currently comes from a shared prebuilt component (<${compName}>) rendered inside frames/${frameSlug}/index.tsx.`,
    "",
    "Do NOT edit anything under prototype-kit/ — that source is shared by every prototype and must stay intact.",
    "",
    `Instead, in frames/${frameSlug}/index.tsx, inline a local copy of just the markup needed so the targeted element becomes part of THIS frame, then apply the requested change to that local copy. Keep the visual result identical except for the requested change, and preserve all other props, children, and behavior of the surrounding composite. Express styling with idiomatic Tailwind utility classes and arcade-gen design tokens — no raw hex or inline style props.`,
    "",
    "Requested change:",
    "",
    ...blocks,
  ].join("\n");
}

export async function postVisualEdit(
  slug: string, payload: VisualEditPayload,
): Promise<{ ok: boolean; reason?: string; lineDelta?: number; editLine?: number }> {
  try {
    const res = await fetch(`/api/visual-edit/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { ok: false, reason: "network" };
  }
}

export function buildSingleEdit(
  sel: EditedElement["selection"], field: string, value: string, frameSlug: string,
): VisualEditPayload {
  const fields: FieldEdit[] = [];
  let text: string | undefined;
  let iconSwap: string | undefined;
  if (field === "text") text = value;
  else if (field === "iconSwap") iconSwap = value;
  else fields.push({ field, value });
  return {
    frameSlug,
    edits: [{ file: sel.file, line: sel.line, column: sel.column, text, fields, iconSwap }],
  };
}

export function buildBindEdit(bindPath: string, value: string, frameSlug: string): VisualEditPayload {
  return { frameSlug, edits: [{ file: "", line: 0, column: 0, bindPath, text: value, fields: [] }] };
}

export function buildBindStructure(arrayName: string, op: StructureOp, frameSlug: string): VisualEditPayload {
  return { frameSlug, edits: [{ file: "", line: 0, column: 0, fields: [], arrayName, structureOp: op }] };
}

export async function postEditUndo(slug: string, frameSlug: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`/api/edit-undo/${slug}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frameSlug }),
    });
    return await res.json();
  } catch { return { ok: false, reason: "network" }; }
}
