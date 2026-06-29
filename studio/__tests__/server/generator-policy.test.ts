import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const TPL = readFileSync(path.resolve(__dirname, "../../templates/CLAUDE.md.tpl"), "utf-8");

describe("generator policy — ComputerScene populated default", () => {
  it("documents the transcript-as-frame-data form", () => {
    expect(TPL).toMatch(/transcript\s*=\s*\[/);
    expect(TPL).toMatch(/<ComputerScene\s+transcript=\{transcript\}/);
  });
  it("inlines the Message shape so the agent emits the right objects", () => {
    expect(TPL).toContain("id");
    expect(TPL).toMatch(/role:\s*["']user["']\s*\|\s*["']assistant["']|role: "user"/);
    expect(TPL).toContain("artefact");
  });
});
