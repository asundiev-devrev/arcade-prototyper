import type { TargetSelection, PendingEdits, StyleSnapshot } from "../hooks/targetSelectionContext";

/** Human-readable label for each editable field. */
const LABELS: Record<keyof StyleSnapshot, string> = {
  text: "text content",
  fontSize: "font size",
  fontWeight: "font weight",
  fontStyle: "font style",
  textAlign: "text align",
  color: "text color",
  backgroundColor: "background color",
  borderColor: "border color",
  paddingTop: "padding top", paddingRight: "padding right",
  paddingBottom: "padding bottom", paddingLeft: "padding left",
  marginTop: "margin top", marginRight: "margin right",
  marginBottom: "margin bottom", marginLeft: "margin left",
  gap: "gap",
  width: "width", height: "height",
};

/**
 * Serialize a batch of visual edits + the target source location into a single
 * instruction for the existing Claude generator. Pure + deterministic so it can
 * be unit-tested. Returns "" when nothing changed (caller should not send).
 */
export function buildVisualEditPreamble(target: TargetSelection, pending: PendingEdits): string {
  const keys = (Object.keys(pending) as (keyof StyleSnapshot)[]).filter(
    (k) => pending[k] !== undefined,
  );
  if (keys.length === 0) return "";

  const rel = target.file.split("/frames/").pop() ?? target.file;
  const label =
    target.tagName && target.tagName !== target.componentName
      ? `<${target.tagName}> inside <${target.componentName}>`
      : `<${target.componentName}>`;

  const changeLines = keys.map((k) => {
    const from = target.styles[k];
    const to = pending[k] as string;
    if (k === "text") return `- text content: "${from}" -> "${to}"`;
    return `- ${LABELS[k]}: ${from} -> ${to}`;
  });

  return [
    `Target element: ${label}`,
    `Source: frames/${rel}:${target.line}:${target.column}`,
    "",
    "Apply these visual changes to that element:",
    ...changeLines,
    "",
    `Read frames/${rel} first — do not edit from memory. The line:column above identifies the targeted element. Apply the changes ONLY to this element; do not modify other files or unrelated parts of this file.`,
    "",
    "Express every change with idiomatic Tailwind utility classes and arcade-gen design tokens (e.g. text-(--fg-...), bg-(--bg-...), p-4, text-lg, font-semibold) — map raw px/colors to the nearest token or scale step. Do NOT write raw hex or inline style props.",
    "",
    "A reply without a corresponding Edit or Write tool call is a failed turn. If your Edit reports zero or multiple matches, widen the surrounding context and retry, or fall back to Write with the full new file contents.",
    "",
  ].join("\n");
}
