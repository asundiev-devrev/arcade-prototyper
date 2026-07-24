/**
 * Canonical machine sentinel marking a prompt as a SCOPED EDIT — the user
 * right-clicked one or more rendered elements and the client prepended an
 * element-targeting preamble (buildTargetPreamble in PromptInput.tsx).
 *
 * WHY THIS EXISTS. The scoped-edit signal used to be a human-readable substring
 * ("Target element:") that the PRODUCER and its two DETECTORS had to keep in
 * sync by hand — and they drifted. buildTargetPreamble emits three header
 * shapes: "Target element:" (single), "Target elements:" (multi-select), and
 * "Target element rendered from a SHARED …" (a baked kit element). The detector
 * matched only the singular colon form, so multi-select and baked-element edits
 * were NOT recognised as scoped edits: they misrouted to a NEW-frame Figma
 * import and lost the reference-not-rebuild discipline. It was also
 * over-inclusive — ordinary typed prose containing "Target element:" tripped it.
 *
 * The fix is ONE constant, prepended verbatim by the producer and detected
 * verbatim by every consumer, living in a module both the client (PromptInput)
 * and the server (editContext, turnRouting) import — so it cannot drift again.
 * An HTML comment: inert if the model ever reads it, invisible in rendered
 * markdown, and unlikely enough in typed prose to close the over-inclusive case.
 */
export const SCOPED_EDIT_MARKER = "<!-- arcade:scoped-edit -->";

/**
 * True when a prompt carries the scoped-edit sentinel the client picker
 * prepends. The single ground-truth test for "this is an edit of already-picked
 * element(s)", shared by turn routing and edit-context enrichment.
 */
export function isScopedEditPrompt(prompt: string): boolean {
  return typeof prompt === "string" && prompt.includes(SCOPED_EDIT_MARKER);
}
