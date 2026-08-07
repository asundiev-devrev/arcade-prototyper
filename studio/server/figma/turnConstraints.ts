/**
 * Named, closed requirements a designer states about a Figma turn.
 *
 * Today there is exactly one: "keep this in ONE frame". It exists because of a
 * measured failure. In the 2026-08-06 designer session the prompt read
 * `DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!` (corpus #30) and the turn routed
 * to the deterministic importer, which has NO LLM and so cannot read one word of
 * it — the importer stamped a separate frame, and the designer's very next turn
 * (#31) is them explaining the failure back to us. Same session, corpus #2 says
 * `don't separate these screens onto multiple frames, the transition must happen
 * within this single frame` and templates/CLAUDE.md.tpl tells the generator that
 * "pressing Save goes to the confirmation" is a cross-frame <FrameLink> signal —
 * i.e. the template actively contradicts the designer.
 *
 * WHY A KEYWORD LIST IS LEGITIMATE HERE, WHEN CORRECTION KEYWORDS ARE BANNED.
 * This looks like the thing that was just removed from turnRouting.ts (case 4),
 * so the distinction has to be stated rather than assumed:
 *
 *   - A CORRECTION is a SPEECH ACT. The same complaint can be phrased with no
 *     shared vocabulary at all — "There's no difference", "revert that change",
 *     "repair the broken frame", "Check your import". A keyword detector scored
 *     27% recall on the 15 labelled corrections in the corpus AND fired on
 *     descriptive faithful-copy prose. It was deleted. Do not re-add it.
 *   - A SINGLE-FRAME CONSTRAINT is a NAMED, CLOSED REQUIREMENT. Designers state
 *     it literally, and usually emphatically, because they are pre-empting a
 *     specific failure they have already seen. Verified across all 67 corpus
 *     prompts: every statement of it is literal, and the list below fires on
 *     exactly #2, #30, #39 — no false positives anywhere in the corpus, and none
 *     across the 38-string committed must-stay-deterministic set.
 *
 * A future reviewer should hold this list to that same standard: it may only
 * contain patterns that STATE the requirement, never patterns that INFER a mood.
 * That standard has already caught one violation in this very file — see
 * NOT_NEGATED below for the bare noun phrase that shipped in the first cut and
 * inverted 8 of 8 multi-frame asks.
 *
 * Two structural (non-vocabulary) alternatives were measured during
 * implementation and rejected — a numbered-list detector (2 false positives in
 * 46: a designer describing a stepper "1. Account 2. Billing" is
 * indistinguishable from one issuing instructions) and a requirement-modal
 * detector (must/should/needs to: 0 false positives on the committed lists, then
 * 19 of 19 on fidelity hedges like "it should look exactly like this"). The
 * design spec records both.
 *
 * Pure — no I/O, no subprocess, no Studio path, no process.env. This module is
 * BRAIN: it must run identically inside Studio, Claude Code, Cursor, or Computer.
 * Unit-tested in __tests__/server/figma/turnConstraints.test.ts.
 */

/** The closed set of constraints a turn can carry. Deliberately one-valued —
 *  growing it needs corpus evidence per value, not a guess. */
export type TurnConstraint = "single-frame";

/**
 * macOS substitutes a typed apostrophe with a RIGHT SINGLE QUOTATION MARK
 * (U+2019) by default, and 5 of the 67 corpus prompts contain one — including
 * #39's "don't do that". Without this normalisation the patterns below are
 * curly-quote-blind, so the identical sentence would route differently depending
 * on the designer's keyboard settings. Cheapest possible fix, applied once.
 */
function normaliseApostrophes(s: string): string {
  return s.replace(/[‘’ʼ]/g, "'");
}
// NB: apostrophes are the ONLY thing normalised, deliberately. An earlier draft
// also stripped "non-word" characters, which deletes Cyrillic and Slovenian
// wholesale — a designer writing "не разделяй эти экраны — keep everything on a
// single frame" would have had half the sentence erased before matching. We fail
// to UNDERSTAND non-Latin prose (these patterns are English); we must never
// MANGLE it. Tested with Russian and Slovenian input.

/**
 * A negation appearing BEFORE a positive statement, within the same sentence and
 * a bounded span. Prefixed to every positive pattern below as a lookbehind.
 *
 * This exists because the first cut of this list contained a bare NOUN PHRASE —
 * `/\b(?:same|one|single)\s+frame\b/i` — which states nothing; it just spots two
 * words. Measured (adversarial review, 2026-08-06) it fired on 8 of 8 prompts
 * asking for the OPPOSITE: "one frame per step", "one frame per screen", "not the
 * same frame as the form", "Don't keep this in one frame". Each then received the
 * maximally forceful directive below ("This overrides every other instruction
 * about frames"), i.e. a hard override of what the designer had just typed.
 *
 * INVERTING an instruction is strictly worse than missing it: the generator obeys
 * it, confidently, and the designer cannot see why. So the noun phrase was
 * deleted (it was the sole match for no corpus prompt — #2 is also caught by two
 * other patterns) and every surviving pattern carries this anchor, so a negated
 * sentence cannot reach the directive.
 *
 * 24 characters of span is enough for the real shapes ("do not keep it in…",
 * "don't put it within…", "NOT be in the same frame") and short enough that a
 * negation about some earlier clause cannot suppress a genuine later statement.
 */
