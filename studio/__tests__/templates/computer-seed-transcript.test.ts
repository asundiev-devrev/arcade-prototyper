import { describe, it, expect } from "vitest";
import { readTemplateSeed } from "../../server/templates";

describe("Computer template seed transcript", () => {
  it("includes the transcript array in the seed", async () => {
    const src = await readTemplateSeed("computer");
    expect(src).toContain("const transcript");
    expect(src).toContain("transcript={transcript}");
    expect(src).toContain("<ComputerScene");
  });

  it("includes the expected seed messages", async () => {
    const src = await readTemplateSeed("computer");
    // Check that all four seed messages are present
    expect(src).toContain("Help me prep a marketing keynote for the Q3 launch");
    expect(src).toContain("Here's a starting outline");
    expect(src).toContain("Build the structure first");
    expect(src).toContain("A 5-act structure works for this audience");
  });

  it("includes the artefact on message 2", async () => {
    const src = await readTemplateSeed("computer");
    expect(src).toContain("artefact:");
    expect(src).toContain("Q3 launch brief");
  });
});
