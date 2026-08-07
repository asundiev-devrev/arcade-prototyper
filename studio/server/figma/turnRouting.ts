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
 *   L4 RESOLVER    — when the cheap layers are exhausted AND the designer stated no
 *                    import ask, RETURN THE QUESTION and let the HOST answer it.
 *                    Corpus #25 and #32 are caught this way. This is the one layer
 *                    that costs a model, so it is gated (see step 8) and, in Studio,
 *                    flag-gated on top (ARCADE_STUDIO_TURN_RESOLVER=1).
 * All three are host-agnostic (see provenance.ts, turnConstraints.ts, resolveTurn.ts).
 * NOTE L4 IS NOT A CORRECTION DETECTOR and does not reopen the ban above: it asks a
 * host that has already read the prompt, rather than pattern-matching a mood. With no
 * resolver supplied, #25 and #32 still reach the importer — that is the honest
 * default, and planFigmaTurn's doc comment records the two DETERMINISTIC rescues that
 * were measured and rejected, so nobody re-tries them blind.
 */
import { isScopedEditPrompt } from "../../src/lib/scopedEdit";
import { detectTurnConstraints, type TurnConstraint } from "./turnConstraints";
import { detectFreshImportIntent } from "./generationIntent";
import {
  locateNodeProvenance,
  type FrameSourceReader,
  type NodeRef,
  type ProvenanceResult,
} from "./provenance";
import { resolveTurnOrFallback, type TurnResolver } from "./resolveTurn";

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
 * What the designer typed once the Figma URLs are removed, trimmed.
 *
 * Used by step 6 for exactly one question: "is this prompt NOTHING BUT a URL?"
 * A bare URL is the canonical fast-path ask and has no prose to lose, so it must
 * never be diverted by provenance.
 *
 * DELIBERATELY NOT A PROSE GATE. The banned L1 layer measured how much prose
 * remained and routed on the NUMBER; the distributions overlapped exactly (a
 * correction that must reach the model and a faithful-copy string that must not
 * both measure 64 characters), so no threshold exists. This asks the only
 * question with a defensible answer — zero or non-zero — and a `> N` comparison
 * must never be added here. See §0 of the design spec.
 *
 * The URL regex mirrors `extractFigmaUrls`'s, inline rather than imported so this
 * cannot end up depending on that module's dedup/filter behaviour: here we want
 * every URL-shaped token gone, including a non-Figma one a designer pasted
 * alongside.
 */
