// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectTurnConstraints,
  buildSingleFrameDirective,
} from "../../../server/figma/turnConstraints";

// The real corpus, not paraphrases. A routing change that breaks these breaks
// real usage — see the same reasoning in __tests__/lib/figmaUrl.test.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const corpus = require("../../fixtures/designer-prompts.json") as {
  prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
};

describe("detectTurnConstraints — single-frame", () => {
  // The three verbatim corpus statements of the constraint. #30 is the prompt
  // this whole branch exists for: the designer shouted DON'T IMPLEMENT THIS AS
  // A SEPARATE FRAME!!! and the deterministic importer, which has no LLM,
  // stamped a separate frame anyway (2026-08-06 designer session).
  it("fires on corpus #2, #30, #39 (verbatim fixture text)", () => {
    for (const i of [2, 30, 39]) {
      expect(detectTurnConstraints(corpus.prompts[i].text), `#${i}`).toEqual([
        "single-frame",
      ]);
    }
  });

  // CHARACTERISATION over all 67 prompts, in the style of the
  // "detectInteractionIntent — real designer corpus" block. This pins reality so
  // a future widening has to look at the diff and justify it, rather than
  // quietly eating faithful-copy asks the way the removed corrective detector
  // did (it fired on descriptive prose: see turnRouting.ts case 4).
  it("fires on exactly [2, 30, 39] across the whole corpus", () => {
    const fired = corpus.prompts
      .filter((p) => detectTurnConstraints(p.text).length > 0)
      .map((p) => p.i);
    expect(fired).toEqual([2, 30, 39]);
  });

  // #39 has NO Figma URL, so it reaches the generator today regardless and
  // merely gains the directive. Recorded so nobody reads the fire-set above as
  // "three routing fixes".
  it("documents that #39 carries no Figma URL (detection, not a routing change)", () => {
    expect(corpus.prompts[39].text).not.toContain("figma.com");
  });

  // macOS substitutes a typed apostrophe with U+2019 by default, and 5 of the 67
  // corpus prompts contain one (#39 among them: "You've made ticket page a
  // separate frame — don't do that"). Without normalisation the patterns are
  // curly-quote-blind and the identical sentence routes differently depending on
  // the designer's keyboard settings.
  it("normalises curly apostrophes (U+2019) before matching", () => {
    expect(
      detectTurnConstraints("don’t separate these screens onto multiple frames"),
    ).toEqual(["single-frame"]);
    // The ASCII twin must of course still work.
    expect(
      detectTurnConstraints("don't separate these screens onto multiple frames"),
    ).toEqual(["single-frame"]);
  });

  it("fires on the shouted / short phrasings designers actually type", () => {
    const yes = [
      "DON'T IMPLEMENT THIS AS A SEPARATE FRAME!!!",
      "do not separate these screens",
      "keep it in the same frame",
      "all within this single frame",
      "the transition must happen within this single frame",
    ];
    for (const p of yes) expect(detectTurnConstraints(p), p).toEqual(["single-frame"]);
  });

  // ACCEPTED BOUNDARY CASE, asserted on purpose. This exact string is in a
  // must-miss list for a DIFFERENT detector (detectInteractionIntent, in
  // __tests__/lib/figmaUrl.test.ts) where it must NOT fire. Here it SHOULD:
  // the designer did state a single-frame constraint. It is the one routing flip
  // this design accepts (spec §2.6), so it is pinned rather than left to be
  // silently "fixed" by narrowing the pattern later.
  it("fires on 'keep everything on a single frame' — correct detection, accepted flip", () => {
    expect(detectTurnConstraints("keep everything on a single frame")).toEqual([
      "single-frame",
    ]);
  });

  it("does NOT fire on faithful-copy asks, new-flow asks, or the opposite instruction", () => {
    const no = [
      "implement this precisely",
      "https://www.figma.com/design/abc/Foo?node-id=1-2",
      "add a confirmation step",
      "build a 4-step onboarding flow",
      // The INVERSE ask. A pattern that fired here would invert the designer's
      // meaning, which is worse than missing the constraint.
      "split this into separate frames",
      "as a new tab next to Canvas and Issues",
      "",
    ];
    for (const p of no) expect(detectTurnConstraints(p), p).toEqual([]);
  });

  // THE INVERSION GUARD, and the reason a pattern in this file must STATE the
  // requirement rather than spot two words. A bare noun phrase
  // (/\b(?:same|one|single)\s+frame\b/) shipped in the first cut and fired on all
  // 8 strings below — every one of which asks for MORE frames. It then handed the
  // generator a maximally forceful directive ("This overrides every other
  // instruction about frames", "Do NOT create a new frame directory"), i.e. a
  // hard override of what the designer had just typed. Inverting a designer's
  // instruction is strictly worse than missing it, because the directive is
  // obeyed and the designer cannot see why.
  //
  // Note how narrow the old guard was: the near-miss "split this into separate
  // frames" above passed ONLY because it omits the words "one frame". One
  // adverbial phrase wide. Adversarial review, measured 2026-08-06: 8/8 fired.
  it("does NOT fire on multi-frame asks that happen to contain the words (inversion)", () => {
    const inverse = [
      "Build the 4-step onboarding flow, one frame per step",
      "Split this into separate frames — one frame per screen",
      "Make each state its own frame, one frame each",
      "Import these as one frame per tab",
      "Two frames please, not one frame",
      "Put the confirmation on a separate frame, not the same frame as the form",
      "This should NOT be in the same frame; make a new frame for it",
      "Don't keep this in one frame — split it out",
    ];
    for (const p of inverse) expect(detectTurnConstraints(p), p).toEqual([]);
  });

  // THE DISTRIBUTIVE FAMILY — the SAME inversion bug as the block above, in a
  // shape the committed list happened to miss entirely (spec review, 2026-08-06
  // designer session). The list above only holds "one frame per X" and negated
  // phrasings, so every string here fired: measured 6 of 8 before the fix.
  //
  // "Put each state in a single frame" means ONE FRAME PER STATE — the opposite
  // requirement — and the negation anchor cannot help, because these sentences
  // are not negated. They read as positive statements of the constraint while
  // asking for its inverse, and the turn then received the maximally forceful
  // directive ("This overrides every other instruction about frames", "Do NOT
  // add a second frame for the second state, screen, or step"), i.e. the
  // generator confidently did the opposite of what the designer typed.
  //
  // No corpus must-fire prompt contains a distributive quantifier (#2, #30, #39
  // all measured: no each / every / per / own), so the veto costs nothing real.
  it("does NOT fire on DISTRIBUTIVE multi-frame asks (each/every/per/its own)", () => {
    const distributive = [
      "Put each state in a single frame",
      "each screen should be in a single frame",
      "Break it up so every step lives in a single frame",
      "Give me the empty state and the filled state in a single frame each",
      "Every variant goes in a single frame of its own",
      "keep each state in a single frame",
      "keep every screen in the same frame as its own step",
      "one frame per state",
      "each state in its own single frame",
    ];
    for (const p of distributive) expect(detectTurnConstraints(p), p).toEqual([]);
  });

  // …and the veto is SENTENCE-SCOPED, so a distributive quantifier in a
  // NEIGHBOURING sentence cannot suppress a genuine constraint. Without this the
  // fix for the block above would silently become a new class of miss — the
  // mirror-image mistake, and the one that put this branch here.
  it("a distributive word in ANOTHER sentence does not suppress a real constraint", () => {
    expect(
      detectTurnConstraints(
        "Each row shows a ticket. Don't implement this as a separate frame.",
      ),
      "distributive in the previous sentence",
    ).toEqual(["single-frame"]);
    expect(
      detectTurnConstraints(
        "keep everything on a single frame. Every row needs an avatar.",
      ),
      "distributive in the following sentence",
    ).toEqual(["single-frame"]);
  });

  // The NEGATED forms of the surviving positive patterns. Each of these is the
  // exact sentence a must-fire string becomes when a designer negates it, so the
  // negation anchor has to be part of every positive pattern rather than a
  // separate blocklist that drifts out of step with them.
  it("does NOT fire when a positive pattern is negated in the same sentence", () => {
    const negated = [
      "do not keep it in the same frame",
      "never keep this on one frame",
      "don't put it within this single frame",
      "don’t keep everything on a single frame", // curly, same rule
      "not in the same frame",
      "don't do it as a tab in the main frame",
    ];
    for (const p of negated) expect(detectTurnConstraints(p), p).toEqual([]);
  });

  // NON-LATIN MUST SURVIVE. A review of an earlier normalisation step found it
  // stripped non-Latin characters wholesale, which would erase a Russian or
  // Slovenian instruction rather than merely fail to understand it. Designers on
  // this team write in both. The English clause must still be found with the
  // non-Latin text intact and un-mangled around it.
  it("finds a constraint stated alongside non-Latin text (nothing is erased)", () => {
    expect(
      detectTurnConstraints("не разделяй эти экраны — keep everything on a single frame"),
    ).toEqual(["single-frame"]);
    expect(
      detectTurnConstraints("ne loči teh zaslonov — keep it in the same frame"),
    ).toEqual(["single-frame"]);
    // …and a non-Latin sentence that states no constraint stays inert rather
    // than tripping a pattern on mangled input.
    expect(detectTurnConstraints("сделай новый экран с кнопкой")).toEqual([]);
  });

  it("is robust to non-string input", () => {
    expect(detectTurnConstraints(undefined as unknown as string)).toEqual([]);
    expect(detectTurnConstraints(null as unknown as string)).toEqual([]);
  });
});

