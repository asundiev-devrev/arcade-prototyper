// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  detectBuildIntent,
  shouldGenerateFromFigma,
  detectComposeBaseIntent,
  extractComposeBaseComposite,
} from "../../../server/figma/generationIntent";

describe("shouldGenerateFromFigma", () => {
  it("routes the real 'implement this design precisely' brief to the generator", () => {
    // The exact shape that fell through to the dumb importer and dropped all
    // three instructions (modify composite / functional input / theme all UI).
    const prompt =
      "Implement this design precisely. Important notes: 1. This UI is based " +
      "on the empty state of ComputerScene. Use that composite as a base. " +
      "2.2. The main input, instead of being fixed at the bottom of the " +
      "screen, it's full screen instead. Functional requirements: 1) modify " +
      "the ComputerScene composite instead of building from scratch. 2) The " +
      "updated full-screen input must be functional. 3) The new purple theme " +
      "must be applied to all of the UI, including canvas and side nav.";
    expect(shouldGenerateFromFigma(prompt)).toBe(true);
  });

  it("does NOT fire on hi-fi intent alone — pure precise/pixel-perfect routes deterministic", () => {
    expect(shouldGenerateFromFigma("implement this precisely")).toBe(false);
    expect(shouldGenerateFromFigma("pixel-perfect build of this frame")).toBe(false);
  });

  it("fires on interaction intent alone (click opens a modal)", () => {
    expect(shouldGenerateFromFigma("clicking Connect opens this dialog")).toBe(true);
  });

  it("fires when the prompt asks to modify or reuse a composite as a base", () => {
    expect(detectBuildIntent("modify the ComputerScene composite")).toBe(true);
    expect(detectBuildIntent("use that composite as a base")).toBe(true);
    expect(detectBuildIntent("start from the ComputerScene empty state")).toBe(true);
  });

  it("fires when the prompt asks for a functional / working result", () => {
    expect(detectBuildIntent("the input must be functional")).toBe(true);
    expect(detectBuildIntent("make the search work")).toBe(true);
  });

  it("fires when a theme must be applied across the UI", () => {
    expect(detectBuildIntent("the purple theme must be applied to all of the UI")).toBe(true);
    expect(detectBuildIntent("apply this theme to the nav and canvas")).toBe(true);
  });

  it("does NOT fire on a bare import (URL only, no build instruction)", () => {
    const bare = [
      "https://www.figma.com/design/abc/Foo?node-id=1-2",
      "import this https://www.figma.com/design/abc/Foo?node-id=1-2",
      "bring this in from figma",
      "grab this design",
      "",
    ];
    for (const p of bare) expect(shouldGenerateFromFigma(p), p).toBe(false);
  });

  it("is robust to non-string input", () => {
    expect(detectBuildIntent(undefined as unknown as string)).toBe(false);
    expect(shouldGenerateFromFigma(null as unknown as string)).toBe(false);
  });

  it("fires on destructive/substitution edit verbs (importer can't perform these)", () => {
    expect(detectBuildIntent("remove the search bar")).toBe(true);
    expect(detectBuildIntent("delete the top nav")).toBe(true);
    expect(detectBuildIntent("swap the logo for ours")).toBe(true);
    expect(detectBuildIntent("replace the avatars with initials")).toBe(true);
    expect(detectBuildIntent("rename the tabs")).toBe(true);
    expect(detectBuildIntent("make the sidebar dark")).toBe(true);
    expect(detectBuildIntent("replace the header with a banner")).toBe(true);
  });

  it("routes a copy-but-tweak prompt (hi-fi + edit verb) to the generator", () => {
    // The gap Task 1 opened: hi-fi wording no longer routes, so the edit verb
    // must carry it to the LLM or the tweak is silently dropped.
    expect(shouldGenerateFromFigma("recreate this exactly, remove the search bar")).toBe(true);
    expect(shouldGenerateFromFigma("implement precisely but make the sidebar dark")).toBe(true);
  });

  it("does NOT misroute faithful-copy prompts that merely CONTAIN an edit word", () => {
    // Every one of these is a pure photocopy — must stay deterministic. The
    // words appear as style descriptions, quoted UI labels, purpose clauses, or
    // "make sure/match" hedges, not as edit instructions. (Adversarial FP set.)
    const copies = [
      "keep the drop shadow on the card",              // "drop" NOT an edit verb
      "copy this exactly including the drop-shadow",   // drop-shadow
      "make sure the dark header matches the figma",   // make SURE = ensure
      "copy this — make it match the light mockup",    // make…match = comparison
      "the button label reads 'Delete account'",       // quoted label
      "the modal is titled 'Rename workspace'",        // quoted label
      "this design will replace the current home page",// purpose, not instruction
      "the design is meant to replace the settings page",
      "implement the dark variant precisely",          // describes what to copy
      "a delete button in the toolbar",                // noun, not verb
    ];
    for (const p of copies) expect(shouldGenerateFromFigma(p), p).toBe(false);
  });
});

describe("extractComposeBaseComposite", () => {
  it("extracts a named ejectable composite used as a base", () => {
    expect(extractComposeBaseComposite("modify the ComputerScene composite")).toBe("ComputerScene");
    expect(extractComposeBaseComposite("use ComputerScene as a base")).toBe("ComputerScene");
    expect(extractComposeBaseComposite("based on the empty state of ComputerScene")).toBe("ComputerScene");
  });
  it("returns null when no known composite is named", () => {
    expect(extractComposeBaseComposite("modify the composite")).toBeNull();
    expect(extractComposeBaseComposite("build a settings page")).toBeNull();
    expect(extractComposeBaseComposite("use FooBarScene as a base")).toBeNull();
  });
  it("is robust to non-string input", () => {
    expect(extractComposeBaseComposite(undefined as unknown as string)).toBeNull();
  });
});

describe("detectComposeBaseIntent", () => {
  it("fires on the motivating prompt (build intent + named composite)", () => {
    const p =
      "Implement this design precisely. Use the empty state of ComputerScene as a base. " +
      "Modify the ComputerScene composite instead of building from scratch.";
    expect(detectComposeBaseIntent(p)).toBe(true);
    // Must be a SUBSET of generation intent — never eject on an importer turn.
    expect(shouldGenerateFromFigma(p)).toBe(true);
  });
  it("does NOT fire without a named ejectable composite", () => {
    expect(detectComposeBaseIntent("implement this precisely")).toBe(false);
    expect(detectComposeBaseIntent("modify the composite")).toBe(false);
  });
});
