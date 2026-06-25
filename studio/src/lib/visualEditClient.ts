import type { EditedElement } from "../hooks/editSessionContext";

export interface FieldEdit { field: string; value: string }
export interface ElementEdit {
  file: string; line: number; column: number;
  text?: string; fields: FieldEdit[]; iconSwap?: string;
}
export interface VisualEditPayload { frameSlug: string; edits: ElementEdit[] }

export function toElementEdits(batch: EditedElement[]): VisualEditPayload {
  const frameSlug =
    batch[0]?.selection.file.split("/frames/").pop()?.split("/")[0] ?? "";
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

export async function postVisualEdit(
  slug: string, payload: VisualEditPayload,
): Promise<{ ok: boolean; reason?: string }> {
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
