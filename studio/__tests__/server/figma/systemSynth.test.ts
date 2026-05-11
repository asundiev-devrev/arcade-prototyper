import { describe, it, expect, vi } from "vitest";
import { synthesizeSystem } from "../../../server/figma/systemSynth";
import type { SystemSources } from "../../../server/figma/systemSources";

function minimalSources(): SystemSources {
  return {
    styles: {
      paint: [{ id: "1", name: "bg/canvas", hex: "#F6F7F9" }],
      text: [{ id: "2", name: "body/md", family: "Inter", size: 14, weight: 400 }],
      effect: [],
    },
    variables: { color: [], number: [] },
    components: [{ id: "3", name: "Button", isComponentSet: false }],
    sampleFrames: [],
    warnings: [],
  };
}

function cannedReply(obj: any): string {
  return JSON.stringify(obj);
}

describe("synthesizeSystem — happy path", () => {
  it("parses a valid Claude reply into SynthesizedSections", async () => {
    const spawn = vi.fn().mockResolvedValue({
      text: cannedReply({
        identity: "A dense utilitarian design system.",
        colors: { entries: [{ name: "bg/canvas", value: "#F6F7F9", role: "background" }], warnings: [] },
        typography: { entries: [{ name: "body/md", value: "Inter 14 400", role: "body" }], warnings: [] },
        spacing: { scale: [4, 8, 16] },
        radii: { scale: [0, 4] },
        shadows: { items: [] },
        components: ["Button"],
        warnings: [],
      }),
      exitCode: 0,
    });
    const out = await synthesizeSystem(minimalSources(), { spawn });
    expect(out.identity).toContain("utilitarian");
    expect(out.colors.entries[0].value).toBe("#F6F7F9");
    expect(out.components).toEqual(["Button"]);
  });
});