const NOT_NEGATED = String.raw`(?<!\b(?:don'?t|do\s+not|does\s+not|doesn'?t|never|not|no)\b[^.!?]{0,24})`;

/**
 * Statements of "keep this in one frame".
 *
 * Every span is `[^.!?]`-bounded so a pattern cannot bridge two sentences. That
 * discipline was learned the hard way by the interaction detector, whose first
 * cut used an unbounded `[^.]*` and matched a trigger on one bullet against a
 * result several bullets later (see the `[^.\n]*` comment in src/lib/figmaUrl.ts).
 *
 * The first two patterns are ALREADY negation-shaped ("don't … separate") — the
 * negation is what makes them a single-frame ask — so they take no anchor. The
 * rest are positive statements and every one of them does.
 */
const SINGLE_FRAME_PATTERNS: RegExp[] = [
  // "DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!" (corpus #30)
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+frame/i,
  // "don't separate these screens onto multiple frames" (corpus #2)
  /\b(?:don'?t|do\s+not|never)\b[^.!?]{0,40}\bseparate\s+(?:these|those|the)?\s*screens?/i,
  // "the transition must happen within this single frame" (corpus #2)
  new RegExp(`${NOT_NEGATED}\\b(?:within|in|on)\\s+(?:this|the|one|a)\\s+single\\s+frame\\b`, "i"),
  // "keep it in the same frame" / "keep everything on a single frame". The second
  // is a committed must-miss string for a DIFFERENT detector where it must not
  // fire; here it SHOULD — the designer did state the constraint — and it is the
  // one accepted routing flip in this design. Pinned by test, not left to be
  // re-narrowed. `all` is in the subject list so "keep this all in one frame"
  // reads as one statement rather than needing a second pattern.
  new RegExp(
    `${NOT_NEGATED}\\bkeep\\s+(?:it|this|everything|them|both|all)\\b[^.!?]{0,30}\\b(?:one|single|same)\\s+frame\\b`,
    "i",
  ),
  // "it should open as a tab in the main frame" (corpus #39) — a tab inside an
  // existing frame is the same requirement stated positively.
  new RegExp(`${NOT_NEGATED}\\bas\\s+a\\s+(?:new\\s+)?tab\\b[^.!?]{0,60}\\bmain\\s+frame\\b`, "i"),
];

/**
 * The constraints this prompt states. Returns `[]` for anything that states
 * none, which is the overwhelming majority of turns.
 *
 * NOTE FOR CALLERS: this is deliberately NOT scoped to Figma turns — it is a
 * pure prompt property. The Figma scope guard lives in the cascade
 * (planFigmaTurn returns before constraints are consulted when there is no Figma
 * node), because a gate written as `kind === "claude" && hasConstraint` also
 * fires on ordinary non-Figma prompts. That mistake already shipped once: a
 * designer typing "New screen: an error state with a Try again button" was told
 * "Do NOT create a new frame directory".
 */
export function detectTurnConstraints(prompt: string): TurnConstraint[] {
  if (typeof prompt !== "string" || !prompt) return [];
  const s = normaliseApostrophes(prompt);
  return SINGLE_FRAME_PATTERNS.some((re) => re.test(s)) ? ["single-frame"] : [];
}

/**
 * The directive text for a single-frame turn.
 *
 * It has to OVERRIDE rather than merely disagree with the project template:
 * CLAUDE.md.tpl line 545 tells the generator to create frames for new steps
 * without asking, and line 554 lists "pressing Save goes to the confirmation" as
 * a <FrameLink> signal — which is verbatim the shape of corpus #2, the prompt
 * that failed. Prompt-region text is obeyed harder than CLAUDE.md (the reason
 * server/editContext.ts exists), so this is the primary mechanism and the
 * template edit is belt-and-braces for hosts that never assemble it.
 */
export function buildSingleFrameDirective(): string {
  return [
    "<single_frame_constraint>",
    "The designer explicitly asked for this to stay in ONE frame. This overrides every other",
    "instruction about frames, including the flow-splitting and <FrameLink> rules in CLAUDE.md.",
    "",
    "- Do NOT create a new frame directory. Do NOT add a second frame for the second state,",
    "  screen, or step — even when the request describes a transition between two screens.",
    "- Build every referenced state INSIDE the existing frame, switched by React state",
    "  (useState + conditional render / CSS transition). A click that \"goes to\" another screen",
    "  is an in-frame state change here, NOT a <FrameLink>.",
    "- Do NOT use <FrameLink> on this turn.",
    "- If you genuinely cannot fit it in one frame, say so under ### Deviations and still do not",
    "  create the second frame.",
    "</single_frame_constraint>",
  ].join("\n");
}
