const MAX_LENGTH = 40;

export function deriveProjectName(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled project";
  if (trimmed.length <= MAX_LENGTH) return trimmed;

  const slice = trimmed.slice(0, MAX_LENGTH);
  const lastBreak = slice.lastIndexOf(" ");
  if (lastBreak > 0) return slice.slice(0, lastBreak).trim() + "…";
  return slice + "…";
}
