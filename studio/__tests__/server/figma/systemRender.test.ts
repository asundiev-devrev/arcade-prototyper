import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDesignMd } from "../../../server/figma/systemRender";
import type { SynthesizedSections } from "../../../server/figma/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../fixtures/figma");

describe("renderDesignMd — happy path", () => {
  it("matches the golden markdown byte-for-byte", () => {
    const sections = JSON.parse(
      fs.readFileSync(path.join(fxDir, "synth-output-golden.json"), "utf-8"),
    ) as SynthesizedSections;
    const expected = fs.readFileSync(path.join(fxDir, "design-md-golden.md"), "utf-8");
    const actual = renderDesignMd(sections, {
      fileKey: "abc123",
      scannedAt: "2026-05-11T00:00:00Z",
    });
    expect(actual).toBe(expected);
  });
});

function emptySections(): SynthesizedSections {
  return {
    identity: "A minimal placeholder identity.",
    colors: { entries: [], warnings: [] },
    typography: { entries: [], warnings: [] },
    spacing: { scale: [] },
    radii: { scale: [] },
    shadows: { items: [] },
    components: [],
    warnings: [],
  };
}

describe("renderDesignMd — edge cases", () => {
  it("renders empty sections with the _(none detected)_ sentinel", () => {
    const md = renderDesignMd(emptySections(), { fileKey: "fk", scannedAt: "t" });
    expect(md).toContain("## Colors\n_(none detected)_");
    expect(md).toContain("## Typography\n_(none detected)_");
    expect(md).toContain("## Spacing\n_(none detected)_");
    expect(md).toContain("## Radii\n_(none detected)_");
    expect(md).toContain("## Shadows\n_(none detected)_");
    expect(md).toContain("## Components\n_(none detected)_");
  });

  it("clamps Identity over 80 words to the last sentence boundary", () => {
    const long = Array(120).fill("word").join(" ") + ". End.";
    const s = { ...emptySections(), identity: long + " Extra words that spill beyond the cap and keep going and going and going." };
    const md = renderDesignMd(s, { fileKey: "fk", scannedAt: "t" });
    const identitySection = md.split("## Identity\n")[1].split("\n\n## Colors")[0];
    const words = identitySection.trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(80);
  });

  it("truncates component list to 50 names in listed order", () => {
    const names = Array.from({ length: 75 }, (_, i) => `Comp${String(i).padStart(2, "0")}`);
    const s: SynthesizedSections = { ...emptySections(), components: names };
    const md = renderDesignMd(s, { fileKey: "fk", scannedAt: "t" });
    const compsSection = md.split("## Components\n")[1].trim();
    const emitted = compsSection.split(", ");
    expect(emitted).toHaveLength(50);
    expect(emitted[0]).toBe("Comp00");
    expect(emitted[49]).toBe("Comp49");
  });

  it("keeps section order fixed: Identity, Colors, Typography, Spacing, Radii, Shadows, Components", () => {
    const md = renderDesignMd(emptySections(), { fileKey: "fk", scannedAt: "t" });
    const headings = [...md.matchAll(/^## (\w+)/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Identity", "Colors", "Typography", "Spacing", "Radii", "Shadows", "Components"]);
  });
});
