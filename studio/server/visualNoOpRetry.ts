/**
 * Visual-no-op retry policy + the corrective prompt. The visual twin of
 * phantomEditRetry.ts: pure policy here; the actual re-spawn lives in
 * server/middleware/chat.ts (handleVisualNoOpRetry). See the spec.
 */

/** Verbs/nouns that mark a summary as a NON-visual claim (behavior, data,
 *  accessibility). If any appears and no visual word does, don't fire. */
const NON_VISUAL = /\b(wired?|hook(ed)?|connect(ed)?|link(ed)?|handler|clickable|on-?click|navigat|route|accessib|aria|screen-?reader|data field|state|logic|functional)\b/i;

/** Marks a summary as clearly NOT a change claim (a question / refusal). */
const NOT_A_CHANGE = /(\?\s*$)|\b(can't|cannot|unable|which|should i|do you want)\b/i;

/**
 * True if the agent's SUMMARY line plausibly claimed a visual/layout/appearance
 * change. Biased toward firing: a missed target bug is worse than one wasted
 * corrective turn (the self-classifying prompt lets the agent opt out cheaply).
 * So: fire UNLESS the summary is clearly non-visual or clearly not-a-change.
 */
export function narrationClaimsVisualChange(summaryLine: string): boolean {
  const s = (summaryLine ?? "").trim();
  if (!s) return false;
  if (NOT_A_CHANGE.test(s)) return false;
  if (NON_VISUAL.test(s)) return false;
  return true;
}

export function shouldRunVisualNoOpRetry(input: {
  alreadyRanForTurn: boolean;
  claimsVisual: boolean;
}): boolean {
  if (input.alreadyRanForTurn) return false;
  return input.claimsVisual;
}

export const VISUAL_NOOP_RETRY_PROMPT =
  "The change you just made did not alter anything visible in the frame — the rendered result is identical to before. " +
  "If it was meant to change layout or appearance and a component ignored the property (e.g. an `orientation`/variant prop " +
  "the kit doesn't implement visually), achieve the intent a different way — real layout/utility classes on a wrapper, a " +
  "different component — so it actually renders. If the change was intentionally non-visual (wiring behavior, an " +
  "accessibility attribute, a data field), that's fine: reply saying so in one line and make no further edit. " +
  "Keep the response shape: a one-sentence summary plus a ### Deviations section.";

/** One-shot guard, keyed on the ORIGINATING user-turn id (stable across
 *  session rotation). Module-level so it survives across route calls. */
const ranForTurn = new Set<string>();
export function visualNoOpRetryAlreadyRan(userTurnId: string): boolean {
  return ranForTurn.has(userTurnId);
}
export function markVisualNoOpRetryRan(userTurnId: string): void {
  ranForTurn.add(userTurnId);
}
