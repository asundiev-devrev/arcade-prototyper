/**
 * Regex that recognizes the required `### Deviations` section header at the
 * start of any line. Multiline + case-insensitive. Deliberately loose on
 * what can follow the word (`### Deviations`, `### deviations (3)`, etc.)
 * so the agent has room to annotate without breaking the contract.
 *
 * A bare prose "Deviations:" (no `###`) does NOT satisfy the contract — we
 * require the markdown heading shape so the check is verifiable by string
 * matching instead of structured parsing.
 */
const DEVIATIONS_HEADING = /^###\s+Deviations\b/mi;

/**
 * Synthetic trailer appended to a turn's narration when the agent failed to
 * emit a Deviations section. Leading `\n\n` is a section separator so the
 * trailer joins cleanly to whatever the agent wrote above.
 *
 * The trailer itself contains a valid `### Deviations` heading so a
 * re-check would pass — we have already applied the enforcement once, no
 * need to do it twice.
 */
export const DEVIATIONS_MISSING_TRAILER =
  "\n\n### Deviations\n\n" +
  "⚠ Agent did not emit a Deviations section — every response must list where the frame deviates from the design system, and why. Review the frame manually.";

/**
 * Returns true when `text` contains the required `### Deviations` section
 * header anywhere in its body. Used by the chat middleware to decide
 * whether to append DEVIATIONS_MISSING_TRAILER.
 */
export function hasDeviationsSection(text: string): boolean {
  return DEVIATIONS_HEADING.test(text);
}
