/**
 * Edit-context enrichment. When a project already has frames, a typed prompt
 * (one with no right-click "Target element" preamble) is almost always an EDIT
 * of an existing frame — yet the agent only infers that from chat history.
 * This prepends a compact, prompt-region block (prompt text is obeyed harder
 * than CLAUDE.md) that (a) names the existing frames and (b) restates the two
 * hard edit rules: explicit requests are law, and a reply with no real file
 * change is a failed turn.
 *
 * No-op on the first build (no frames) so initial-generation fidelity is
 * untouched, and on right-click edits (the client preamble in
 * src/components/chat/PromptInput.tsx already encodes the same discipline).
 * Pure — no I/O.
 */

/** Marker the client preamble (PromptInput.tsx) starts with. Its presence
 *  means the discipline is already prepended; we must not double-inject. */
const CLIENT_PREAMBLE_MARKER = "Target element:";
const EDIT_CONTEXT_MARKER = "<edit_context>";

export function buildEditContextBlock(frameSlugs: string[]): string {
  const list = frameSlugs.length ? frameSlugs.join(", ") : "(none)";
  return [
    "<edit_context>",
    "This project already has frames, so treat this turn as an edit of an existing",
    "frame unless the prompt clearly asks for a brand-new screen.",
    "",
    "- Anything the designer explicitly asks for is LAW. Implement it literally —",
    "  exact color, exact size, a hand-rolled element — even when it diverges from",
    "  the kit or the design system. Note the divergence in ONE ### Deviations line;",
    "  do NOT substitute the kit's version or snap to the nearest token.",
    "- A reply that describes a change without a matching Edit or Write tool call is",
    "  a FAILED turn. Read the target frame, make the real edit, then reply.",
    "",
    `Existing frames: ${list}`,
    "</edit_context>",
  ].join("\n");
}

export function prependEditContext(prompt: string, frameSlugs: string[]): string {
  if (!frameSlugs.length) return prompt;
  if (prompt.includes(CLIENT_PREAMBLE_MARKER)) return prompt;
  if (prompt.includes(EDIT_CONTEXT_MARKER)) return prompt;
  return `${buildEditContextBlock(frameSlugs)}\n\n${prompt}`;
}
