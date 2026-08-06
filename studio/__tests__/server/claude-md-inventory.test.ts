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
    expect(tpl).toContain("@global-memory/RULES.md");
    expect(tpl).toContain("@global-memory/LEARNED.md");
    expect(tpl).toContain("@memory/RULES.md");
    expect(tpl).toContain("@memory/LEARNED.md");
  });

  it("imports global memory via relative path, not absolute", () => {
    expect(tpl).toContain("@global-memory/RULES.md");
    expect(tpl).toContain("@global-memory/LEARNED.md");
  });

  it("contains NO absolute-path @-import (silently do not resolve)", () => {
    // Absolute-path @-imports silently fail in claude CLI 2.1.220 — same file,
    // same content, relative loads and absolute returns NOT VISIBLE.
    expect(tpl).not.toMatch(/^@\//m);
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
    const imports = tpl.match(/^@(global-memory|memory)\/[A-Z]+\.md$/gm) ?? [];
    expect(imports.length).toBeGreaterThanOrEqual(5);
    expect(tpl).toMatch(/read-only to you/);
  });

  it("does not claim Studio writes memory for remember: prompts", () => {
    // Regression: the template once promised "Studio does the writing" but no
    // such writer existed — silent data loss. Now the agent must honestly direct
    // the user to the Memory panel.
    expect(tpl).not.toMatch(/Studio does the writing/i);
    expect(tpl).not.toMatch(/Studio will (write|save|capture)/i);
  });

  it("asks the agent to propose a memory for remember: prompts", () => {
    // Was: "points at the Memory panel". That was the honest stopgap while
    // nothing wrote memory. Studio captures the proposal now, so the template
    // must ask the agent for the line instead of deferring to the panel.
    expect(tpl).toMatch(/⟐ remember:/);
    expect(tpl).not.toMatch(/tell them to add it under/i);
  });
});
