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
 * The ground-truth signal for case 3 is the client edit preamble that
 * PromptInput.tsx prepends when the user picks an element (CLIENT_PREAMBLE_MARKER,
 * "Target element:"). Its presence forces the Claude edit branch, which already
 * pulls the referenced design in as reference context (geometry + component
 * identities + ground-truth PNG). Reference stays reference.
 *
 * Pure — no I/O, no subprocess. Unit-tested in
 * __tests__/server/figma/turnRouting.test.ts.
 */
import { CLIENT_PREAMBLE_MARKER } from "../editContext";

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

/** True when the prompt is a scoped edit of an already-picked element. */
export function isScopedEditTurn(prompt: string): boolean {
  return typeof prompt === "string" && prompt.includes(CLIENT_PREAMBLE_MARKER);
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
