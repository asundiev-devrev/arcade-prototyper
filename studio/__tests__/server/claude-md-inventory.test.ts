// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TPL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
  "CLAUDE.md.tpl",
);

describe("CLAUDE.md template — inventory injection", () => {
  const tpl = fs.readFileSync(TPL, "utf-8");

  it("imports the project inventory", () => {
    expect(tpl).toContain("@memory/INVENTORY.md");
  });

  it("still imports both memory levels", () => {
    expect(tpl).toContain("@{{GLOBAL_MEMORY}}/RULES.md");
    expect(tpl).toContain("@{{GLOBAL_MEMORY}}/LEARNED.md");
    expect(tpl).toContain("@memory/RULES.md");
    expect(tpl).toContain("@memory/LEARNED.md");
  });

  it("tells the agent to reuse what the inventory lists", () => {
    expect(tpl).toMatch(/reuse/i);
  });

  it("no longer instructs the agent to append to LEARNED.md", () => {
    // Writes are server-owned now. If this regresses, the agent and the server
    // both write the same file and rows get duplicated or clobbered.
    expect(tpl).not.toMatch(/append one line/i);
    expect(tpl).not.toMatch(/`LEARNED\.md` is yours to maintain/i);
  });

  it("does not hardcode a count of memory files", () => {
    // A literal count ("all four files") goes stale the moment a memory file
    // is added, and the stale number reads as an exemption for the new file.
    expect(tpl).not.toMatch(/All (two|three|four|five|six) files above/i);
  });

  it("declares every memory import read-only to the agent", () => {
    const imports = tpl.match(/^@(\{\{GLOBAL_MEMORY\}\}|memory)\/[A-Z]+\.md$/gm) ?? [];
    expect(imports.length).toBeGreaterThanOrEqual(5);
    expect(tpl).toMatch(/read-only to you/);
  });
});