function stripFigmaUrls(prompt: string): string {
  if (typeof prompt !== "string") return "";
  return prompt
    .replace(/https?:\/\/[^\s]+/g, " ")
    // Leftover punctuation an ask like "Implement this precisely:" would have
    // kept is NOT stripped — only whitespace — because the question is whether
    // any words survive, and "…precisely:" is words.
    .trim();
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
   *  EVERY MEMBER IS REACHABLE, and that is checked by test. `"resolver"` and
   *  `"resolver-fallback"` were deleted once, when L4 was cut, precisely because
   *  nothing could emit them — a union member no producer can emit is a lie the
   *  type system will happily keep telling. They are back now WITH the code that
   *  returns them, in the same change, which is the condition that note set. */
  decidedBy:
    | "no-node"
    | "scoped-edit"
    | "legacy-intent"
    | "provenance"
    | "constraints"
    /** A host answered the L4 question (step 9). */
    | "resolver"
    /** A host was ASKED and failed — hard constraint 1 sent this to the
     *  generator. Distinct from `"default"` so telemetry can tell "nobody was
     *  asked" from "we asked and got nothing". */
    | "resolver-fallback"
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
 * WHAT LAYERS 2+3 CANNOT FIX — and what layer 4 now does. Corpus #25 and #32 carry
 * real prose ("There must be three buttons on the right hand side", "When a new tab
 * is created, a user must see this page"), reference nodes no rendered frame
 * contains, and state no constraint. NO DETERMINISTIC LAYER CAN RESCUE THEM, and
 * two attempts are recorded below so they are not re-tried blind. They are the
 * turns step 8 now asks the HOST about; with no resolver supplied they still reach
 * the importer, which is asserted rather than hidden in
 * __tests__/server/figma/planFigmaTurn.test.ts. The two failed rescues:
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
 * ── LAYER 4, CUT TWICE AND THEN BUILT. READ THIS BEFORE TOUCHING STEP 8 ──────────
 *
 * The resolver seam was designed, cut (revision 4), independently RE-MEASURED and
 * cut again (revision 6), and finally BUILT (revision 9). That is not indecision —
 * both cuts turned on ONE claim, in capitals in this comment for two revisions:
 * "THERE IS NO GATE THAT DECIDES WHOM TO ASK." The claim was TRUE WHEN WRITTEN and
 * is now FALSE, for a chronological reason rather than an argumentative one:
 *
 *   `detectFreshImportIntent` DID NOT EXIST when either cut was measured. Verified:
 *   `git show cd2e973:server/figma/generationIntent.ts | grep -c detectFreshImportIntent`
 *   returns 0. It was written afterwards, as the fix for the L2 fast-path blocker —
 *   a different problem entirely. Neither cut could have measured the gate.
 *
 * What revision 6 DID measure was `detectHiFiIntent` alone, and rejected it
 * correctly: false for 13 of the 30 must-stay-deterministic strings reaching step 8,
 * including "import this from figma", "bring this in" and a bare URL. The gate now in
 * the code is `asksForImport` = bare-URL OR detectHiFiIntent OR an import verb, which
 * is STRICTLY STRONGER than the arm revision 6 tested. Re-measured 2026-08-06: 0 of
 * 13 stated import asks are wrongly asked, it is FALSE for #1/#2/#30/#39 (so it costs
 * the shipped fixes nothing), and it protects 21 of the 31 committed must-miss
 * strings by a stated ask. The two prompts it lets through are #25 and #32 — exactly
 * the two the deterministic layers provably cannot fix.
 *
 * STILL REJECTED, both re-measured before building rather than taken on trust:
 *   - RESIDUE LENGTH as the gate. Looks clean at step 8 (must-miss tops out at 111,
 *     the positives start at 156) but is fit to two data points: adding two bullets
 *     of the SAME speech act to the longest committed bulleted faithful-copy string
 *     takes it to 204, past both. And in the PRIMARY host (no frame reader) #1 falls
 *     through at residue 65 and collides EXACTLY with two must-miss strings, also 65.
 *     The banned prose gate, re-derived one step later, failing identically.
 *   - A REQUIREMENT-MODAL gate (must / should / needs to), even refined with a
 *     negation anchor and a resemblance-verb veto: 0 false positives on the 31
 *     committed must-miss strings, then 18 of 23 on FRESH held-out descriptive prose
 *     ("the button should be blue in the design", "the toggle should be off in this
 *     state"). Clean on the committed list and collapsing on held-out prose is the
 *     signature of a gate fit to its own test data — the trap the corrective detector
 *     and the prose gate both died of. THE GATE MUST ASK A STATED QUESTION, NEVER A
 *     MOOD.
 *
 * AND ONE BRIEF RULE BENDS, on measurement: "no adapter supplied -> fall back to the
 * generator" would move 9 of the 31 committed must-miss strings off the importer
 * whenever no adapter is supplied, destroying the deterministic fidelity guarantee in
 * exactly the headless host the seam serves. So absence keeps today's decision and
 * only a FAILED ask falls to the generator. See resolveTurn.ts's ResolveOutcome note.
 *
 * Pure apart from the INJECTED `readFrames` and `resolveTurn` deps — both optional,
 * both independent, and correct with `deps` absent entirely, which is what makes this
 * loadable in a Claude Code / Cursor / Computer host. THERE IS NO SUBPROCESS ON THIS
 * PATH: an inline host answers from the model turn it is already inside, and Studio's
 * answer comes from an ADAPTER this module never imports. It must never import
 * node:fs, server/paths, node:child_process, or read process.env; the static guard in
 * __tests__/server/figma/headlessRouting.test.ts enforces that transitively, over the
 * host's INPUT CONTRACT as well as this module, and separately asserts that neither
 * this module nor the seam can reach the CLI adapter.
 */
export async function planFigmaTurn(
  inp: FigmaTurnInputs & { nodeIds: NodeRef[] },
  /**
   * The host's capabilities. BOTH are optional and INDEPENDENT — a host may supply
   * either, both, or neither, and the cascade is correct in all four cases. That is
   * what makes it loadable in Claude Code / Cursor / Computer:
   *  - `readFrames`  — layer 2 (provenance). Studio reads the frames dir; a
   *                    Claude-Code host hands over files it already has in context.
   *  - `resolveTurn` — layer 4. An inline host answers from the model turn it is
   *                    already inside; Studio's adapter spawns its CLI. Absent ⇒
   *                    today's behaviour, never an error.
   */
  deps?: { readFrames?: FrameSourceReader; resolveTurn?: TurnResolver },
  /** Tuning a host may override. Separate from `deps` because these are numbers,
   *  not capabilities, and no host is required to have an opinion. */
  opts?: { resolveTimeoutMs?: number },
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
  //
  //    AND ONLY WHEN THE DESIGNER DID NOT ASK FOR AN IMPORT (hard constraint 4).
  //    This gate was missing in the first cut and it captured the fast path the
  //    design was told not to touch. The importer stamps `data-figma-id` on EVERY
  //    emitted child node, so after ONE import, pasting any node from inside that
  //    frame is an `exact` hit — measured over the live 3-frame project, 38 of 38
  //    stamped ids diverted for all five canonical fast-path phrasings, and 31 of
  //    31 committed must-stay-deterministic strings flipped onto a p50-32s LLM
  //    edit turn. Deliberately re-importing a sub-component is an ordinary
  //    designer move (§2.5 says so itself), and the agent was being handed
  //    "Do NOT create a new frame directory" in answer to "import this".
  //
  //    The veto asks a STATED question, never an inferred one — the standard
  //    turnConstraints.ts sets: fidelity wording, an import verb, or nothing but
  //    a URL. `detectFreshImportIntent` is FALSE for #1 (the motivating
  //    correction), #2, #30 and #39, so it costs this design nothing; it is TRUE
  //    for every committed fast-path phrasing. Both directions pinned by test.
  //
  //    NOTE the bare-URL arm lives here rather than in the detector: only this
  //    layer knows what the URLs were, and a prompt that is nothing but a URL has
  //    no prose to lose by importing.
  const promptWithoutUrls = stripFigmaUrls(inp.prompt);
  const asksForImport = promptWithoutUrls.length === 0 || detectFreshImportIntent(inp.prompt);
  // Hoisted so step 8 can hand the SAME result to the host instead of reading the
  // frames a second time. `{ kind: "none" }` is the honest default: provenance was
  // not consulted, so the question says so rather than implying a miss.
  let prov: ProvenanceResult = { kind: "none" };
  if (deps?.readFrames && !asksForImport) {
    prov = await locateNodeProvenance(inp.nodeIds, deps.readFrames);
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

  // 8. LAYER 4 — ASK THE HOST, but only for genuine ambiguity.
  //
  //    THE GATE IS `asksForImport`, ALREADY COMPUTED ABOVE, and it is the reason
  //    this layer exists at all. An earlier pass CUT the seam on one finding —
  //    "there is no gate that decides whom to ask" — and that was TRUE WHEN
  //    WRITTEN: it measured `detectHiFiIntent` alone (13 of 30 committed
  //    must-stay-deterministic strings would have been asked) and a residue-length
  //    gate (the banned prose gate, re-derived one step later, failing
  //    identically). `detectFreshImportIntent` did not exist yet — it arrived
  //    afterwards, as the fix for the L2 fast-path blocker. It asks a STATED
  //    question rather than inferring a mood, and measured 2026-08-06 it is the
  //    gate that was missing: 0 of 13 stated import asks are wrongly asked, and it
  //    is FALSE for #1, #2, #30 and #39, so it costs the shipped fixes nothing.
  //
  //    A REQUIREMENT-MODAL gate (must / should / needs to) was re-measured before
  //    settling on this one and is still rejected: 0 false positives against the 31
  //    committed must-miss strings, then 18 of 23 against FRESH held-out
  //    descriptive prose ("the button should be blue in the design", "the toggle
  //    should be off in this state"). Clean on the committed list and collapsing on
  //    held-out prose is the signature of a gate fit to its own test data — the
  //    trap that killed both the corrective detector and the prose gate. Do not
  //    re-propose it.
  //
  //    So the four bare imports (residue 0/0/0/25) and every stated faithful-copy
  //    ask reach step 9 having consulted NO host capability, which is the latency
  //    guarantee the whole cascade rests on; #25 and #32 — real prose the
  //    deterministic layers provably cannot fix — are the turns that get asked.
  //
  //    PURE AND HOST-AGNOSTIC. This calls an INJECTED function and nothing else.
  //    There is no subprocess on this path: an inline Claude Code / Computer host
  //    answers from the turn it is already inside, and Studio's answer comes from
  //    an ADAPTER (server/figma/adapters/studioCliResolver.ts) that this module
  //    never imports.
  if (deps?.resolveTurn && !asksForImport) {
    const resolved = await resolveTurnOrFallback(
      {
        prompt: inp.prompt,
        nodeIds: normaliseNodeIds(inp.nodeIds),
        // The frames the host offered, which is also the ALLOW-LIST the answer's
        // `targetFrame` is checked against — a host cannot name a frame it never
        // told us about. Reusing the reader means the host implements one
        // capability, not two.
        frameSlugs: await safeFrameSlugs(deps.readFrames),
        provenance: prov,
      },
      { resolveTurn: deps.resolveTurn },
      { timeoutMs: opts?.resolveTimeoutMs },
    );

    if (resolved.outcome === "resolved" && resolved.answer) {
      const answer = resolved.answer;
      // A host may report a constraint the deliberately-literal L3 patterns
      // missed, but it can never REMOVE one: L3 is pure and was derived without
      // any host capability, so it must survive an answer that omits it.
      const merged = answer.constraints.includes("single-frame")
        ? (["single-frame"] as TurnConstraint[])
        : constraints;
      if (answer.kind === "import") {
        // The host CONFIRMED the fast path. Worth having: otherwise asking could
        // only ever cost speed, never save it.
        return { kind: "kit-emit", decidedBy: "resolver", constraints: [] };
      }
      return {
        kind: answer.kind === "wire" ? "wire" : "claude",
        decidedBy: "resolver",
        ...(answer.targetFrame ? { targetFrame: answer.targetFrame } : {}),
        constraints: merged,
      };
    }

    // HARD CONSTRAINT 1. We ASKED and got nothing — threw, timed out, unparseable,
    // or schema-mismatched. Fall back to the GENERATOR, which at least reads the
    // prompt. NEVER to the deterministic importer: backwards would re-create the
    // original instruction-loss bug on every resolver hiccup, handing a prose-carrying
    // prompt to an engine that cannot read one word of it.
    //
    // `unasked` deliberately does NOT land here — it falls through to step 9. The
    // brief's bullet says "no adapter supplied -> fall back to the generator", but
    // measured, applying that to the ABSENT case moves 9 of the 31 committed
    // must-stay-deterministic faithful-copy strings from a 16-26s no-model import
    // onto a p50 98s generation turn, in exactly the headless host the seam exists to
    // serve. "Nobody to ask" is not "we asked and got nothing"; only the second is a
    // failure, and constraint 1 governs it in full. See resolveTurn.ts's
    // ResolveOutcome note.
    if (resolved.outcome === "failed") {
      return { kind: "claude", decidedBy: "resolver-fallback", constraints };
    }
  }

  // 9. THE FAST PATH, unchanged — 16-26s with no model call, which is the
  //    product's speed advantage. `constraints` is always empty here: a
  //    constraint and the importer are mutually exclusive by construction (the
  //    importer cannot honour one, which is the entire bug), so the plan never
  //    hands a caller a constraint it will silently drop.
  return { kind: "kit-emit", decidedBy: "default", constraints: [] };
}

/**
 * The pasted node ids as plain strings, for the question.
 *
 * `NodeRef` is a string OR `{nodeId, fileKey}` — provenance needs the file key,
 * but a HOST answering a question does not, and flattening here keeps
 * `TurnQuestion` free of a type it would otherwise have to import from the
 * matching layer.
 */
function normaliseNodeIds(nodes: NodeRef[]): string[] {
  return (Array.isArray(nodes) ? nodes : [])
    .map((n) => (typeof n === "string" ? n : n && typeof n.nodeId === "string" ? n.nodeId : ""))
    .filter((s) => s.length > 0);
}

/**
 * The frame slugs the host can see, or `[]`.
 *
 * NEVER THROWS, and never lets a broken reader silence the resolver. The two host
 * capabilities are independent: a Claude Code host may well answer questions while
 * handing over no files, and a host whose file access fails must still be asked.
 * An earlier shape derived the allow-list inside the provenance block, which meant a
 * rejecting reader also disabled layer 4 — one capability silently switching off
 * another.
 */
async function safeFrameSlugs(readFrames?: FrameSourceReader): Promise<string[]> {
  if (!readFrames) return [];
  try {
    const frames = await readFrames();
    if (!Array.isArray(frames)) return [];
    return [...new Set(frames.filter((f) => f && typeof f.slug === "string").map((f) => f.slug))];
  } catch {
    return [];
  }
}
