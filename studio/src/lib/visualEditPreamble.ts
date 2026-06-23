import type { EditedElement, StyleSnapshot } from "../hooks/editSessionContext";

const LABELS: Record<keyof StyleSnapshot, string> = {
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
};

function elementBlock(e: EditedElement): string | null {
  const keys = (Object.keys(e.pending) as (keyof StyleSnapshot)[]).filter(
    (k) => e.pending[k] !== undefined,
  );
  if (keys.length === 0) return null;
  const s = e.selection;
  const label =
    s.tagName && s.tagName !== s.componentName
      ? `<${s.tagName}> inside <${s.componentName}>`
      : `<${s.componentName}>`;
  const lines = keys.map((k) => {
    const from = s.styles[k];
    const to = e.pending[k] as string;
    return k === "text"
      ? `  - text content: "${from}" -> "${to}"`
      : `  - ${LABELS[k]}: ${from} -> ${to}`;
  });
  return [`Element ${label} at line ${s.line}:${s.column}:`, ...lines].join("\n");
}

/**
 * Serialize a whole batch of edited elements (all in one frame file) into a
 * single Claude instruction. Pure + deterministic. Returns "" if nothing changed.
 */
export function buildVisualEditPreamble(elements: EditedElement[], frameRel: string): string {
  const blocks = elements.map(elementBlock).filter((b): b is string => b !== null);
  if (blocks.length === 0) return "";
  return [
    `Apply these visual changes in frames/${frameRel}. Read the file first — do not edit from memory.`,
    "",
    ...blocks.flatMap((b) => [b, ""]),
    "Apply each change ONLY to the element identified by its line:column; do not modify unrelated parts of the file or other files.",
    "",
    "Express every change with idiomatic Tailwind utility classes and arcade-gen design tokens (e.g. text-(--fg-...), bg-(--bg-...), p-4, text-lg, font-semibold) — map raw px/colors to the nearest token or scale step. Do NOT write raw hex or inline style props.",
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit reports zero or multiple matches, widen the surrounding context and retry, or fall back to Write with the full new file contents.",
    "",
  ].join("\n");
}
