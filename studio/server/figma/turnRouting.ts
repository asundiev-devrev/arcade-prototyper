/**
 * Pure turn-routing decision for prompts that mention Figma.
 *
 * A prompt that references a Figma URL can mean three very different things:
 *   1. "Import this node" (bare)              → deterministic kit-emit importer
 *   2. "Import this screen + wire this modal"  → import + one scoped LLM wire pass
 *   3. "In the frame I picked, make this filter open a popover that looks like
 *       <figma url>"                           → EDIT the existing frame in place,
 *                                                using the URL(s) as REFERENCE only
 *
 * Cases 1 and 2 create NEW frames. Case 3 must NOT — the designer right-clicked
 * an element and is editing it; the Figma links are reference material for what
 * the result should look like, not screens to stamp out as separate frames.
 *
 * The ground-truth signal for case 3 is the machine sentinel the client edit
 * preamble prepends when the user picks element(s) (SCOPED_EDIT_MARKER). Its
 * presence forces the Claude edit branch, which already pulls the referenced
 * design in as reference context (geometry + component identities + ground-truth
 * PNG). Reference stays reference. The sentinel replaces the old
 * "Target element:" substring, which missed the plural + baked preamble shapes
 * and so misrouted multi-select / baked-element edits into a new-frame import.
 *
 * Case 4 — KNOWN UNFIXED. A designer TYPES a complaint about a frame we already
 * produced ("you haven't implemented this background blur properly <figma url> …
 * try again"). No element is picked, so there is no sentinel, and the prompt has
 * no build verb — so it falls through to the bare-import default below and
 * reaches the deterministic importer, which has NO LLM. It cannot read one word
 * of the complaint: it stamps a BRAND NEW frame and narrates "No design-system
 * components detected" about that new import. Structurally, EVERY second turn on
 * a Figma frame fails this way (live session 2026-08-06, project
 * implement-this-precisely-3).
 *
 * A keyword detector for case 4 was built and then REMOVED. Measured against the
 * real prompt corpus (__tests__/fixtures/designer-prompts.json — 67 prompts from
 * actual sessions), it caught 4 of the 15 genuine corrections: 27% recall. The
 * misses are ordinary English with no complaint keyword — "This is how the button
 * looks right now. Check your import", "The avatar … is misaligned", "repair the
 * broken frame", "revert that change", "There's no difference — ChatInput is
 * still white". It also FIRED on descriptive prose ("It's the connection-failed
 * state with a Try again button"), pulling faithful-copy asks off the fast
 * deterministic path.
 *
 * A correction is a SPEECH ACT, not a vocabulary, so string matching is the wrong
 * mechanism — it was simultaneously too deaf and too twitchy. The fix belongs on
 * the model, which already reads the prompt: let it classify the turn (fresh
 * import / correction / interaction, plus any constraints) and keep the
 * deterministic path only where the ask is unambiguous. Do NOT re-add patterns.
 *
 * Pure — no I/O, no subprocess. Unit-tested in
 * __tests__/server/figma/turnRouting.test.ts.
 */
import { isScopedEditPrompt } from "../../src/lib/scopedEdit";

export type FigmaTurnKind = "wire" | "kit-emit" | "claude";

export interface FigmaTurnInputs {
  /** true when a single Figma node URL parsed out of the prompt. */
  hasFigmaNode: boolean;
  /** shouldGenerateFromFigma(prompt) — build or interaction intent present. */
  wantsGeneration: boolean;
  /** detectInteractionIntent(prompt) — "click X opens …". */
  hasInteractionIntent: boolean;
  /** count of Figma URLs in the prompt (wire needs the 2nd for the overlay). */
  figmaUrlCount: number;
  /** the raw prompt — checked for the scoped-edit preamble marker. */
  prompt: string;
}

/** True when the prompt is a scoped edit of an already-picked element. Thin
 *  re-export of the shared detector, kept for the existing call sites/tests. */
export function isScopedEditTurn(prompt: string): boolean {
  return isScopedEditPrompt(prompt);
}

/**
 * Decide which Figma branch a turn takes. Returns "claude" for anything that
 * isn't a deterministic import — including a scoped element edit that merely
 * references Figma URLs.
 */
export function classifyFigmaTurn(inp: FigmaTurnInputs): FigmaTurnKind {
  if (!inp.hasFigmaNode) return "claude";

  // A scoped element edit is NEVER a new-frame import, no matter how many URLs
  // or how much interaction wording it carries. The links are reference; the
  // Claude edit branch consumes them without stamping out separate frames.
  if (isScopedEditTurn(inp.prompt)) return "claude";

  if (inp.hasInteractionIntent && inp.figmaUrlCount >= 2) return "wire";
  if (!inp.wantsGeneration) return "kit-emit";
  return "claude";
}