describe("buildSingleFrameDirective", () => {
  // The directive is the mechanism, so its load-bearing sentences are pinned.
  // Prompt-region text is obeyed harder than CLAUDE.md — the reason
  // server/editContext.ts exists — and the template still contains the
  // contradicting <FrameLink> rule (spec verification (c)), so this text has to
  // override it explicitly rather than merely disagree with it.
  it("forbids a new frame and forbids FrameLink, in so many words", () => {
    const d = buildSingleFrameDirective();
    expect(d).toContain("Do NOT create a new frame");
    expect(d).toContain("Do NOT use <FrameLink>");
    expect(d).toContain("<single_frame_constraint>");
    expect(d).toContain("</single_frame_constraint>");
  });

  it("tells the agent to build the second state IN-frame with React state", () => {
    expect(buildSingleFrameDirective()).toMatch(/useState/);
  });

  // THE DIRECTIVE IS THE PART OF THIS DESIGN THAT TRAVELS — a foreign host runs
  // `buildTurnDirectives(await planFigmaTurn(inputs))` and gets these exact words,
  // which is the whole reason the constraint fix is not .dmg-only. So the words
  // must not name things only Studio has.
  //
  // Measured (spec review, 2026-08-06): `frames/`, `<FrameLink>` and `CLAUDE.md`
  // are all Studio-only. The root SKILL.md — the actual foreign-host surface — has
  // ZERO occurrences of `frames/` or `FrameLink`; FrameLink is a prototype-kit
  // composite at studio/prototype-kit/composites/FrameLink.tsx that no foreign repo
  // can import; and CLAUDE.md.tpl renders only into a Studio project dir. So a
  // designer in Cursor typing corpus #30 was told to edit a directory that does not
  // exist, not to use a component it cannot import, and to obey rules in a file it
  // never read — and had to guess which parts applied.
  it("Studio's default vocabulary is unchanged (byte-identical)", () => {
    // The default must stay exactly what Studio shipped, or this becomes a silent
    // prompt change for the host where the failure was actually observed.
    const d = buildSingleFrameDirective();
    expect(d).toContain("<FrameLink>");
    expect(d).toContain("rules in CLAUDE.md");
    expect(d).toBe(buildSingleFrameDirective({}));
  });

  it("a foreign host can pass its OWN layout nouns", () => {
    const d = buildSingleFrameDirective({
      container: "screen component",
      linkComponent: "<Link>",
      rulesFile: "AGENTS.md",
    });
    // Its nouns are in…
    expect(d).toContain("screen component");
    expect(d).toContain("<Link>");
    expect(d).toContain("AGENTS.md");
    // …and Studio's are out, so nothing tells a Cursor session about FrameLink.
    expect(d).not.toContain("FrameLink");
    expect(d).not.toContain("CLAUDE.md");
    // The load-bearing behavioural instruction survives the substitution — the
    // point is to translate the nouns, not to weaken the rule.
    expect(d).toContain("<single_frame_constraint>");
    expect(d).toMatch(/useState/);
    expect(d).toContain("overrides every other");
  });
});
