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
 *
 * ── 2026-08-06: case 4 is now PARTLY fixed, by planFigmaTurn below ────────────
 * Not by detecting corrections (still banned, for the reasons above) but by two
 * deterministic layers that ask checkable questions instead of guessing at mood:
 *   L2 PROVENANCE  — is the pasted node ALREADY in a frame we rendered? Then this
 *                    turn is an EDIT of that frame, and we know its name. Corpus
 *                    #1, the motivating complaint, is caught this way: it pasted a
 *                    node frame 01-figma-5678-118876 already contained.
 *   L3 CONSTRAINTS — did the designer state a named, closed requirement ("don't
 *                    separate these screens")? Corpus #30 is caught this way.
 * Both are host-agnostic (see server/figma/provenance.ts and turnConstraints.ts).
 * Corpus #25 and #32 remain UNFIXED — see planFigmaTurn's doc comment for the two
 * rescues that were measured and rejected, so nobody re-tries them blind.
 */
import { isScopedEditPrompt } from "../../src/lib/scopedEdit";
import { detectTurnConstraints, type TurnConstraint } from "./turnConstraints";
import {
  locateNodeProvenance,
  type FrameSourceReader,
  type NodeRef,
} from "./provenance";

export type { TurnConstraint };

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

/** The routing decision, with everything the caller needs to act on it. */
export interface FigmaTurnPlan {
  kind: FigmaTurnKind;
  /** Set only when provenance NAMED a frame. Never guessed, never set when
   *  provenance was ambiguous. */
  targetFrame?: string;
  /** Set only when provenance was ambiguous — context for the prompt region, so
   *  the agent can pick rather than us picking wrong. */
  frameCandidates?: string[];
  constraints: TurnConstraint[];
  /** Which layer settled it. Narration, telemetry, and debugging — when a
   *  designer says "why did it do that", this is the answer.
   *
   *  EVERY MEMBER IS REACHABLE, and that is checked by test. The two variants
   *  `"resolver"` / `"resolver-fallback"` used to sit here, left behind when the
   *  L4 resolver seam was cut (§0). Nothing could emit them, so they were a
   *  standing invitation for a caller to branch on a state that cannot occur —
   *  and worse, they advertised a host capability this module does not have.
   *  A union member no producer can emit is a lie the type system will happily
   *  keep telling, so they are deleted rather than commented out. If L4 is ever
   *  revived on real evidence, add the member back WITH the code that returns it,
   *  in the same commit. */
  decidedBy:
    | "no-node"
    | "scoped-edit"
    | "legacy-intent"
    | "provenance"
    | "constraints"
    | "default";
}

/**
 * The cheapest-first cascade. An async sibling of `classifyFigmaTurn`, which
 * stays pure and unchanged for its existing call sites.
 *
 * ORDERING IS THE WHOLE DESIGN, and getting it wrong is not a style question —
 * an earlier draft put the new layers ABOVE `wantsGeneration` and, measured
 * against the committed test corpus, sent 11 of 17 build-intent prompts BACKWARDS
 * to the LLM-less importer. That would have re-created the exact instruction-loss
 * bug this cascade exists to fix, on a class of prompt that works correctly today.
 * So:
 *
 *   steps 1-5 reproduce today's three-way decision EXACTLY
 *   steps 6-8 only subdivide the ONE branch today calls kit-emit unconditionally
 *
 * The new layers can therefore only ever REMOVE turns from the deterministic
 * importer, never add one. That is the invariant to preserve when editing this
 * function, and __tests__/server/figma/planFigmaTurn.test.ts pins it with the
 * committed must-generate, wire, and must-stay-deterministic string sets.
 *
 * WHAT LAYERS 2+3 CANNOT FIX. Corpus #25 and #32 carry real prose ("There must be
 * three buttons on the right hand side", "When a new tab is created, a user must
 * see this page"), reference nodes no rendered frame contains, and state no
 * constraint — so they still reach the importer and their prose is still
 * discarded. This is asserted rather than hidden, in
 * __tests__/server/figma/planFigmaTurn.test.ts. Two deterministic rescues were
 * measured on 2026-08-06 and both failed — recorded here so they are not re-tried
 * blind:
 *   - a PROSE-LENGTH gate. Long faithful-copy prose ("The spinner animates in the
 *     prototype but keep it static for now, and the chart animates on load in
 *     Figma — ignore both, just draw the frame as it is") measures a residue of
 *     141 characters, which is EXACTLY #25's and #32's. Not overlapping —
 *     identical. No threshold at any value separates them, because length
 *     measures verbosity and the decision needs intent.
 *   - a REQUIREMENT-MODAL detector (must / should / needs to). Zero false
 *     positives across the committed must-miss lists, which looked promising,
 *     then 19 of 19 false positives on fidelity hedges: "it should look exactly
 *     like this", "this must look exactly like the figma", "needs to look exactly
 *     like the design". In designer prose "should" usually means "the copy should
 *     be faithful", not "here is a requirement" — the same speech-act-versus-
 *     vocabulary trap the corrective detector died of, in a grammatical costume.
 * Fixing them needs a model in the loop, and a host-answered RESOLVER SEAM for
 * exactly that was designed, built, and then CUT — deliberately, on measurement,
 * not for lack of time. Running the cascade over the 13 corpus Figma prompts with
 * the resolver present versus absent gave "prompts whose KIND differs: 0": every
 * prompt that reached it already needed the generator, which is precisely what the
 * no-resolver fallback hands it. It was the largest part of the design and bought
 * nothing, while adding a failure surface and a latency surface to every non-bare
 * Figma turn. Add it back when a REAL prompt needs a targetFrame provenance cannot
 * name, with that prompt as the evidence. The `decidedBy: "default"` exit at step 8
 * is where it plugs in, and the only place it could — which is the point.
 *
 * RE-MEASURED 2026-08-06 (task 2 was briefed to build the seam; it measured first).
 * The cut holds, on a stronger argument than "the outcome is unchanged": THERE IS
 * NO GATE THAT DECIDES WHOM TO ASK. Exactly six prompts reach step 8, and they
 * split 4 bare imports (residue 0, 0, 0, 25 — must stay on the 16-26s no-model
 * path) against 2 that want a model (#25=156, #32=169). Both candidate gates fail:
 *   - RESIDUE LENGTH looks clean at step 8 (must-miss tops out at 111, the two
 *     positives start at 156) but is fit to two data points — adding two more
 *     bullets of the SAME speech act to the longest committed bulleted faithful-copy
 *     string takes it to 204, past both. And in the PRIMARY host (no frame reader,
 *     the bare Claude Code case) #1 falls through here at residue 65 and collides
 *     EXACTLY with two committed must-miss strings, also 65. The banned prose gate,
 *     re-derived one step later, failing identically.
 *   - FIDELITY VOCABULARY (detectHiFiIntent as ask/don't-ask) is false for 13 of the
 *     30 must-miss strings that reach here, including "import this from figma" and a
 *     bare URL.
 * And asking without a gate is not a small cost: hard constraint 1 (an unanswered
 * question falls back to the GENERATOR) would convert all four bare imports plus 30
 * must-miss strings from a 16-26s import into a p50 98s build turn whenever no
 * adapter is supplied — i.e. THE SEAM'S OWN FALLBACK RULE DESTROYS THE DETERMINISTIC
 * FIDELITY GUARANTEE IN EXACTLY THE HEADLESS HOST IT EXISTS TO SERVE. A resolver is
 * only safe behind a gate, and the gate is the part that does not exist. Anyone
 * reviving L4 must bring the gate, not just the seam.
 *
 * Pure apart from the single INJECTED `readFrames` dep, and correct with `deps`
 * absent entirely — that is what makes it loadable in a Claude Code / Cursor /
 * Computer host. It must never import node:fs, server/paths, node:child_process,
 * or read process.env; the static guard in
 * __tests__/server/figma/headlessRouting.test.ts enforces that transitively, over
 * the host's INPUT CONTRACT as well as this module.
 */
export async function planFigmaTurn(
  inp: FigmaTurnInputs & { nodeIds: NodeRef[] },
  deps?: { readFrames?: FrameSourceReader },
): Promise<FigmaTurnPlan> {
  // 1. THE SCOPE GUARD. Every prompt with no Figma URL leaves here, before
  //    constraints are even computed. This is structural on purpose: a gate
  //    written as `kind === "claude" && hasConstraint` also fires on ordinary
  //    prompts, and that mistake already shipped — a designer typing "New screen:
  //    an error state with a Try again button" was told "Do NOT create a new frame
  //    directory". 54 of the 67 corpus prompts take this path.
  if (!inp.hasFigmaNode) {
    return { kind: "claude", decidedBy: "no-node", constraints: [] };
  }

  // 2. A right-click scoped edit is ALREADY an edit of a known element; the URLs
  //    are reference material. Layering a frame directive on top would
  //    double-instruct, and provenance would be answering a question nobody
  //    asked, so the deps are deliberately not consulted.
  if (isScopedEditTurn(inp.prompt)) {
    return { kind: "claude", decidedBy: "scoped-edit", constraints: [] };
  }

  // 3. Constraints are pure and free, so derive them ONCE here and let every
  //    later exit carry them. They were derived without the reader and must
  //    survive a reader failure.
  const constraints = detectTurnConstraints(inp.prompt);

  // 4-5. TODAY'S ROUTING, PRESERVED VERBATIM AND FIRST. Both branches now carry
  //      the constraints, which is the only change: #2 already reached the
  //      generator but nothing had told it to stay in one frame.
  //
  //      A wire turn carrying `single-frame` is NOT a contradiction, and a review
  //      that read it as one was mistaken — checked against the branch itself. The
  //      wire branch imports URL#1 as a frame and URL#2 into the SAME frame dir as
  //      a sibling `Overlay.tsx` (chat.ts:1722 passes `entryFileName`), so it
  //      produces ONE frame, and its wiring prompt already states "Do NOT create a
  //      new frame. Do NOT move the overlay into its own frame."
  //      (chat.ts:1782). So the constraint is satisfied BY CONSTRUCTION on this
  //      exit and needs no directive; it rides along for narration and telemetry.
  //      Pinned by test so the next reader does not have to trace three files.
  if (inp.hasInteractionIntent && inp.figmaUrlCount >= 2) {
    return { kind: "wire", decidedBy: "legacy-intent", constraints };
  }
  if (inp.wantsGeneration) {
    return { kind: "claude", decidedBy: "legacy-intent", constraints };
  }

  // ── Below here, today's router says "kit-emit" unconditionally. Everything
  //    that follows can only take turns OFF the importer, never put one on it. ──

  // 6. PROVENANCE. Needs the injected reader; a host that supplies none simply
  //    gets today's behaviour rather than an error.
  //
  //    ONLY `exact` and `nested` divert. `origin` — "the designer re-pasted the
  //    URL this frame was built from" — is precisely what a plain RE-IMPORT looks
  //    like, and diverting on it would break the deterministic fast path to fix
  //    nothing: measured across the corpus, `origin` fires on #0 (the verbatim
  //    bare "Implement this precisely: <url>", which MUST stay on the importer)
  //    and #2 (which already escapes via interaction intent + a constraint). It is
  //    the sole escape for zero prompts. See matchOrigin's note in provenance.ts.
  if (deps?.readFrames) {
    const prov = await locateNodeProvenance(inp.nodeIds, deps.readFrames);
    const divertible = prov.via === "exact" || prov.via === "nested";
    if (divertible && prov.kind === "ambiguous") {
      // We know it is an edit of something we already rendered; we do not know of
      // what. Leave the importer, but name no frame.
      return {
        kind: "claude",
        decidedBy: "provenance",
        frameCandidates: prov.candidates,
        constraints,
      };
    }
    if (divertible && prov.frameSlug) {
      return {
        kind: "claude",
        decidedBy: "provenance",
        targetFrame: prov.frameSlug,
        constraints,
      };
    }
  }

  // 7. A stated constraint the importer provably cannot honour.
  if (constraints.length > 0) {
    return { kind: "claude", decidedBy: "constraints", constraints };
  }

  // 8. THE FAST PATH, unchanged — 16-26s with no model call, which is the
  //    product's speed advantage. `constraints` is always empty here: a
  //    constraint and the importer are mutually exclusive by construction (the
  //    importer cannot honour one, which is the entire bug), so the plan never
  //    hands a caller a constraint it will silently drop.
  return { kind: "kit-emit", decidedBy: "default", constraints: [] };
}
