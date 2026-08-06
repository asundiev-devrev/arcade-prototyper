import { describe, it, expect } from "vitest";
import {
  extractFigmaUrl,
  extractFigmaUrls,
  detectInteractionIntent,
  decoratePromptWithFigma,
} from "../../src/lib/figmaUrl";

describe("figmaUrl helpers", () => {
  it("extracts a Figma URL with node id", () => {
    expect(extractFigmaUrl("Look at https://www.figma.com/design/abc/Foo?node-id=1-2"))
      .toBe("https://www.figma.com/design/abc/Foo?node-id=1-2");
  });
  it("returns null without a node id", () => {
    expect(extractFigmaUrl("https://www.figma.com/design/abc/Foo")).toBeNull();
  });
  it("decoratePromptWithFigma appends the url", () => {
    const out = decoratePromptWithFigma("Build this", "https://figma.com/design/a?node-id=1-2");
    expect(out).toContain("Figma reference:");
  });
});

describe("extractFigmaUrls", () => {
  const screen = "https://www.figma.com/design/ssU/Onboarding?node-id=3814-30541";
  const modal = "https://www.figma.com/design/ssU/Onboarding?node-id=3814-30924";

  it("returns BOTH urls in document order (the screen + the modal)", () => {
    const prompt = `Implement this screen ${screen}\nCRITICAL: clicking Connect Outlook opens this modal ${modal}`;
    expect(extractFigmaUrls(prompt)).toEqual([screen, modal]);
  });
  it("de-duplicates a repeated url", () => {
    expect(extractFigmaUrls(`${screen} and again ${screen}`)).toEqual([screen]);
  });
  it("ignores non-node and non-figma urls", () => {
    const prompt = `${screen} https://www.figma.com/design/x/NoNode https://example.com/foo`;
    expect(extractFigmaUrls(prompt)).toEqual([screen]);
  });
});

describe("detectInteractionIntent", () => {
  it("fires on click→show-modal phrasing", () => {
    expect(detectInteractionIntent('when you click "Connect Outlook" this modal should appear on top')).toBe(true);
    expect(detectInteractionIntent("clicking the button opens a dialog")).toBe(true);
    expect(detectInteractionIntent("on hover, show a tooltip")).toBe(true);
    expect(detectInteractionIntent("wire the interaction: modal on click")).toBe(true);
    expect(detectInteractionIntent("a drawer slides in when you tap the menu")).toBe(true);
  });
  it("does NOT fire on a plain static-implementation prompt", () => {
    expect(detectInteractionIntent("Implement this screen precisely")).toBe(false);
    expect(detectInteractionIntent("Match the design exactly, pixel-perfect")).toBe(false);
    expect(detectInteractionIntent("make the title red and add a logo")).toBe(false);
  });
});

