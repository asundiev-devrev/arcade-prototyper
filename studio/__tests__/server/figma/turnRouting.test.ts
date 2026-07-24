// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  classifyFigmaTurn,
  isScopedEditTurn,
  type FigmaTurnInputs,
} from "../../../server/figma/turnRouting";

// A realistic scoped-edit preamble, as PromptInput.tsx prepends it.
const EDIT_PREAMBLE =
  "Target element: <Button> \"All Knowledge\"\n" +
  "Placed at frames/01-figma-8139-41293/index.tsx:39:247\n" +
  "Read the file(s) first — do not edit from memory.\n\n";

function inputs(over: Partial<FigmaTurnInputs>): FigmaTurnInputs {
  return {
    hasFigmaNode: true,
    wantsGeneration: false,
    hasInteractionIntent: false,
    figmaUrlCount: 1,
    prompt: "",
    ...over,
  };
}

describe("isScopedEditTurn", () => {
  it("is true when the client edit preamble is present", () => {
    expect(isScopedEditTurn(EDIT_PREAMBLE + "make it a filter")).toBe(true);
  });
  it("is false for a plain typed prompt", () => {
    expect(isScopedEditTurn("import this node https://figma.com/design/x?node-id=1-2")).toBe(false);
  });
});

describe("classifyFigmaTurn", () => {
  it("routes a bare Figma import to the deterministic kit-emit branch", () => {
    expect(
      classifyFigmaTurn(inputs({ prompt: "https://figma.com/design/x?node-id=1-2" })),
    ).toBe("kit-emit");
  });

  it("routes an import + 2 URLs + interaction to the wire branch", () => {
    expect(
      classifyFigmaTurn(
        inputs({
          hasInteractionIntent: true,
          figmaUrlCount: 2,
          prompt: "import this screen, clicking Filter opens this menu <url1> <url2>",
        }),
      ),
    ).toBe("wire");
  });

  it("routes a build-intent prompt to the Claude branch", () => {
    expect(
      classifyFigmaTurn(inputs({ wantsGeneration: true, prompt: "implement precisely but make it dark" })),
    ).toBe("claude");
  });

  it("routes a prompt with no Figma node to the Claude branch", () => {
    expect(classifyFigmaTurn(inputs({ hasFigmaNode: false, prompt: "make the title red" }))).toBe(
      "claude",
    );
  });

  // The bug: a scoped element edit that references Figma URLs + describes an
  // interaction was misrouted to "wire" and imported URL[0] as a NEW frame.
  it("keeps a scoped element edit in the Claude branch even with 2 URLs + interaction intent", () => {
    expect(
      classifyFigmaTurn(
        inputs({
          hasInteractionIntent: true,
          figmaUrlCount: 2,
          prompt:
            EDIT_PREAMBLE +
            'Make "All Knowledge" work as a filter that opens a popover menu on click. ' +
            "Popover: https://figma.com/design/x?node-id=8172-33651 " +
            "Menu: https://figma.com/design/x?node-id=8140-33699",
        }),
      ),
    ).toBe("claude");
  });

  it("keeps a scoped element edit in the Claude branch even for a bare single-URL reference (no kit-emit new frame)", () => {
    expect(
      classifyFigmaTurn(
        inputs({
          figmaUrlCount: 1,
          prompt: EDIT_PREAMBLE + "restyle this to match https://figma.com/design/x?node-id=1-2",
        }),
      ),
    ).toBe("claude");
  });
});
