/**
 * Turn a routing PLAN into the words the model actually reads.
 *
 * WHY THIS IS ITS OWN MODULE, AND WHY IT IS BRAIN. The cascade in turnRouting.ts
 * is host-agnostic, but a plan is useless on its own: something has to translate
 * `{ kind:"claude", constraints:["single-frame"] }` into prompt text, decide the
 * ORDER the directives appear in, and decide which of the existing directives it
 * conflicts with. Until this module existed that translation lived inside
 * server/middleware/chat.ts, whose value-import closure is 61 modules and reaches
 * server/paths.ts, claudeBin.ts and awsPreflight.ts (child_process). So a Claude
 * Code / Cursor / Computer host got a CORRECT plan for corpus #30 — the live
 * 2026-08-06 failure this branch exists for — and had nowhere to act on it. The
 * fix was fixed inside the .dmg only, which is the one host the designers do not
 * use.
 *
 * Everything here is therefore pure string work with no reason to live in Vite
 * middleware: the directive TEXT, the decision to apply it, and the ordering.
 * Studio's chat.ts only appends what these functions return. A foreign host does
 * the same, with the same words, in whatever way it assembles its prompt.
 *
 * Must not import node:fs, server/paths, node:child_process, or read process.env
 * — the static guard in __tests__/server/figma/headlessRouting.test.ts enforces
 * that transitively, and this module is listed there as a brain entrypoint.
 *
 * Unit-tested in __tests__/server/figma/turnDirectives.test.ts; wired end-to-end
 * through the real handler in __tests__/server/middleware/chat-single-frame.test.ts.
 */
import { buildSingleFrameDirective, type HostVocabulary } from "./turnConstraints";
import type { FigmaTurnPlan } from "./turnRouting";

export type { HostVocabulary };

/**
 * Name the frame this turn edits, when provenance identified exactly one.
 *
 * This is a much stronger statement than the generic `<edit_context>` block
 * (server/editContext.ts), which only lists every frame in the project and says
 * "probably an edit". Here we know WHICH frame, from a filesystem fact — the
 * pasted node carries a `data-figma-id` attribute that frame already stamped —
 * so the agent should not have to infer it from chat history.
 *
 * NB: this deliberately does NOT go through `prependEditContext`. That function's
 * first line is `if (!frameSlugs.length) return prompt;`, so on a project whose
 * frame list has not refreshed yet, a target frame we worked to determine would be
 * silently dropped (design spec §5.4). Emitting it as its own directive makes it
 * independent of the frame list entirely.
 */
function buildTargetFrameDirective(slug: string, vocab: HostVocabulary): string {
  const container = vocab.container ?? "frame";
  // `frames/<slug>/` is Studio's on-disk layout, so the LOCATION is stated only in
  // Studio's default vocabulary. A foreign host that passes its own `container`
  // noun gets the behavioural rule ("edit what already renders this") without a
  // path that does not exist in its repo — see HostVocabulary for the measurement.
  const where = vocab.container
    ? `- Edit the file(s) that already render \`${slug}\` in place.`
    : `- Edit the files in \`frames/${slug}/\` in place.`;
  return [
    "<target_frame>",
    `This turn EDITS the existing ${container} \`${slug}\`. The Figma node the designer pasted is`,
    "ALREADY rendered inside it — matched on the `data-figma-id` attribute that it carries,",
    `not inferred from the wording — so this is a follow-up on that ${container}, not a fresh design.`,
    "",
    `${where} Do NOT create a new ${container} and`,
    "  do NOT re-import the design as a second one.",
    "- Make the SMALLEST change that satisfies the request; leave everything else as it is.",
    "</target_frame>",
  ].join("\n");
}

/**
 * The honest version when provenance found the node in SEVERAL frames.
 *
 * Naming the wrong frame is worse than naming none — the generator edits it
 * without hesitating, and the designer's next turn is a second correction about a
 * third frame. So we hand over the candidates and let the agent, which can read
 * the prompt, pick.
 */