// Bug 2, live designer session 2026-08-06 (project implement-this-precisely-3,
// Onboarding 3.0). The designer asked for an in-frame animated transition and
// the detector returned FALSE, so the turn fell through to the deterministic
// importer and screen 2 was stamped as a SEPARATE frame — the exact thing the
// prompt said IMPORTANT/don't-do. Root causes: (a) the only when-anchored
// pattern hard-coded a three-literal subject set (you / a user / someone) so
// first-person and "the user" never matched, and (b) motion vocabulary
// (animate / transition) appeared nowhere in the pattern array.
describe("detectInteractionIntent — first-person + motion phrasings (bug 2)", () => {
  it("fires on the real failing prompt from the 2026-08-06 session", () => {
    const p3 =
      'When I click on "Save", I want you to animate the transition to this screen:\n\n' +
      "https://www.figma.com/design/ssUerkBL5uOm7tNyHoZVtc/Onboarding-3.0?node-id=5678-118907\n\n" +
      "IMPORTANT: don't separate these screens onto multiple frames, the transition " +
      "must happen within this single frame.";
    expect(detectInteractionIntent(p3)).toBe(true);
  });

  it("fires on first-person and third-person subjects, not just 'when you'", () => {
    expect(detectInteractionIntent("when I click Save")).toBe(true);
    expect(detectInteractionIntent("when the user clicks Save")).toBe(true);
    expect(detectInteractionIntent("when I press Save")).toBe(true);
    expect(detectInteractionIntent("when I tap the row")).toBe(true);
    expect(detectInteractionIntent("when I hover the icon")).toBe(true);
    // The pre-existing phrasing must keep working.
    expect(detectInteractionIntent("when you click Save")).toBe(true);
  });

  it("fires on motion / transition asks", () => {
    expect(detectInteractionIntent("clicking Save should transition to this screen")).toBe(true);
    expect(detectInteractionIntent("animate the transition between these two screens")).toBe(true);
    expect(detectInteractionIntent("add a transition when I hit Save")).toBe(true);
  });

  it("fires on gerund triggers whose result verb isn't 'open/show'", () => {
    expect(detectInteractionIntent("pressing Save navigates to the next screen")).toBe(true);
    expect(detectInteractionIntent("tapping the row expands the section")).toBe(true);
    expect(detectInteractionIntent("submitting the form shows the success screen")).toBe(true);
  });

  // The widening's hard boundary. A faithful-reproduction ask must stay on the
  // deterministic kit-emit engine (fidelity by construction) — see the
  // figma-import-v2 routing work. These strings are realistic designer prose
  // that a naive bare /transition/ or /animation/ widening WOULD have eaten;
  // none of them was protected by a test before this fix.
  it("does NOT fire on faithful-reproduction prose that merely mentions motion", () => {
    const copies = [
      "implement this screen precisely",
      "import this from figma",
      "bring this in",
      "grab this design",
      "pixel-perfect build of this frame",
      "https://www.figma.com/design/abc/Foo?node-id=1-2",
      "implement this precisely — it's the transition state of the onboarding flow",
      "this frame documents the CSS transition tokens, copy them exactly",
      "make the transition state match the mockup",
      "the animation spec sheet for this flow, copy it exactly",
      "implement both screens precisely",
      "keep everything on a single frame",
      "keep the drop shadow on the card",
      "copy this exactly including the drop-shadow",
      "the empty state of the settings page, pixel perfect",
      "",
    ];
    for (const p of copies) expect(detectInteractionIntent(p), p).toBe(false);
  });

  // Regressions caught by adversarial review of the FIRST version of this
  // widening, each verified against main before/after. The first cut used
  // `(?:when|whenever|after|once)` with an OPTIONAL subject and a bare
  // /animat(e|es|ing)/, and every string below flipped kit-emit → claude,
  // i.e. lost the deterministic faithful import. Same failure family as the
  // "drop shadow" over-block (commit 4b1aa4c): a word that reads as an
  // instruction in isolation is ordinary description in a designer's sentence.
  it("does NOT fire on negated or descriptive motion (needs a real object)", () => {
    const negatedOrDescriptive = [
      "Implement this precisely. Don't animate anything, I just want the static screen.",
      "No need to animate the loader, just draw it as it is in the frame.",
      "the spinner animates in the prototype but keep it static for now",
      "the chart animates on load in Figma, ignore that.",
      "The hero animates but I only need the first keyframe.",
      "spec says animate on load",
    ];
    for (const p of negatedOrDescriptive) expect(detectInteractionIntent(p), p).toBe(false);
  });

  it("does NOT fire on after/once flow-position prose or bare participles", () => {
    // "after"/"once" are PROVENANCE words in designer prose — they say where a
    // node sits in a flow, not that a click should be wired. A bare participle
    // ("once selected") names the state the design depicts.
    const provenance = [
      "This is what the user sees after they click Continue. Implement this one screen precisely.",
      "This is the screen after clicking Continue. Implement it precisely.",
      "Implement precisely — the state after selecting a workspace.",
      "Implement this precisely. It's the screen after pressing Skip.",
      "Implement this precisely — the confirmation after tapping Delete.",
      "This is the view once you choose Annual.",
      "The row shows the active style once selected.",
      "Implement precisely: the button once pressed, with the pressed fill.",
      'Implement this exactly. The panel after selecting "All".',
    ];
    for (const p of provenance) expect(detectInteractionIntent(p), p).toBe(false);
  });

  it("keeps trigger and result on ONE line (a bulleted list must not bridge)", () => {
    // The gerund rule's span is newline-bounded. With a plain [^.]* this
    // bridged "typing indicator" on one bullet to a "show" several bullets
    // later, firing on a purely static list of things to draw.
    const bulleted = [
      "Implement precisely:\n- a typing indicator at the bottom\n- the avatar stack on the right\n- show the unread badge",
    ];
    for (const p of bulleted) expect(detectInteractionIntent(p), p).toBe(false);
  });
});

