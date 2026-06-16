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
