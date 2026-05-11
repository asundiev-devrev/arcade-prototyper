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