// The real corpus as a regression gate. These are VERBATIM prompts designers
// typed in actual Studio sessions, so a routing change that breaks them breaks
// real usage — unlike hand-written strings, which we bias toward whatever the
// current patterns already match.
//
// This fixture is also the evidence that killed keyword-based CORRECTION
// detection (27% recall on the 15 labelled corrections). See case 4 in
// server/figma/turnRouting.ts. Interaction detection survives because it keys
// off an explicit trigger clause, which designers do write literally — but it
// gets pinned here so the next widening is measured, not guessed.
describe("detectInteractionIntent — real designer corpus", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const corpus = require("../fixtures/designer-prompts.json") as {
    prompts: Array<{ i: number; isCorrection: boolean; text: string }>;
  };

  it("loads the corpus", () => {
    expect(corpus.prompts.length).toBeGreaterThanOrEqual(67);
    expect(corpus.prompts.filter((p) => p.isCorrection).length).toBe(15);
  });

  // CHARACTERISATION, not aspiration. This pins what the detector does on real
  // input today so a future change has to look at the diff and justify it. It is
  // deliberately NOT a claim that this set is semantically correct — see the
  // known-imperfect cases below.
  //
  // Measured 2026-08-06 against the narrowed patterns.
  const FIRES_TODAY = [2, 3, 15, 16, 22, 54, 66];

  it("fires on exactly the measured set (characterisation)", () => {
    const fired = corpus.prompts.filter((p) => detectInteractionIntent(p.text)).map((p) => p.i);
    expect(fired).toEqual(FIRES_TODAY);
  });

  // The two prompts in FIRES_TODAY that are arguably wrong, kept explicit so
  // nobody "fixes" the set without understanding the trade:
  //
  //  #3  a 1017-char re-implementation brief. Fires on an incidental
  //      "you can click on '+' to open a new tab" — the designer NARRATING how
  //      the product works, inside a build request. Wrong in principle.
  //  #66 a bug report ("the '+' button doesn't show on hover"). It IS about
  //      behaviour, so routing it to the LLM is right, but it arrives via the
  //      interaction rule rather than any understanding that it's a complaint.
  //
  // Both are cases where a keyword cannot see the difference between describing
  // behaviour and requesting it. Neither is worth another pattern: the fix is
  // model-side classification (case 4 in server/figma/turnRouting.ts). Recorded
  // here so the limitation is documented rather than mistaken for correctness.
  it("documents the known-imperfect fires", () => {
    expect(detectInteractionIntent(corpus.prompts[3].text)).toBe(true);
    expect(detectInteractionIntent(corpus.prompts[66].text)).toBe(true);
  });

  // The prompts that genuinely ask for behaviour and are MISSED. Every one names
  // a trigger without a trigger VERB ("when a new tab is created", "when I'm
  // switching", "when user opens"), or asks to wire without naming a gesture
  // ("wire the item such that it opens"). Widening to catch them would eat the
  // faithful-copy prose in the must-miss lists above — which is precisely why
  // this belongs on the model, not on regexes.
  it("documents the behaviour prompts it MISSES (accepted, not fixed)", () => {
    const missed = [18, 32, 35, 46, 52];
    for (const i of missed) {
      expect(detectInteractionIntent(corpus.prompts[i].text), corpus.prompts[i].text.slice(0, 70)).toBe(false);
    }
  });
});
