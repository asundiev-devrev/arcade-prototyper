// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TPL = readFileSync(
  new URL("../../templates/CLAUDE.md.tpl", import.meta.url),
  "utf-8",
);

describe("CLAUDE.md.tpl two-tier authority", () => {
  it("declares the two-tier authority principle", () => {
    expect(TPL).toContain("Two-tier authority");
  });

  it("states that an explicit request may not be declined, only flagged", () => {
    expect(TPL).toContain(
      "An explicit request is never a deviation you're allowed to decline",
    );
  });

  it("scopes the nearest-token rule to the agent's own guesses", () => {
    expect(TPL).toContain(
      "The token rule governs your guesses, not their instructions.",
    );
  });

  it("still tells the agent it cannot import an uninstalled library", () => {
    expect(TPL).toMatch(/do NOT add an import that isn't in the kit/i);
  });
});
