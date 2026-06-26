import { describe, it, expect } from "vitest";
import { buildAiExpandPrompt } from "../../../server/expand/aiExpand";

describe("buildAiExpandPrompt", () => {
  it("scopes the rewrite to the named tag + frame, preserving visuals", () => {
    const p = buildAiExpandPrompt("01-page", "VistaPage");
    expect(p).toContain("frames/01-page/index.tsx");
    expect(p).toContain("<VistaPage");
    expect(p.toLowerCase()).toContain("flat");
    expect(p.toLowerCase()).toMatch(/preserve|identical|same visual/);
    expect(p).toMatch(/only|nothing else|do not change/i);
  });
});
