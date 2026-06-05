// Short uppercase label for an attachment chip, derived from the filename's
// extension (e.g. "report.pdf" → "PDF", "spec.docx" → "DOCX", a screenshot →
// "IMG"). Falls back to "FILE" when there's no usable extension.
export function attachmentKind(fileName: string | undefined): string {
  const lower = (fileName ?? "").toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  // No dot in the name → no extension to show.
  if (!ext || ext === lower) return "FILE";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "IMG";
  return ext.slice(0, 5).toUpperCase();
}