function buildFrameCandidatesDirective(slugs: string[], vocab: HostVocabulary): string {
  const container = vocab.container ?? "frame";
  return [
    "<target_frame>",
    `The Figma node the designer pasted already appears in more than one existing ${container}: ${slugs
      .map((s) => `\`${s}\``)
      .join(", ")}.`,
    "So this is an EDIT of one of them, not a new design.",
    "",
    `- Work out from the request which of those it is about, then edit that ${container} in place.`,
    `- Do NOT create a new ${container} and do NOT re-import the design as a second one.`,
    `- If you genuinely cannot tell which ${container} is meant, say so and ask — do not guess and rebuild.`,
    "</target_frame>",
  ].join("\n");
}

/**
 * Every directive this plan implies, in the order they must appear in the prompt.
 *
 * ORDER IS PART OF THE CONTRACT, not a formatting detail. The single-frame
 * constraint goes LAST — it is the strongest statement on the turn ("This
 * overrides every other instruction about frames") and it needs to be the last
 * thing the model reads before it starts, after the `<figma_context>` blocks and
 * after any `<edit_reference_designs>`.
 *
 * RETURNS `[]` FOR THE TWO NON-EDIT KINDS, deliberately:
 *   - `kit-emit` is the deterministic importer, which runs NO model at all. It
 *     cannot read a directive, and by construction the cascade never hands it a
 *     constraint (turnRouting.ts step 8).
 *   - `wire` already satisfies the single-frame constraint STRUCTURALLY: it
 *     imports URL#2 into the SAME frame dir as a sibling `Overlay.tsx`
 *     (chat.ts:1722 `entryFileName`), and its wiring prompt already says "Do NOT
 *     create a new frame. Do NOT move the overlay into its own frame."
 *     (chat.ts:1782). Adding a directive that forbids a second frame nobody was
 *     going to create would just contradict the two-file structure the wiring pass
 *     depends on. The plan carries the constraint for narration; this function is
 *     where it correctly stops.
 *
 * A plan with no directives returns `[]`, and a caller that appends nothing then
 * produces a byte-identical prompt to before this feature existed. That is the
 * regression guarantee the middleware tests rely on.
 */
export function buildTurnDirectives(
  plan?: FigmaTurnPlan | null,
  /**
   * The host's own layout nouns. Omitted ⇒ Studio's (`frame` / `<FrameLink>` /
   * `CLAUDE.md`), byte-identical to what Studio has always emitted. A foreign host
   * passes its three words so the portable text stops naming things only Studio
   * has — see HostVocabulary in ./turnConstraints for the measurement.
   */
  vocab: HostVocabulary = {},
): string[] {
  if (!plan) return [];
  if (plan.kind !== "claude") return [];

  const out: string[] = [];
  // Provenance NAMED one frame, or narrowed it to a few. Never both — the plan
  // type only ever sets one (turnRouting.ts step 6).
  if (plan.targetFrame) out.push(buildTargetFrameDirective(plan.targetFrame, vocab));
  else if (plan.frameCandidates?.length)
    out.push(buildFrameCandidatesDirective(plan.frameCandidates, vocab));

  // Last word before the model. Scoped to a real constraint on the plan — NOT to
  // `kind === "claude"`, which is true of every non-Figma prompt as well. That
  // exact mistake already shipped a directive telling a designer "Do NOT create a
  // new frame directory" in response to "New screen: an error state with a Try
  // again button"; the cascade's scope guard prevents it upstream and the
  // `constraints` check here is the second layer.
  if (plan.constraints?.includes("single-frame")) out.push(buildSingleFrameDirective(vocab));

  return out;
}

export interface SuppressWholeFrameContext {
  /**
   * `detectHiFiIntent(prompt)` — did the designer explicitly ask for a precise /
   * pixel-perfect implementation?
   *
   * Passed IN rather than derived here on purpose. `detectHiFiIntent` lives in
   * fidelityDirective.ts alongside 250 lines of Studio-specific directive text
   * that names the `figmanage` CLI — a binary no foreign host has. Keeping it out
   * of this module keeps the brain closure small and honest; the caller already
   * computes this value (chat.ts:791) to pick the digest-race budget.
   */
  explicitHiFi: boolean;
}

/**
 * Should the per-reference WHOLE-FRAME hi-fi directive be suppressed on this turn?
 *
 * `buildHiFiDirective` tells the agent to reproduce the referenced design as a
 * complete frame — "each section has the SAME number of rows, same order, as the
 * PNG". On a turn where the referenced design is a SECOND STATE that must live
 * inside an existing frame, that is precisely the instruction that causes the bug:
 * it is a description of building a fresh full frame. And it fires without any
 * hi-fi wording at all, because `shouldUseHiFi`'s novel-design upgrade turns it on
 * whenever the classifier ran and matched no high-confidence template — which is
 * the normal case for a design nobody has imported before.
 *
 * THE EXPLICIT-HI-FI CARVE-OUT, and why it is not a hole. If the designer wrote
 * "implement this precisely" AND stated a single-frame constraint, suppressing the
 * hi-fi directive would take away the precision they explicitly asked for and give
 * nothing back — the constraint directive already opens with "This overrides every
 * other instruction about frames" and is appended last, so the frame question is
 * settled by the constraint rather than by withholding the fidelity rules. The
 * suppression exists for the IMPLICIT upgrade, which is where the conflict is
 * silent. Measured on the corpus: `detectHiFiIntent` is FALSE for #1, #2, #30 and
 * #39 — every prompt this design fixes — so suppression is total for all of them,
 * and the carve-out fires on zero real prompts. It exists so that
 * "Implement this precisely, but keep it in the same frame" keeps the
 * `<high_fidelity_mode>` block it gets today AND gains the constraint, rather than
 * losing both (spec review, revision 4).
 */
export function shouldSuppressWholeFrame(
  plan: FigmaTurnPlan | null | undefined,
  ctx: SuppressWholeFrameContext,
): boolean {
  if (!plan || plan.kind !== "claude") return false;
  if (ctx.explicitHiFi) return false;
  return Boolean(
    plan.targetFrame ||
      plan.frameCandidates?.length ||
      plan.constraints?.includes("single-frame"),
  );
}
