/**
 * Render-verify policy: extract the visual property the USER asked for (from
 * their prompt), reconcile it against the frame's real computed styles (a
 * digest), and — on a UNANIMOUS clear contradiction — produce a corrective
 * prompt. Pure; mirrors visualNoOpRetry.ts. See the spec.
 *
 * v1 covers ORIENTATION only (the repro + the highest-value swallow). Colour /
 * size are extension rows, deliberately deferred to keep the false-mismatch
 * surface tiny — a false "this is wrong" over a correct render is the cardinal
 * sin, so reconcile fires only when EVERY candidate contradicts the ask.
 */
import type { RenderDigest } from "../src/frame/frameDigest";

export type RequestedProperty = { property: "orientation"; expected: "vertical" | "horizontal" };
export type Mismatch = { property: string; expected: string; rendered: string };

// The orientation words. `directive` forms (a verb phrase — "stack them", "in a
// column") are unambiguous layout asks. `bare` forms (the adjective "vertical"/
// "horizontal") need false-fire guards below because they also appear as
// adjectives on a noun ("the vertical scrollbar") or under negation.
const VERTICAL_DIRECTIVE = /\b(stacked?|stack them|in a column|as a column|column layout)\b/i;
const HORIZONTAL_DIRECTIVE = /\b(side by side|side-by-side|in a row|as a row|row layout)\b/i;
const VERTICAL_BARE = /\b(vertical|vertically)\b/i;
const HORIZONTAL_BARE = /\b(horizontal|horizontally)\b/i;
// A bare orientation word is NOT a directive when negated before it, or when it
// adjectivally qualifies a following concrete noun ("vertical scrollbar/divider
// /line/rule/scroll"). Either → drop the extraction (cardinal-sin bias).
const NEGATION = /\b(don'?t|do not|not|never|avoid|without|keep (it|them) from|stop)\b/i;
const ADJECTIVE_NOUN = /\b(vertical|horizontal)\s+(scroll\w*|divider|separator|line|rule|bar|axis|gridlines?)\b/i;

/** Extract requested visual properties from the USER'S prompt. v1: orientation.
 *  Conservative — no match / both match / negated / adjectival → nothing (bias
 *  to silence: a false "this is wrong" over a correct render is the cardinal sin). */
export function extractRequestedProperties(prompt: string): RequestedProperty[] {
  const p = prompt ?? "";
  // Negation suppresses EVERYTHING (directive or bare) — "do not stack them" /
  // "don't make it vertical" must extract nothing (cardinal-sin bias). A bare
  // adjective is additionally suppressed when it qualifies a concrete noun
  // ("the vertical scrollbar").
  const negated = NEGATION.test(p);
  const bareSafe = !negated && !ADJECTIVE_NOUN.test(p);
  const v = (!negated && VERTICAL_DIRECTIVE.test(p)) || (bareSafe && VERTICAL_BARE.test(p));
  const h = (!negated && HORIZONTAL_DIRECTIVE.test(p)) || (bareSafe && HORIZONTAL_BARE.test(p));
  if (v === h) return []; // neither, or both (ambiguous) → no claim
  return [{ property: "orientation", expected: v ? "vertical" : "horizontal" }];
}

/** Normalize a computed flex-direction to "vertical" | "horizontal" | null. */
function directionOf(styles: Record<string, string>): "vertical" | "horizontal" | null {
  const fd = (styles.flexDirection ?? "").trim().toLowerCase();
  if (fd === "column" || fd === "column-reverse") return "vertical";
  if (fd === "row" || fd === "row-reverse") return "horizontal";
  return null; // ambiguous / unmeasured → judged as no-contradiction
}

/**
 * Reconcile requested properties against the digest. Returns a mismatch ONLY
 * when there is ≥1 relevant candidate AND every relevant candidate CLEARLY
 * contradicts the ask. Any ambiguity → no mismatch (cardinal-sin bias).
 */
export function reconcile(requested: RequestedProperty[], digest: RenderDigest): Mismatch[] {
  const out: Mismatch[] = [];
  for (const req of requested) {
    if (req.property !== "orientation") continue;
    // Candidates for an orientation claim: the data-orientation carriers.
    const carriers = digest.elements.filter((e) => e.dataOrientation !== null);
    if (carriers.length === 0) continue; // nothing to judge
    const directions = carriers.map((c) => directionOf(c.styles));
    // Unanimous clear contradiction: every carrier resolves to a direction AND
    // it's the opposite of what was asked. A single ambiguous/agreeing carrier
    // aborts the mismatch (err toward silence).
    const allContradict =
      directions.every((d) => d !== null) &&
      directions.every((d) => d !== req.expected);
    if (allContradict) {
      out.push({
        property: "orientation",
        expected: req.expected,
        rendered: req.expected === "vertical" ? "horizontal" : "vertical",
      });
    }
  }
  return out;
}

export function RENDER_VERIFY_RETRY_PROMPT(m: Mismatch): string {
  if (m.property === "orientation") {
    return (
      `The user asked for the toggle groups to be ${m.expected}, but they render ${m.rendered} — ` +
      `the control's direction computes to the opposite and the \`orientation\` prop isn't changing the layout. ` +
      `Make it actually render ${m.expected} (e.g. pass \`className="flex-col"\` to the control itself for vertical, ` +
      `or rebuild it as stacked rows), or tell the user plainly that this control renders ${m.rendered} and you ` +
      `couldn't change it. Never report a visual result the render doesn't show. ` +
      `Keep the response shape: a one-sentence summary plus a ### Deviations section.`
    );
  }
  return (
    `The user's requested change (${m.property}: ${m.expected}) is not reflected in the render (${m.rendered}). ` +
    `Achieve it a different way so it actually renders, or say plainly you couldn't. Never report a visual result the render doesn't show.`
  );
}

const ranForTurn = new Set<string>();
export function renderVerifyAlreadyRan(userTurnId: string): boolean {
  return ranForTurn.has(userTurnId);
}
export function markRenderVerifyRan(userTurnId: string): void {
  ranForTurn.add(userTurnId);
}
