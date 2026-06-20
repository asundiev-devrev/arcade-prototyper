/**
 * Phantom-edit detection + retry policy. A "phantom edit" is a turn where the
 * agent's reply looks like a completed edit (it followed the response shape and
 * emitted a `### Deviations` section) but NO frame/shared file actually moved —
 * the worst failure mode in the product: the user is told a change shipped and
 * the viewport disagrees. Previously this produced only a post-turn warning;
 * this module decides when to RE-RUN the turn once with a corrective
 * instruction before falling back to that warning.
 *
 * Pure policy only — the actual re-spawn lives in server/middleware/chat.ts.
 */

/**
 * Bare `remember: …` turns legitimately touch only memory/LEARNED.md (outside
 * the frames/shared snapshot) and may still carry a Deviations section; they
 * must never be retried as phantom edits.
 */
export function isMemoryOnlyPrompt(prompt: string): boolean {
  return /^\s*remember:/i.test(prompt);
}

export function shouldRetryPhantomEdit(input: {
  /** Did any file under frames/ or shared/ move this turn. */
  fileChanged: boolean;
  /** Original narration contained a `### Deviations` section (i.e. the agent
   *  presented this as a completed edit). */
  claimsEdit: boolean;
  /** Prompt was a bare `remember:` directive. */
  memoryOnly: boolean;
  /** One-shot guard — we only ever retry a phantom edit once per turn. */
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyRetried) return false;
  if (input.fileChanged) return false;
  if (input.memoryOnly) return false;
  return input.claimsEdit;
}

/**
 * Corrective prompt fed to the resumed session when a phantom edit is detected.
 * Imperative + concrete: re-read, really edit, do not re-narrate.
 */
export const PHANTOM_EDIT_RETRY_PROMPT =
  "Your last reply described a change to the frame, but no file was actually modified — " +
  "the edit did not land. Re-read the target frame file now, then apply the change with the " +
  "Edit tool (or Write with the full file contents if Edit can't find a unique anchor). " +
  "Make the real change before replying; do not describe it again without editing. " +
  "Keep the same response shape: a one-sentence summary plus a ### Deviations section.";
